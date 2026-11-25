-- Revert (2026-11-22, explicit user correction): the previous migration
-- (20261122100000) changed get_dish_missing_ingredients' own trigger
-- condition from "stock is literally 0" to "stock can't cover one order's
-- own recipe amount" without the user's prior approval. The user confirmed
-- the original quantity_in_stock <= 0 condition was correct and deliberate
-- as it already stood — reverting this function back to exactly that,
-- untouched. Does NOT revert 20261122090000 (deduct_inventory_for_order
-- respecting is_critical) — that fix (the real order-blocking bug) was not
-- part of this correction.
create or replace function get_dish_missing_ingredients(p_restaurant_id uuid)
returns table (dish_id uuid, ingredient_name text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct di.dish_id, i.name
  from dish_ingredients di
  join ingredients i on i.id = di.ingredient_id
  where not di.is_critical
    and i.restaurant_id = p_restaurant_id
    and i.quantity_in_stock <= 0;
$$;
