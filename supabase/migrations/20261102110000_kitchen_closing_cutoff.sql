-- Kitchen closing cutoff (2026-11-02, user request) — a common restaurant
-- practice: the kitchen stops taking new food orders some number of
-- minutes before the restaurant's own closing time (e.g. closes at 20:00,
-- kitchen cutoff 30 min -> no new FOOD orders from 19:30, but drinks stay
-- orderable right up to closing, same as today). One number per
-- restaurant, applied uniformly across every hours rule — not a per-rule
-- setting, per the user's own framing ("זמן סגירה של המטבח... משתנה לכל
-- מסעדה לפי הגדרה שלה").
--
-- Deliberately keyed on the DISH's own section (menu_categories.section),
-- not on table_type — a food item ordered from the bar still needs real
-- kitchen prep and is just as blocked as one ordered from a regular table;
-- a pure-drink item stays orderable from either. Independent of
-- bar_is_active/restaurant_is_active: an already-seated diner at a regular
-- table keeps their session open and can keep ordering drinks past closing
-- (2026-11-02 decision, "no auto-close/no order-block for an existing
-- table session") — this cutoff only ever narrows what they can still
-- order, from "anything" to "drinks only".
alter table restaurants
  add column kitchen_closes_minutes_before integer;

alter table restaurants
  add constraint restaurants_kitchen_cutoff_check
  check (kitchen_closes_minutes_before is null or kitchen_closes_minutes_before >= 0);

-- Reuses bar_hours_active_now's own day/time-wrap evaluator by building a
-- shifted copy of `hours` whose every rule's close time is pulled earlier
-- by the cutoff, instead of re-deriving the wrap-aware day/time logic a
-- second time. No hours configured at all -> kitchen is never gated by
-- this (same "nothing configured, nothing restricted" default
-- restaurant_is_active/bar_is_active already use).
create or replace function kitchen_is_open(p_restaurant_id uuid)
returns boolean
language sql
stable
as $$
  with r as (
    select hours, coalesce(kitchen_closes_minutes_before, 0) as cutoff
    from restaurants
    where id = p_restaurant_id
  )
  select case
    when (select hours from r) is null
      or jsonb_typeof((select hours from r) -> 'rules') is distinct from 'array'
      or jsonb_array_length((select hours from r) -> 'rules') = 0
    then true
    else bar_hours_active_now(
      jsonb_set(
        (select hours from r),
        '{rules}',
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'fromDay', (rule ->> 'fromDay')::int,
                'toDay', (rule ->> 'toDay')::int,
                'open', rule ->> 'open',
                'close', to_char((rule ->> 'close')::time - ((select cutoff from r) || ' minutes')::interval, 'HH24:MI')
              )
            )
            from jsonb_array_elements((select hours from r) -> 'rules') as rule
          ),
          '[]'::jsonb
        )
      )
    )
  end;
$$;

grant execute on function kitchen_is_open(uuid) to authenticated;

-- place_order_transaction: reject the whole order (not a silent per-item
-- filter — this project has no partial-success order model) when it
-- contains any food item and the kitchen is currently closed. Checked once
-- up front, before any insert, alongside the existing SESSION_NOT_OPEN/
-- BAR_NOT_ACTIVE checks.
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

  insert into notifications (staff_id, type, title, body, related_order_id)
    select s.id, 'order_status', 'הזמנה חדשה - ' || v_label, v_item_summary || v_account_suffix, v_new_order_id
    from staff s
    where s.restaurant_id = v_restaurant_id and s.is_active;

  if v_diner_user_id is not null then
    insert into notifications (user_id, type, title, body, related_order_id, session_id)
      values (v_diner_user_id, 'order_status', 'ההזמנה נשלחה בהצלחה', v_item_summary, v_new_order_id, p_session_id);
  end if;

  return query select v_new_order_id, v_alerts, v_bar_ticket_number;
end;
$function$
