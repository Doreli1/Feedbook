-- Feedbook Backend Schema — atomic place-order transaction (Stage 5 real
-- implementation, 2026-09-14).
-- Source: API Specification §7.1 — place-order must create an order + its
-- items + modifiers and call deduct_inventory_for_order() (§11.1) inside a
-- single transaction, so an insufficient-stock failure rolls back the whole
-- order rather than leaving a partial one behind. plpgsql already gives a
-- function body this guarantee (an unhandled exception aborts the entire
-- function's effects), same as deduct_inventory_for_order/calculate_bill_split
-- (20260830145853_transaction_functions.sql) — no explicit BEGIN/COMMIT
-- needed. This function is the Edge Function layer's only write path; the
-- place-order Edge Function itself (not this function) is where caller
-- identity/Bearer-token auth and is_required modifier-group validation
-- happen, matching the existing join-session/scan-qr split of
-- responsibilities (service-role Edge Function validates and orchestrates,
-- SQL function guarantees atomicity).
--
-- p_items shape: [{ "dish_id": uuid, "quantity": int,
--                    "dish_size_option_id": uuid | null,
--                    "modifier_option_ids": [uuid, ...] }]
create or replace function place_order_transaction(
  p_session_id uuid,
  p_participant_id uuid,
  p_items jsonb
)
returns table (order_id uuid, inventory_alerts jsonb)
language plpgsql
set search_path = public
as $$
declare
  v_session_status text;
  v_new_order_id uuid;
  v_item jsonb;
  v_dish_id uuid;
  v_quantity int;
  v_size_option_id uuid;
  v_dish_is_available boolean;
  v_unit_price numeric(10, 2);
  v_new_order_item_id uuid;
  v_modifier_id uuid;
  v_modifier_price numeric(10, 2);
  v_total numeric(10, 2) := 0;
  v_item_total numeric(10, 2);
  v_alerts jsonb;
begin
  select status into v_session_status from table_sessions where id = p_session_id for update;
  if v_session_status is distinct from 'open' then
    raise exception 'SESSION_NOT_OPEN';
  end if;

  insert into orders (session_id, participant_id)
    values (p_session_id, p_participant_id)
    returning id into v_new_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_dish_id := (v_item ->> 'dish_id')::uuid;
    v_quantity := coalesce((v_item ->> 'quantity')::int, 1);
    v_size_option_id := nullif(v_item ->> 'dish_size_option_id', '')::uuid;

    select is_available, price into v_dish_is_available, v_unit_price
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

  -- Stub hold per order_holds' own design (20260912094000_order_holds.sql):
  -- gateway_hold_ref stays null and status stays 'held' until Stage 6 wires
  -- up the real Tranzila authorization call.
  insert into order_holds (order_id, participant_id, amount)
    values (v_new_order_id, p_participant_id, v_total);

  return query select v_new_order_id, v_alerts;
end;
$$;
