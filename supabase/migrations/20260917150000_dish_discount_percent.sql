-- Per-dish percentage discount: restaurant staff can mark a dish down by a
-- flat percentage. Applies uniformly to whichever price basis an order ends
-- up using (dishes.price, or a dish_size_options row when the dish has
-- sizes) — a 25% discount is 25% off any size, not just the flat price.
alter table dishes
  add column discount_percent numeric(4, 1) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100);

-- Re-snapshot unit_price with the discount applied, resolved server-side so
-- it can never be spoofed from the client. Signature (params + return type)
-- is unchanged from 20260914130000_bar_shared_ticket_system.sql's version,
-- so a plain create-or-replace is enough — no drop needed this time.
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
begin
  select ts.status, ts.restaurant_id, t.table_type
    into v_session_status, v_restaurant_id, v_table_type
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

  return query select v_new_order_id, v_alerts, v_bar_ticket_number;
end;
$$;
