-- Addon/modifier-option-level ingredient shortage (2026-09-24) — found via a
-- real device test: "אורז לבן" (a "תוספות למנה" addon option on the test
-- steak) was dropped to 0 stock, and neither get_dish_critical_stock_status
-- nor get_dish_missing_ingredients caught it, because both only ever look at
-- dish_ingredients (the dish's own base recipe) — an addon option's
-- ingredient link lives in the completely separate modifier_option_ingredients
-- table, which has no is_critical concept at all.
--
-- Per the user's explicit choice: unlike a missing base ingredient (which
-- gets a dish-level note or blocks the whole dish), a specific addon OPTION
-- running out should just disable/gray that one option in its picker — the
-- diner picks a different option in the same group instead (e.g. פירה/סלט),
-- the dish itself is unaffected. So this doesn't need a critical/non-critical
-- split the way dish_ingredients does: any option whose linked ingredient
-- hits zero becomes unavailable, full stop.
create or replace function get_unavailable_modifier_options(p_restaurant_id uuid)
returns table (option_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select distinct moi.modifier_option_id
  from modifier_option_ingredients moi
  join ingredients i on i.id = moi.ingredient_id
  where i.restaurant_id = p_restaurant_id
    and i.quantity_in_stock <= 0;
$$;
grant execute on function get_unavailable_modifier_options(uuid) to authenticated;

-- Same systemic realtime-publication gap as 20260924140000 — this table was
-- never added either, so a subscription to it would have been silently
-- inert too.
alter publication supabase_realtime add table modifier_option_ingredients;
