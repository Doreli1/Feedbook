-- Closes a real gap the user found: a dish with multiple serving sizes
-- (dish_size_options, e.g. "350 גרם" / "700 גרם") had exactly one shared
-- ingredient recipe (dish_ingredients keyed only on dish_id) — ordering the
-- bigger size deducted the exact same ingredient quantities as the smaller
-- one, since deduct_inventory_for_order/restock_inventory_for_order_item
-- never looked at which size was actually ordered.
--
-- dish_size_option_id is optional, with shared/override semantics rather
-- than a multiplier — real dishes don't scale linearly (a sauce or garnish
-- portion often doesn't change with the meat weight):
--   * NULL  -> this requirement applies no matter which size was ordered
--              (or a dish with no sizes at all) — today's behavior,
--              unchanged for every existing row.
--   * a real dish_size_options.id -> applies only when that size was ordered.
--
-- dish_ingredients had a composite primary key (dish_id, ingredient_id) and
-- no surrogate id — needs a real id now that more than one row can exist per
-- (dish_id, ingredient_id) pair (one per size). Unlike dish_size_options,
-- nothing references a dish_ingredients row via foreign key, so this table
-- stays safe to fully replace-on-save (MenuManager.tsx's existing
-- delete-then-insert), no reconcile-by-id migration needed here.
alter table dish_ingredients drop constraint dish_ingredients_pkey;

alter table dish_ingredients
  add column id uuid primary key default uuid_generate_v4();

-- on delete cascade (not restrict, unlike order_items.dish_size_option_id):
-- a dish_ingredients row is a recipe line, not order history, so deleting a
-- size option should just drop the recipe rows tied to it.
alter table dish_ingredients
  add column dish_size_option_id uuid references dish_size_options (id) on delete cascade;

-- NULL dish_size_option_id coalesced to a sentinel so two rows for the same
-- ingredient can't silently collide within the same size (or both un-sized).
create unique index dish_ingredients_dish_ingredient_size_idx
  on dish_ingredients (dish_id, ingredient_id, coalesce(dish_size_option_id, '00000000-0000-0000-0000-000000000000'::uuid));

create or replace function deduct_inventory_for_order(p_order_id uuid)
returns table (ingredient_id uuid, below_threshold boolean)
language plpgsql
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select combined.ingredient_id, sum(combined.needed) as needed
    from (
      select di.ingredient_id, di.quantity_required * oi.quantity * coalesce(iu.conversion_to_stock_unit, 1) as needed
        from order_items oi
        join dish_ingredients di on di.dish_id = oi.dish_id
          and (di.dish_size_option_id is null or di.dish_size_option_id = oi.dish_size_option_id)
        left join ingredient_units iu on iu.id = di.unit_id
        where oi.order_id = p_order_id
      union all
      select moi.ingredient_id, moi.quantity_required * oi.quantity * coalesce(iu.conversion_to_stock_unit, 1) as needed
        from order_items oi
        join order_item_modifiers oim on oim.order_item_id = oi.id
        join modifier_option_ingredients moi on moi.modifier_option_id = oim.modifier_option_id
        left join ingredient_units iu on iu.id = moi.unit_id
        where oi.order_id = p_order_id
    ) combined
    group by combined.ingredient_id
  loop
    perform 1 from ingredients where id = r.ingredient_id for update;

    if (select quantity_in_stock from ingredients where id = r.ingredient_id) < r.needed then
      raise exception 'Insufficient stock for ingredient %', r.ingredient_id;
    end if;

    update ingredients
      set quantity_in_stock = quantity_in_stock - r.needed,
          updated_at = now()
      where id = r.ingredient_id;

    return query
      select r.ingredient_id,
             (select quantity_in_stock < threshold_quantity
              from ingredients where id = r.ingredient_id);
  end loop;
end;
$$;

create or replace function restock_inventory_for_order_item(p_order_item_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select combined.ingredient_id, sum(combined.to_restore) as to_restore
    from (
      select di.ingredient_id, di.quantity_required * oi.quantity * coalesce(iu.conversion_to_stock_unit, 1) as to_restore
        from order_items oi
        join dish_ingredients di on di.dish_id = oi.dish_id
          and (di.dish_size_option_id is null or di.dish_size_option_id = oi.dish_size_option_id)
        left join ingredient_units iu on iu.id = di.unit_id
        where oi.id = p_order_item_id
      union all
      select moi.ingredient_id, moi.quantity_required * oi.quantity * coalesce(iu.conversion_to_stock_unit, 1) as to_restore
        from order_items oi
        join order_item_modifiers oim on oim.order_item_id = oi.id
        join modifier_option_ingredients moi on moi.modifier_option_id = oim.modifier_option_id
        left join ingredient_units iu on iu.id = moi.unit_id
        where oi.id = p_order_item_id
    ) combined
    group by combined.ingredient_id
  loop
    update ingredients
      set quantity_in_stock = quantity_in_stock + r.to_restore,
          updated_at = now()
      where id = r.ingredient_id;
  end loop;
end;
$$;
