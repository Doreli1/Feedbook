-- Closes the second gap the user raised: an ingredient is bought/stocked in
-- one unit (e.g. "ק"ג") but a recipe may reasonably want to write its
-- requirement in a different, more natural unit (e.g. "יחידה" — 3 tomatoes
-- per steak). Until now there was exactly one unit per ingredient, used
-- identically for stock and for every recipe that referenced it, with no
-- way to convert between the two.
--
-- Design: each ingredient can define zero or more alternate units, each
-- carrying a conversion factor back to the ingredient's own stock unit
-- (ingredients.unit, unchanged). A recipe row (dish_ingredients or
-- modifier_option_ingredients) optionally points at one of these — when it
-- does, its quantity_required is interpreted in THAT unit, and inventory
-- deduction/restock multiply by the conversion factor before touching
-- quantity_in_stock. Leaving unit_id null (the default, and the only
-- option before this migration) keeps quantity_required in the
-- ingredient's own stock unit exactly as it already worked — fully
-- backward compatible with every existing row.
create table ingredient_units (
  id uuid primary key default uuid_generate_v4(),
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  name text not null,
  -- 1 unit of `name` = this many of the ingredient's own stock unit
  -- (e.g. name='יחידה', conversion_to_stock_unit=0.15 for a ק"ג-stocked
  -- tomato averaging 150g each).
  conversion_to_stock_unit numeric(12, 6) not null check (conversion_to_stock_unit > 0),
  sort_order int not null default 0
);

alter table ingredient_units enable row level security;

create policy "staff_manage_own_restaurant_ingredient_units"
  on ingredient_units for all
  using (
    ingredient_id in (
      select id from ingredients
      where restaurant_id in (select current_staff_restaurant_ids())
    )
  );

-- on delete restrict (not cascade/set null): silently reinterpreting an
-- existing recipe's quantity in the wrong unit the moment its chosen unit
-- is deleted would be a silent correctness bug, not a convenience — force
-- the restaurant to fix the recipe row first.
alter table dish_ingredients
  add column unit_id uuid references ingredient_units (id) on delete restrict;

alter table modifier_option_ingredients
  add column unit_id uuid references ingredient_units (id) on delete restrict;

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
