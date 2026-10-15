-- Correction to the previous migration (20261015100000): place_order_transaction
-- is overloaded — a 3-parameter version (from the original
-- 20260914130000_bar_shared_ticket_system.sql) and a 4-parameter version
-- with p_special_request (added later, 2026-10-11, for the special-request
-- feature). place-order/index.ts has only ever called the 4-parameter one;
-- the 3-param one is genuinely dead code that CREATE OR REPLACE on a
-- different argument list doesn't touch. The previous migration updated the
-- dead 3-param overload's ticket logic — verified live (two real orders from
-- the same joined participant got ticket #9 then #10 instead of both
-- reusing their join-time #7) that the real 4-param overload was completely
-- unaffected. This migration fixes the actual live function, and drops the
-- unused 3-param one so this can't happen again.

drop function if exists place_order_transaction(uuid, uuid, jsonb);

create or replace function public.place_order_transaction(p_session_id uuid, p_participant_id uuid, p_items jsonb, p_special_request text DEFAULT NULL::text)
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

  -- Fixed here (was: next_bar_ticket_number(v_restaurant_id), a fresh
  -- number per ORDER). The ticket is now assigned once per participant at
  -- join-session time and doubles as their personal account number
  -- (2026-10-15) — every order they place reuses that same number instead
  -- of minting a new one, so repeat orders from the same bar diner show one
  -- consistent ticket/account, not a different one each time.
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
    insert into notifications (user_id, type, title, body, related_order_id)
      values (v_diner_user_id, 'order_status', 'ההזמנה נשלחה בהצלחה', v_item_summary, v_new_order_id);
  end if;

  return query select v_new_order_id, v_alerts, v_bar_ticket_number;
end;
$function$;
