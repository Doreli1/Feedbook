-- Feedbook Backend Schema — atomic order-item update (Stage 5 real
-- implementation, 2026-09-14).
-- Source: API Specification §7.2 — update-order-item's "update" action
-- re-prices an item after a size/modifier change. Unlike place-order, this
-- never touches JIT inventory: dish_ingredients links to dish_id, and
-- dish_modifier_groups' own comment already documents that modifier options
-- carry no inventory requirement of their own — so changing size/modifiers
-- only ever changes price, never stock. Swapping order_item_modifiers rows
-- and updating unit_price together as one function call keeps that swap
-- atomic (no window where the row set is briefly inconsistent).
create or replace function update_order_item_transaction(
  p_order_item_id uuid,
  p_dish_size_option_id uuid,
  p_modifier_option_ids jsonb
)
returns numeric
language plpgsql
set search_path = public
as $$
declare
  v_dish_id uuid;
  v_unit_price numeric(10, 2);
  v_modifier_id uuid;
  v_modifier_price numeric(10, 2);
begin
  select dish_id into v_dish_id from order_items where id = p_order_item_id;
  if v_dish_id is null then
    raise exception 'DISH_NOT_AVAILABLE';
  end if;

  if p_dish_size_option_id is not null then
    select price into v_unit_price
      from dish_size_options
      where id = p_dish_size_option_id and dish_id = v_dish_id;
    if v_unit_price is null then
      raise exception 'DISH_NOT_AVAILABLE';
    end if;
  else
    select price into v_unit_price from dishes where id = v_dish_id;
  end if;

  update order_items
    set dish_size_option_id = p_dish_size_option_id, unit_price = v_unit_price
    where id = p_order_item_id;

  delete from order_item_modifiers where order_item_id = p_order_item_id;

  for v_modifier_id in
    select jsonb_array_elements_text(coalesce(p_modifier_option_ids, '[]'::jsonb))::uuid
  loop
    select price_delta into v_modifier_price
      from dish_modifier_options where id = v_modifier_id;
    if v_modifier_price is null then
      raise exception 'DISH_NOT_AVAILABLE';
    end if;

    insert into order_item_modifiers (order_item_id, modifier_option_id, price_delta_at_order)
      values (p_order_item_id, v_modifier_id, v_modifier_price);
  end loop;

  return v_unit_price + coalesce(
    (select sum(price_delta_at_order) from order_item_modifiers where order_item_id = p_order_item_id),
    0
  );
end;
$$;
