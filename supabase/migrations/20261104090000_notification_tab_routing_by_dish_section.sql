-- Real bug (2026-11-04, user report): a bar order containing only drinks
-- still incremented the unread badge on the "הזמנות ומטבח" (kitchen) tab,
-- never the "בר" tab — NOTIFICATION_TYPE_TAB (Dashboard.tsx) routed every
-- type='order_status' notification to a single hardcoded tab regardless of
-- what was actually ordered. The right rule, per the user's own framing:
-- a bar order's drink items only ever need the bar tab; a bar order's food
-- items still need real kitchen prep (same menu_categories.section = 'food'
-- signal kitchen_is_open/KitchenScreen's own belongsInKitchen filter
-- already use — see 20261102110000_kitchen_closing_cutoff.sql and
-- KitchenScreen.tsx), so it also needs the kitchen tab, both at once when
-- an order mixes the two. A regular table's order is unchanged: it only
-- ever needs the kitchen tab, whether it contains food or drinks (a
-- table's own drink items never show in BarOrdersScreen either — see
-- useOrders.ts's own section comment).
--
-- Columns are nullable and only ever set on type='order_status' rows — the
-- frontend keeps using its static NOTIFICATION_TYPE_TAB map for every other
-- notification type (waiter_ack/inventory_alert), which only ever has one
-- destination tab and needs no per-row computation.
alter table notifications
  add column relates_to_kitchen boolean,
  add column relates_to_bar boolean;

-- Re-snapshot of place_order_transaction (20261102110000) — only change is
-- computing v_has_food/setting the two new columns on the staff-facing
-- insert; the diner-facing insert is untouched (diners have no tabs).
create or replace function public.place_order_transaction(p_session_id uuid, p_participant_id uuid, p_items jsonb, p_special_request text default null::text)
 returns table(order_id uuid, inventory_alerts jsonb, bar_ticket_number integer)
 language plpgsql
 set search_path to 'public'
as $function$
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
  v_discount_mode text;
  v_discount_fixed_price numeric(10, 2);
  v_size_discount_fixed_price numeric(10, 2);
  v_unit_price numeric(10, 2);
  v_new_order_item_id uuid;
  v_modifier jsonb;
  v_modifier_id uuid;
  v_variant_id uuid;
  v_modifier_price numeric(10, 2);
  v_total numeric(10, 2) := 0;
  v_item_total numeric(10, 2);
  v_alerts jsonb;
  v_item_summary text;
  v_diner_user_id uuid;
  v_label text;
  v_account_suffix text;
  v_has_food boolean;
  v_relates_to_kitchen boolean;
  v_relates_to_bar boolean;
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

  if v_table_type = 'bar' and not bar_is_active(v_restaurant_id) then
    raise exception 'BAR_NOT_ACTIVE';
  end if;

  if not kitchen_is_open(v_restaurant_id) and exists (
    select 1
    from jsonb_array_elements(p_items) as item
    join dishes d on d.id = (item ->> 'dish_id')::uuid
    join menu_categories mc on mc.id = d.category_id
    where mc.section = 'food'
  ) then
    raise exception 'KITCHEN_CLOSED';
  end if;

  if v_table_type = 'bar' then
    select sp.bar_ticket_number into v_bar_ticket_number
      from session_participants sp
      where sp.id = p_participant_id;
  end if;

  insert into orders (session_id, participant_id, bar_ticket_number, special_request)
    values (p_session_id, p_participant_id, v_bar_ticket_number, nullif(trim(p_special_request), ''))
    returning id into v_new_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_dish_id := (v_item ->> 'dish_id')::uuid;
    v_quantity := coalesce((v_item ->> 'quantity')::int, 1);
    v_size_option_id := nullif(v_item ->> 'dish_size_option_id', '')::uuid;
    v_size_discount_fixed_price := null;

    select is_available, price, discount_percent, discount_mode, discount_fixed_price
      into v_dish_is_available, v_unit_price, v_discount_percent, v_discount_mode, v_discount_fixed_price
      from dishes where id = v_dish_id;

    if v_dish_is_available is distinct from true then
      raise exception 'DISH_NOT_AVAILABLE';
    end if;

    if v_size_option_id is not null then
      select price, discount_fixed_price into v_unit_price, v_size_discount_fixed_price
        from dish_size_options
        where id = v_size_option_id and dish_id = v_dish_id;
      if v_unit_price is null then
        raise exception 'DISH_NOT_AVAILABLE';
      end if;
    end if;

    if v_size_option_id is not null and v_size_discount_fixed_price is not null then
      v_unit_price := round(v_size_discount_fixed_price);
    elsif v_size_option_id is null and v_discount_mode = 'fixed_price' and v_discount_fixed_price is not null then
      v_unit_price := round(v_discount_fixed_price);
    elsif v_discount_percent > 0 then
      v_unit_price := round(v_unit_price * (1 - v_discount_percent / 100));
    end if;

    insert into order_items (order_id, dish_id, dish_size_option_id, quantity, unit_price)
      values (v_new_order_id, v_dish_id, v_size_option_id, v_quantity, v_unit_price)
      returning id into v_new_order_item_id;

    v_item_total := v_unit_price * v_quantity;

    for v_modifier in select * from jsonb_array_elements(coalesce(v_item -> 'modifier_selections', '[]'::jsonb))
    loop
      v_modifier_id := (v_modifier ->> 'modifier_option_id')::uuid;
      v_variant_id := nullif(v_modifier ->> 'serving_variant_id', '')::uuid;

      if v_variant_id is not null then
        select price_delta into v_modifier_price
          from modifier_option_serving_variants
          where id = v_variant_id and modifier_option_id = v_modifier_id and is_active;
        if v_modifier_price is null then
          raise exception 'DISH_NOT_AVAILABLE';
        end if;
      else
        select price_delta into v_modifier_price
          from dish_modifier_options where id = v_modifier_id;
        if v_modifier_price is null then
          raise exception 'DISH_NOT_AVAILABLE';
        end if;
      end if;

      insert into order_item_modifiers (order_item_id, modifier_option_id, serving_variant_id, price_delta_at_order)
        values (v_new_order_item_id, v_modifier_id, v_variant_id, v_modifier_price);

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

  select exists (
    select 1
    from order_items oi
    join dishes d on d.id = oi.dish_id
    join menu_categories mc on mc.id = d.category_id
    where oi.order_id = v_new_order_id and mc.section = 'food'
  ) into v_has_food;

  v_relates_to_bar := (v_table_type = 'bar');
  v_relates_to_kitchen := (v_table_type is distinct from 'bar') or v_has_food;

  select user_id, sub_account_number into v_diner_user_id, v_sub_account_number
    from session_participants where id = p_participant_id;

  v_label := case when v_table_type = 'bar'
    then 'הזמנה #' || lpad(coalesce(v_bar_ticket_number, 0)::text, 4, '0')
    else 'שולחן ' || coalesce(v_table_number, '—')
  end;

  v_account_suffix := case when v_table_type = 'bar' or v_sub_account_number is null
    then ''
    else ' · חשבון ' || coalesce(v_session_account_number, '—') || '-' || v_sub_account_number
  end;

  insert into notifications (staff_id, type, title, body, related_order_id, relates_to_kitchen, relates_to_bar)
    select s.id, 'order_status', 'הזמנה חדשה - ' || v_label, v_item_summary || v_account_suffix, v_new_order_id, v_relates_to_kitchen, v_relates_to_bar
    from staff s
    where s.restaurant_id = v_restaurant_id and s.is_active;

  if v_diner_user_id is not null then
    insert into notifications (user_id, type, title, body, related_order_id, session_id)
      values (v_diner_user_id, 'order_status', 'ההזמנה נשלחה בהצלחה', v_item_summary, v_new_order_id, p_session_id);
  end if;

  return query select v_new_order_id, v_alerts, v_bar_ticket_number;
end;
$function$;

-- Re-snapshot of notify_order_item_cancelled (20261019080000) — only
-- change is joining menu_categories for the cancelled item's own section
-- and setting the same two columns (a single order_item is always exactly
-- one dish, so no "mixed order" aggregation is needed here).
create or replace function notify_order_item_cancelled(p_order_item_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_session_id uuid;
  v_diner_user_id uuid;
  v_dish_name text;
  v_dish_section text;
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
  v_relates_to_kitchen boolean;
  v_relates_to_bar boolean;
begin
  select ts.restaurant_id, ts.id, sp.user_id, d.name, oi.quantity, oi.cancellation_reason, t.table_type, t.table_number,
         o.bar_ticket_number, ts.session_account_number, sp.sub_account_number, mc.section
    into v_restaurant_id, v_session_id, v_diner_user_id, v_dish_name, v_quantity, v_cancellation_reason, v_table_type, v_table_number,
         v_bar_ticket_number, v_session_account_number, v_sub_account_number, v_dish_section
    from order_items oi
    join orders o on o.id = oi.order_id
    join session_participants sp on sp.id = o.participant_id
    join table_sessions ts on ts.id = o.session_id
    join tables t on t.id = ts.table_id
    join dishes d on d.id = oi.dish_id
    join menu_categories mc on mc.id = d.category_id
    where oi.id = p_order_item_id;

  if v_restaurant_id is null then
    return;
  end if;

  v_relates_to_bar := (v_table_type = 'bar');
  v_relates_to_kitchen := (v_table_type is distinct from 'bar') or (v_dish_section = 'food');

  v_label := case when v_table_type = 'bar'
    then 'הזמנה #' || lpad(coalesce(v_bar_ticket_number, 0)::text, 4, '0')
    else 'שולחן ' || coalesce(v_table_number, '—')
  end;

  v_reason_suffix := case when v_cancellation_reason is not null then ' — ' || v_cancellation_reason else '' end;
  v_account_suffix := case when v_table_type = 'bar' or v_sub_account_number is null
    then ''
    else ' · חשבון ' || coalesce(v_session_account_number, '—') || '-' || v_sub_account_number
  end;

  insert into notifications (staff_id, type, title, body, related_order_item_id, relates_to_kitchen, relates_to_bar)
    select s.id, 'order_status', 'הזמנה בוטלה - ' || v_label, v_quantity || 'x ' || v_dish_name || v_account_suffix || v_reason_suffix, p_order_item_id, v_relates_to_kitchen, v_relates_to_bar
    from staff s
    where s.restaurant_id = v_restaurant_id and s.is_active;

  if v_diner_user_id is not null then
    insert into notifications (user_id, type, title, body, related_order_item_id, session_id)
      values (v_diner_user_id, 'order_status', 'ההזמנה בוטלה', v_quantity || 'x ' || v_dish_name || ' בוטל בהצלחה וללא חיוב' || v_reason_suffix, p_order_item_id, v_session_id);
  end if;
end;
$$;
