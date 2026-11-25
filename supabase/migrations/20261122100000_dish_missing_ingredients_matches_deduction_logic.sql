-- Real gap found live (2026-11-22, same user report as
-- 20261122090000_deduct_inventory_respects_is_critical.sql): once a
-- non-critical ingredient shortage stopped blocking orders, diners still
-- had no way to know a dish would be served without it — the diner-facing
-- note (get_dish_missing_ingredients, shown in DishDetailModal) only ever
-- triggered at literal quantity_in_stock <= 0. The real sea-bream case never
-- hit that: cherry tomatoes sat at 2.925kg, which is NOT <= 0, even though
-- it was already short of the 6kg (now corrected — see the migration file's
-- own history) this one dish alone needs. The diner saw no note at all
-- right up until the ingredient was *completely* gone, long after it had
-- already stopped being enough for even a single order of this dish.
--
-- Fix: flag a dish+ingredient the moment stock can no longer cover ONE
-- order of that dish — the exact same per-unit comparison
-- deduct_inventory_for_order itself uses to decide whether a non-critical
-- shortfall exists, just evaluated ahead of time for display rather than at
-- the moment of deduction. Strictly broader than the old check (0 stock
-- with any positive quantity_required always still matches), so every dish
-- this used to flag is still flagged — this only adds the cases it missed.
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
  left join ingredient_units iu on iu.id = di.unit_id
  where not di.is_critical
    and i.restaurant_id = p_restaurant_id
    and i.quantity_in_stock < di.quantity_required * coalesce(iu.conversion_to_stock_unit, 1);
$$;
