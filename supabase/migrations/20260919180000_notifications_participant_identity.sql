-- Requested 2026-09-19: if several diners at the same table cancel/order
-- around the same time, "שולחן X" alone doesn't tell staff which specific
-- diner it was — table_sessions.session_account_number (the whole table's
-- shared bill) and session_participants.sub_account_number (this diner's
-- own line on it) already exist for exactly this purpose (Stage 5's
-- bill-splitting model) but were never surfaced anywhere in the kitchen-
-- facing UI, notifications included. Added to both notification functions'
-- bodies; a following migration does the same for the live queue/history
-- screens, since the gap is in the whole kitchen UI, not just notifications.

-- Re-snapshot of place_order_transaction (20260919170000) — adds the
-- participant's account numbers to both notification bodies.
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
  v_session_account_number text;
  v_sub_account_number text;
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
  v_account_suffix text;
begin
  select ts.status, ts.restaurant_id, t.table_type, t.table_number, ts.session_account_number
    into v_session_status, v_restaurant_id, v_table_type, v_table_number, v_session_account_number
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

  select string_agg(oi.quantity || 'x ' || d.name, ', ' order by d.name)
    into v_item_summary
    from order_items oi
    join dishes d on d.id = oi.dish_id
    where oi.order_id = v_new_order_id;

  select user_id, sub_account_number into v_diner_user_id, v_sub_account_number
    from session_participants where id = p_participant_id;

  v_label := case when v_table_type = 'bar'
    then 'הזמנה #' || lpad(coalesce(v_bar_ticket_number, 0)::text, 4, '0')
    else 'שולחן ' || coalesce(v_table_number, '—')
  end;

  -- Bar orders already carry their own distinct identifier (the pickup
  -- ticket) — the account-number suffix is for table orders, where several
  -- diners genuinely do share one "שולחן X" label and need telling apart.
  v_account_suffix := case when v_table_type = 'bar' or v_sub_account_number is null
    then ''
    else ' · חשבון ' || coalesce(v_session_account_number, '—') || '-' || v_sub_account_number
  end;

  insert into notifications (staff_id, type, title, body, related_order_id)
    select s.id, 'order_status', 'הזמנה חדשה - ' || v_label, v_item_summary || v_account_suffix, v_new_order_id
    from staff s
    where s.restaurant_id = v_restaurant_id and s.is_active;

  if v_diner_user_id is not null then
    insert into notifications (user_id, type, title, body, related_order_id)
      values (v_diner_user_id, 'order_status', 'ההזמנה נשלחה בהצלחה', v_item_summary, v_new_order_id);
  end if;

  return query select v_new_order_id, v_alerts, v_bar_ticket_number;
end;
$$;

-- Re-snapshot of notify_order_item_cancelled (20260919150000) — same
-- account-number suffix added to the staff-facing body.
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
  v_cancellation_reason text;
  v_table_type text;
  v_table_number text;
  v_session_account_number text;
  v_sub_account_number text;
  v_bar_ticket_number int;
  v_label text;
  v_reason_suffix text;
  v_account_suffix text;
begin
  select ts.restaurant_id, sp.user_id, d.name, oi.quantity, oi.cancellation_reason, t.table_type, t.table_number,
         o.bar_ticket_number, ts.session_account_number, sp.sub_account_number
    into v_restaurant_id, v_diner_user_id, v_dish_name, v_quantity, v_cancellation_reason, v_table_type, v_table_number,
         v_bar_ticket_number, v_session_account_number, v_sub_account_number
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

  v_reason_suffix := case when v_cancellation_reason is not null then ' — ' || v_cancellation_reason else '' end;
  v_account_suffix := case when v_table_type = 'bar' or v_sub_account_number is null
    then ''
    else ' · חשבון ' || coalesce(v_session_account_number, '—') || '-' || v_sub_account_number
  end;

  insert into notifications (staff_id, type, title, body, related_order_item_id)
    select s.id, 'order_status', 'הזמנה בוטלה - ' || v_label, v_quantity || 'x ' || v_dish_name || v_account_suffix || v_reason_suffix, p_order_item_id
    from staff s
    where s.restaurant_id = v_restaurant_id and s.is_active;

  if v_diner_user_id is not null then
    insert into notifications (user_id, type, title, body, related_order_item_id)
      values (v_diner_user_id, 'order_status', 'ההזמנה בוטלה', v_quantity || 'x ' || v_dish_name || ' בוטל בהצלחה וללא חיוב' || v_reason_suffix, p_order_item_id);
  end if;
end;
$$;
