-- Closes a real gap surfaced by the new add-ons admin UI: dish_modifier_groups
-- (built 2026-09-12) has always carried an explicit code comment noting that
-- a modifier option with its own stock requirement was "an unresolved future
-- extension" — inventory deduction only ever looked at the base dish's
-- dish_ingredients. Now that a restaurant can define a real add-on like
-- "אבוקדו" through the admin UI, that gap has a real consequence: ordering
-- it never touches avocado stock. This mirrors dish_ingredients exactly
-- (same shape, same RLS pattern) but keyed off a modifier option instead of
-- a dish, and extends both deduct_inventory_for_order and
-- restock_inventory_for_order_item to also account for it.
create table modifier_option_ingredients (
  modifier_option_id uuid not null references dish_modifier_options (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  quantity_required numeric(10, 3) not null check (quantity_required > 0),
  primary key (modifier_option_id, ingredient_id)
);

alter table modifier_option_ingredients enable row level security;

create policy "staff_manage_own_restaurant_modifier_option_ingredients"
  on modifier_option_ingredients for all
  using (
    modifier_option_id in (
      select o.id from dish_modifier_options o
      join dish_modifier_groups g on g.id = o.group_id
      join dishes d on d.id = g.dish_id
      where d.restaurant_id in (select current_staff_restaurant_ids())
    )
  );

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
      select di.ingredient_id, di.quantity_required * oi.quantity as needed
        from order_items oi
        join dish_ingredients di on di.dish_id = oi.dish_id
        where oi.order_id = p_order_id
      union all
      select moi.ingredient_id, moi.quantity_required * oi.quantity as needed
        from order_items oi
        join order_item_modifiers oim on oim.order_item_id = oi.id
        join modifier_option_ingredients moi on moi.modifier_option_id = oim.modifier_option_id
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
      select di.ingredient_id, di.quantity_required * oi.quantity as to_restore
        from order_items oi
        join dish_ingredients di on di.dish_id = oi.dish_id
        where oi.id = p_order_item_id
      union all
      select moi.ingredient_id, moi.quantity_required * oi.quantity as to_restore
        from order_items oi
        join order_item_modifiers oim on oim.order_item_id = oi.id
        join modifier_option_ingredients moi on moi.modifier_option_id = oim.modifier_option_id
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
