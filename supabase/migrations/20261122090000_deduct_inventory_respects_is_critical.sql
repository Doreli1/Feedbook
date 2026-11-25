-- Real bug found live (2026-11-22, user report): a dish with a NON-critical
-- ingredient running short (dish_ingredients.is_critical = false — "a
-- garnish tomato", the user's own example from
-- 20260924150000_dish_missing_noncritical_ingredients.sql) became fully
-- unorderable, exactly the outcome that design was supposed to prevent
-- ("a critical ingredient going out blocks the whole dish, but a
-- NON-critical one going out shouldn't block ordering — it should just tell
-- the diner, by name, that this specific ingredient won't be included").
--
-- Root cause: deduct_inventory_for_order (called from place_order_
-- transaction at the moment an order is actually placed) was never updated
-- when is_critical/get_dish_missing_ingredients shipped — it raised
-- 'Insufficient stock' for ANY ingredient shortfall, critical or not,
-- blocking orders that per the documented design should have gone through
-- missing only the non-critical item. modifier_option_ingredients has no
-- is_critical column at all (deliberately — see that migration's own
-- comment: "an optional extra running low shouldn't flag the whole dish as
-- almost-out"), so every modifier-sourced need is treated the same as a
-- non-critical dish_ingredients one here: never blocking.
--
-- Fix: the "needed" aggregate per ingredient is now split into its
-- critical-sourced and total portions. A critical shortfall still blocks
-- the whole order, exactly as before (same exception, same message, no
-- client-side change needed). A non-critical shortfall no longer blocks —
-- stock is deducted down to whatever's actually available (capped, never
-- negative), the rest of that ingredient's portion simply isn't taken from
-- stock, matching "this specific ingredient won't be included".
create or replace function deduct_inventory_for_order(p_order_id uuid)
returns table (ingredient_id uuid, below_threshold boolean)
language plpgsql
set search_path to 'public'
as $function$
declare
  r record;
  v_available numeric;
  v_critical_needed numeric;
  v_to_deduct numeric;
begin
  for r in
    select combined.ingredient_id,
      coalesce(sum(combined.needed) filter (where combined.is_critical), 0) as critical_needed,
      sum(combined.needed) as total_needed
    from (
      select di.ingredient_id, di.quantity_required * oi.quantity * coalesce(iu.conversion_to_stock_unit, 1) as needed, di.is_critical
        from order_items oi
        join dish_ingredients di on di.dish_id = oi.dish_id
          and (di.dish_size_option_id is null or di.dish_size_option_id = oi.dish_size_option_id)
        left join ingredient_units iu on iu.id = di.unit_id
        where oi.order_id = p_order_id
      union all
      select moi.ingredient_id, moi.quantity_required * oi.quantity * coalesce(iu.conversion_to_stock_unit, 1) as needed, false as is_critical
        from order_items oi
        join order_item_modifiers oim on oim.order_item_id = oi.id
        join modifier_option_ingredients moi on moi.modifier_option_id = oim.modifier_option_id
          and (moi.serving_variant_id is null or moi.serving_variant_id = oim.serving_variant_id)
        left join ingredient_units iu on iu.id = moi.unit_id
        where oi.order_id = p_order_id
    ) combined
    group by combined.ingredient_id
  loop
    perform 1 from ingredients where id = r.ingredient_id for update;
    select quantity_in_stock into v_available from ingredients where id = r.ingredient_id;

    v_critical_needed := r.critical_needed;

    if v_available < v_critical_needed then
      raise exception 'Insufficient stock for ingredient %', r.ingredient_id;
    end if;

    v_to_deduct := least(v_available, r.total_needed);

    update ingredients
      set quantity_in_stock = quantity_in_stock - v_to_deduct,
          updated_at = now()
      where id = r.ingredient_id;

    return query
      select r.ingredient_id,
             (select quantity_in_stock < threshold_quantity
              from ingredients where id = r.ingredient_id);
  end loop;
end;
$function$;
