-- Real bug fix (2026-10-11, user report): update_order_item_transaction
-- (added earlier today, 20261011110000) priced an edited item off the raw
-- dishes.price / dish_size_options.price, completely ignoring any discount
-- — a discounted entrecote (e.g. ₪130 base discounted to ₪120) re-priced to
-- the raw ₪130 the moment a diner edited the item (even just to add an
-- unrelated drink), both in the order card's own total and in the account
-- bill. place_order_transaction already resolves this correctly (size-level
-- discount_fixed_price first, else dish-level fixed_price mode, else
-- percent); this is the exact same resolution, just missing here.
create or replace function update_order_item_transaction(
  p_order_item_id uuid,
  p_quantity int,
  p_dish_size_option_id uuid,
  p_modifier_selections jsonb
)
returns numeric
language plpgsql
set search_path = public
as $$
declare
  v_dish_id uuid;
  v_discount_percent numeric(4, 1);
  v_discount_mode text;
  v_discount_fixed_price numeric(10, 2);
  v_size_discount_fixed_price numeric(10, 2);
  v_unit_price numeric(10, 2);
  v_selection jsonb;
  v_modifier_id uuid;
  v_variant_id uuid;
  v_modifier_price numeric(10, 2);
begin
  select dish_id into v_dish_id from order_items where id = p_order_item_id;
  if v_dish_id is null then
    raise exception 'DISH_NOT_AVAILABLE';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'DISH_NOT_AVAILABLE';
  end if;

  select discount_percent, discount_mode, discount_fixed_price
    into v_discount_percent, v_discount_mode, v_discount_fixed_price
    from dishes where id = v_dish_id;

  v_size_discount_fixed_price := null;
  if p_dish_size_option_id is not null then
    select price, discount_fixed_price into v_unit_price, v_size_discount_fixed_price
      from dish_size_options
      where id = p_dish_size_option_id and dish_id = v_dish_id;
    if v_unit_price is null then
      raise exception 'DISH_NOT_AVAILABLE';
    end if;
  else
    select price into v_unit_price from dishes where id = v_dish_id;
  end if;

  if p_dish_size_option_id is not null and v_size_discount_fixed_price is not null then
    v_unit_price := round(v_size_discount_fixed_price);
  elsif p_dish_size_option_id is null and v_discount_mode = 'fixed_price' and v_discount_fixed_price is not null then
    v_unit_price := round(v_discount_fixed_price);
  elsif v_discount_percent > 0 then
    v_unit_price := round(v_unit_price * (1 - v_discount_percent / 100));
  end if;

  update order_items
    set dish_size_option_id = p_dish_size_option_id,
        quantity = p_quantity,
        unit_price = v_unit_price,
        edited_at = now()
    where id = p_order_item_id;

  delete from order_item_modifiers where order_item_id = p_order_item_id;

  for v_selection in select * from jsonb_array_elements(coalesce(p_modifier_selections, '[]'::jsonb))
  loop
    v_modifier_id := (v_selection ->> 'modifier_option_id')::uuid;
    v_variant_id := nullif(v_selection ->> 'serving_variant_id', '')::uuid;

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
      values (p_order_item_id, v_modifier_id, v_variant_id, v_modifier_price);
  end loop;

  return (v_unit_price * p_quantity) + coalesce(
    (select sum(price_delta_at_order) from order_item_modifiers where order_item_id = p_order_item_id) * p_quantity,
    0
  );
end;
$$;
