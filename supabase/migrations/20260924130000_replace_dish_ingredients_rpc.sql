-- Atomic replace for a dish's ingredient links (2026-09-24) — the previous
-- client-side delete-then-insert (two separate Supabase calls) wasn't
-- transactional: a real save just hit this exact gap when the insert failed
-- a unique-constraint check (dish_ingredients_dish_ingredient_size_idx,
-- duplicate ingredient once its size-specific rows collapsed to "all sizes"
-- after turning serving sizes off) and the preceding delete had already
-- committed, silently wiping every ingredient link on that dish. A single
-- plpgsql function call is one implicit transaction, so a failed insert now
-- rolls the delete back too, instead of leaving the dish with none.
--
-- Deliberately security invoker (the default — not stated below): RLS's
-- existing staff_manage_own_restaurant_dish_ingredients policy
-- (20260830145852_row_level_security.sql) must keep applying exactly as it
-- does for today's direct client delete/insert calls, not be bypassed by a
-- definer function.
create or replace function replace_dish_ingredients(p_dish_id uuid, p_rows jsonb)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from dish_ingredients where dish_id = p_dish_id;

  insert into dish_ingredients (dish_id, ingredient_id, quantity_required, unit_id, dish_size_option_id, is_critical)
  select
    p_dish_id,
    (r->>'ingredient_id')::uuid,
    (r->>'quantity_required')::numeric,
    nullif(r->>'unit_id', '')::uuid,
    nullif(r->>'dish_size_option_id', '')::uuid,
    coalesce((r->>'is_critical')::boolean, false)
  from jsonb_array_elements(p_rows) as r;
end;
$$;

grant execute on function replace_dish_ingredients(uuid, jsonb) to authenticated;
