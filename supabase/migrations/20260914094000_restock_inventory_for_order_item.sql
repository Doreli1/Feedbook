-- Feedbook Backend Schema — inventory restock on order-item cancellation
-- (Stage 5 real implementation, 2026-09-14).
-- Mirrors deduct_inventory_for_order (20260830145853_transaction_functions.sql)
-- in reverse, scoped to a single order_item rather than a whole order, for
-- update-order-item's cancel path. Same deliberate limitation as
-- dish_modifier_groups' own comment: only the base dish's ingredients are
-- restocked — a modifier option with its own stock requirement is an
-- unresolved future extension, same as it is for deduction.
create or replace function restock_inventory_for_order_item(p_order_item_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select di.ingredient_id, di.quantity_required * oi.quantity as to_restore
    from order_items oi
    join dish_ingredients di on di.dish_id = oi.dish_id
    where oi.id = p_order_item_id
  loop
    update ingredients
      set quantity_in_stock = quantity_in_stock + r.to_restore,
          updated_at = now()
      where id = r.ingredient_id;
  end loop;
end;
$$;
