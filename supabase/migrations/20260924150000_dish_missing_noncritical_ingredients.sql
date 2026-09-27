-- Soft, non-blocking ingredient-shortage note (2026-09-24), the counterpart
-- to get_dish_critical_stock_status (20260924120000): a critical ingredient
-- going out blocks the whole dish, but a NON-critical one (lemon, a garnish
-- tomato) going out shouldn't block ordering — the user's own example — it
-- should just tell the diner, by name, that this specific ingredient won't
-- be included. Same RLS-boundary reasoning as the critical-stock RPC
-- (diners can't read ingredients/dish_ingredients directly at all) resolved
-- the same way: a narrow security definer function.
--
-- Deliberately returns the ingredient's name here (unlike the critical-stock
-- RPC, which intentionally returns only a status, never quantities or
-- names) — the user explicitly asked for the specific ingredient to be
-- named in the note, so this is a deliberate scope difference, not an
-- oversight matching the other function's more conservative default.
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
grant execute on function get_dish_missing_ingredients(uuid) to authenticated;
