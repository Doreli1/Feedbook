-- Notification path for new/cancelled orders, requested 2026-09-19: every
-- restaurant staff member gets a notification when an order is placed or an
-- item is cancelled, and the diner who placed/cancelled it gets their own
-- confirmation notification. Both land in the `notifications` table
-- (20260830145848_support_and_operations.sql) — it already had exactly this
-- shape (user_id OR staff_id, type/title/body, read_at) and RLS
-- (20260830145852_row_level_security.sql: staff/user read+mark-own-read)
-- but no code ever inserted into it until now. `type='order_status'` already
-- covers both events (a new order and a cancellation are both order status
-- transitions) — no need to touch the CHECK constraint.
--
-- Inserted as explicit statements inside the two functions that already own
-- these transactions (place_order_transaction, and a new small function
-- called from update-order-item's cancel branch) rather than AFTER triggers
-- on orders/order_items — an AFTER INSERT trigger on `orders` would fire
-- before place_order_transaction's own subsequent order_items inserts exist
-- yet, so it could never summarize what was actually ordered.

-- Re-snapshot: same params/return type as 20260917150000_dish_discount_percent.sql,
-- only the new notification inserts are added at the end.
create or replace function place_order_transaction(
  p_session_id uuid,
  p_participant_id uuid,
  p_items jsonb
)
returns table (order_id uuid, inventory_alerts jsonb, bar_ticket_number int)
language plpgsql
set search_path = public
as $$
declare
  v_session_status text;
  v_restaurant_id uuid;
  v_table_type text;
  v_table_number text;
  v_bar_ticket_number int;
  v_new_order_id uuid;
  v_item jsonb;
  v_dish_id uuid;
  v_quantity int;
  v_size_option_id uuid;
  v_dish_is_available boolean;
  v_discount_percent numeric(4, 1);
  v_unit_price numeric(10, 2);
  v_new_order_item_id uuid;
  v_modifier_id uuid;
  v_modifier_price numeric(10, 2);
  v_total numeric(10, 2) := 0;
  v_item_total numeric(10, 2);
  v_alerts jsonb;
  v_item_summary text;
  v_diner_user_id uuid;
  v_label text;
begin
  select ts.status, ts.restaurant_id, t.table_type, t.table_number
    into v_session_status, v_restaurant_id, v_table_type, v_table_number
    from table_sessions ts
    join tables t on t.id = ts.table_id
    where ts.id = p_session_id
    for update of ts;

  if v_session_status is distinct from 'open' then
    raise exception 'SESSION_NOT_OPEN';
  end if;

  if v_table_type = 'bar' then
    v_bar_ticket_number := next_bar_ticket_number(v_restaurant_id);
  end if;

  insert into orders (session_id, participant_id, bar_ticket_number)
    values (p_session_id, p_participant_id, v_bar_ticket_number)
    returning id into v_new_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_dish_id := (v_item ->> 'dish_id')::uuid;
    v_quantity := coalesce((v_item ->> 'quantity')::int, 1);
    v_size_option_id := nullif(v_item ->> 'dish_size_option_id', '')::uuid;

    select is_available, price, discount_percent into v_dish_is_available, v_unit_price, v_discount_percent
      from dishes where id = v_dish_id;

    if v_dish_is_available is distinct from true then
      raise exception 'DISH_NOT_AVAILABLE';
    end if;

    if v_size_option_id is not null then
      select price into v_unit_price
        from dish_size_options
        where id = v_size_option_id and dish_id = v_dish_id;
      if v_unit_price is null then
        raise exception 'DISH_NOT_AVAILABLE';
      end if;
    end if;

    if v_discount_percent > 0 then
      v_unit_price := round(v_unit_price * (1 - v_discount_percent / 100), 2);
    end if;

    insert into order_items (order_id, dish_id, dish_size_option_id, quantity, unit_price)
      values (v_new_order_id, v_dish_id, v_size_option_id, v_quantity, v_unit_price)
      returning id into v_new_order_item_id;

    v_item_total := v_unit_price * v_quantity;

    for v_modifier_id in
      select jsonb_array_elements_text(coalesce(v_item -> 'modifier_option_ids', '[]'::jsonb))::uuid
    loop
      select price_delta into v_modifier_price
        from dish_modifier_options where id = v_modifier_id;
      if v_modifier_price is null then
        raise exception 'DISH_NOT_AVAILABLE';
      end if;

      insert into order_item_modifiers (order_item_id, modifier_option_id, price_delta_at_order)
        values (v_new_order_item_id, v_modifier_id, v_modifier_price);

      v_item_total := v_item_total + (v_modifier_price * v_quantity);
    end loop;

    v_total := v_total + v_item_total;
  end loop;

  select coalesce(
    jsonb_agg(jsonb_build_object('ingredient_id', d.ingredient_id, 'below_threshold', d.below_threshold))
      filter (where d.below_threshold),
    '[]'::jsonb
  )
  into v_alerts
  from deduct_inventory_for_order(v_new_order_id) d;

  insert into order_holds (order_id, participant_id, amount)
    values (v_new_order_id, p_participant_id, v_total);

  -- Notification path (2026-09-19): staff of the restaurant + the diner who
  -- placed the order, both addressed at the specific record (table/ticket +
  -- item summary), not a generic "new order" blip.
  select string_agg(oi.quantity || 'x ' || d.name, ', ' order by d.name)
    into v_item_summary
    from order_items oi
    join dishes d on d.id = oi.dish_id
    where oi.order_id = v_new_order_id;

  v_label := case when v_table_type = 'bar'
    then 'הזמנה #' || lpad(coalesce(v_bar_ticket_number, 0)::text, 4, '0')
    else 'שולחן ' || coalesce(v_table_number, '—')
  end;

  insert into notifications (staff_id, type, title, body)
    select s.id, 'order_status', 'הזמנה חדשה - ' || v_label, v_item_summary
    from staff s
    where s.restaurant_id = v_restaurant_id and s.is_active;

  select user_id into v_diner_user_id from session_participants where id = p_participant_id;
  if v_diner_user_id is not null then
    insert into notifications (user_id, type, title, body)
      values (v_diner_user_id, 'order_status', 'ההזמנה נשלחה בהצלחה', v_item_summary);
  end if;

  return query select v_new_order_id, v_alerts, v_bar_ticket_number;
end;
$$;

-- Called from update-order-item's cancel branch, right after status is set
-- to 'cancelled' — never touches order_items itself, purely notification
-- fan-out for one already-cancelled item.
create or replace function notify_order_item_cancelled(p_order_item_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_diner_user_id uuid;
  v_dish_name text;
  v_quantity int;
  v_table_type text;
  v_table_number text;
  v_bar_ticket_number int;
  v_label text;
begin
  select ts.restaurant_id, sp.user_id, d.name, oi.quantity, t.table_type, t.table_number, o.bar_ticket_number
    into v_restaurant_id, v_diner_user_id, v_dish_name, v_quantity, v_table_type, v_table_number, v_bar_ticket_number
    from order_items oi
    join orders o on o.id = oi.order_id
    join session_participants sp on sp.id = o.participant_id
    join table_sessions ts on ts.id = o.session_id
    join tables t on t.id = ts.table_id
    join dishes d on d.id = oi.dish_id
    where oi.id = p_order_item_id;

  if v_restaurant_id is null then
    return;
  end if;

  v_label := case when v_table_type = 'bar'
    then 'הזמנה #' || lpad(coalesce(v_bar_ticket_number, 0)::text, 4, '0')
    else 'שולחן ' || coalesce(v_table_number, '—')
  end;

  insert into notifications (staff_id, type, title, body)
    select s.id, 'order_status', 'הזמנה בוטלה - ' || v_label, v_quantity || 'x ' || v_dish_name
    from staff s
    where s.restaurant_id = v_restaurant_id and s.is_active;

  if v_diner_user_id is not null then
    insert into notifications (user_id, type, title, body)
      values (v_diner_user_id, 'order_status', 'ההזמנה בוטלה', v_quantity || 'x ' || v_dish_name || ' בוטל בהצלחה');
  end if;
end;
$$;
