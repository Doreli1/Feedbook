-- Drink add-on serving-format choice (2026-09-29): a specific drink add-on
-- option (e.g. "בירה") can optionally offer bottle (בקבוק) vs. draft (חבית)
-- with a size (half-liter/third/liter) — each format with its own price and
-- its own ingredient-deduction quantity. Explicit design decisions: opt-in
-- PER OPTION (not every drink add-on has this), separate price per format,
-- separate ingredient quantity per format.
--
-- Mirrors dish_size_options exactly, just scoped to a dish_modifier_options
-- row instead of a dishes row — including is_active from day one (the
-- soft-delete lesson from 20260929090000_dish_size_options_soft_delete.sql:
-- once a variant has been ordered, order_item_modifiers.serving_variant_id
-- references it with no ON DELETE clause, so a hard delete would eventually
-- hit the exact same FK conflict). No new boolean flag on
-- dish_modifier_options for "has variants" — like servingOptionsEnabled for
-- dishes, that's a pure derived UI affordance (does this option have any
-- active variant rows?), not a separately stored column.
create table modifier_option_serving_variants (
  id uuid primary key default uuid_generate_v4(),
  modifier_option_id uuid not null references dish_modifier_options (id) on delete cascade,
  name text not null,
  price_delta numeric(10, 2) not null default 0,
  sort_order int not null default 0,
  is_active boolean not null default true
);

alter table modifier_option_serving_variants enable row level security;

create policy "staff_manage_own_restaurant_modifier_option_serving_variants"
  on modifier_option_serving_variants for all
  using (
    modifier_option_id in (
      select o.id from dish_modifier_options o
      join dish_modifier_groups g on g.id = o.group_id
      join dishes d on d.id = g.dish_id
      where d.restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "public_read_available_modifier_option_serving_variants"
  on modifier_option_serving_variants for select
  using (
    is_active
    and modifier_option_id in (
      select o.id from dish_modifier_options o
      join dish_modifier_groups g on g.id = o.group_id
      join dishes d on d.id = g.dish_id
      where d.is_available = true
    )
  );

-- modifier_option_ingredients: add optional variant scoping, mirroring
-- dish_ingredients.dish_size_option_id exactly (see
-- 20260924100000_dish_ingredients_per_size_option.sql for the identical
-- pattern and its own reasoning). NULL = applies regardless of which format
-- was ordered (or an option with no variants at all) — unchanged behavior
-- for every existing row.
alter table modifier_option_ingredients drop constraint modifier_option_ingredients_pkey;

alter table modifier_option_ingredients
  add column id uuid primary key default uuid_generate_v4();

alter table modifier_option_ingredients
  add column serving_variant_id uuid references modifier_option_serving_variants (id) on delete cascade;

create unique index modifier_option_ingredients_option_ingredient_variant_idx
  on modifier_option_ingredients (modifier_option_id, ingredient_id, coalesce(serving_variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- order_item_modifiers: which format was actually chosen for this order
-- line's modifier selection. No ON DELETE clause (restrict) — matches
-- order_items.dish_size_option_id exactly: real order history must keep
-- pointing at a real row.
alter table order_item_modifiers
  add column serving_variant_id uuid references modifier_option_serving_variants (id);

-- place_order_transaction: modifier_option_ids (bare uuid array) becomes
-- modifier_selections ({modifier_option_id, serving_variant_id}[]) — a
-- variant's price is looked up server-side from
-- modifier_option_serving_variants, exactly the same "never trust a
-- client-sent price" rule already applied to dish_modifier_options.price_delta
-- itself. Same signature/return type as the current function (see
-- 20260919180000_notifications_participant_identity.sql for the full prior
-- body) — only the p_items modifier shape and the per-modifier loop change.
create or replace function place_order_transaction(
  p_session_id uuid,
  p_participant_id uuid,
  p_items jsonb
)
returns table (order_id uuid, inventory_alerts jsonb, bar_ticket_number int)
language plpgsql
set search_path = public
as $$
declare
  v_session_status text;
  v_restaurant_id uuid;
  v_table_type text;
  v_table_number text;
  v_session_account_number text;
  v_sub_account_number text;
  v_bar_ticket_number int;
  v_new_order_id uuid;
  v_item jsonb;
  v_dish_id uuid;
  v_quantity int;
  v_size_option_id uuid;
  v_dish_is_available boolean;
  v_discount_percent numeric(4, 1);
  v_unit_price numeric(10, 2);
  v_new_order_item_id uuid;
  v_modifier jsonb;
  v_modifier_id uuid;
  v_variant_id uuid;
  v_modifier_price numeric(10, 2);
  v_total numeric(10, 2) := 0;
  v_item_total numeric(10, 2);
  v_alerts jsonb;
  v_item_summary text;
  v_diner_user_id uuid;
  v_label text;
  v_account_suffix text;
begin
  select ts.status, ts.restaurant_id, t.table_type, t.table_number, ts.session_account_number
    into v_session_status, v_restaurant_id, v_table_type, v_table_number, v_session_account_number
    from table_sessions ts
    join tables t on t.id = ts.table_id
    where ts.id = p_session_id
    for update of ts;

  if v_session_status is distinct from 'open' then
    raise exception 'SESSION_NOT_OPEN';
  end if;

  if v_table_type = 'bar' then
    v_bar_ticket_number := next_bar_ticket_number(v_restaurant_id);
  end if;

  insert into orders (session_id, participant_id, bar_ticket_number)
    values (p_session_id, p_participant_id, v_bar_ticket_number)
    returning id into v_new_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_dish_id := (v_item ->> 'dish_id')::uuid;
    v_quantity := coalesce((v_item ->> 'quantity')::int, 1);
    v_size_option_id := nullif(v_item ->> 'dish_size_option_id', '')::uuid;

    select is_available, price, discount_percent into v_dish_is_available, v_unit_price, v_discount_percent
      from dishes where id = v_dish_id;

    if v_dish_is_available is distinct from true then
      raise exception 'DISH_NOT_AVAILABLE';
    end if;

    if v_size_option_id is not null then
      select price into v_unit_price
        from dish_size_options
        where id = v_size_option_id and dish_id = v_dish_id;
      if v_unit_price is null then
        raise exception 'DISH_NOT_AVAILABLE';
      end if;
    end if;

    if v_discount_percent > 0 then
      v_unit_price := round(v_unit_price * (1 - v_discount_percent / 100), 2);
    end if;

    insert into order_items (order_id, dish_id, dish_size_option_id, quantity, unit_price)
      values (v_new_order_id, v_dish_id, v_size_option_id, v_quantity, v_unit_price)
      returning id into v_new_order_item_id;

    v_item_total := v_unit_price * v_quantity;

    for v_modifier in select * from jsonb_array_elements(coalesce(v_item -> 'modifier_selections', '[]'::jsonb))
    loop
      v_modifier_id := (v_modifier ->> 'modifier_option_id')::uuid;
      v_variant_id := nullif(v_modifier ->> 'serving_variant_id', '')::uuid;

      if v_variant_id is not null then
        select price_delta into v_modifier_price
          from modifier_option_serving_variants
          where id = v_variant_id and modifier_option_id = v_modifier_id and is_active;
        if v_modifier_price is null then
          raise exception 'DISH_NOT_AVAILABLE';
        end if;
      else
        select price_delta into v_modifier_price
          from dish_modifier_options where id = v_modifier_id;
        if v_modifier_price is null then
          raise exception 'DISH_NOT_AVAILABLE';
        end if;
      end if;

      insert into order_item_modifiers (order_item_id, modifier_option_id, serving_variant_id, price_delta_at_order)
        values (v_new_order_item_id, v_modifier_id, v_variant_id, v_modifier_price);

      v_item_total := v_item_total + (v_modifier_price * v_quantity);
    end loop;

    v_total := v_total + v_item_total;
  end loop;

  select coalesce(
    jsonb_agg(jsonb_build_object('ingredient_id', d.ingredient_id, 'below_threshold', d.below_threshold))
      filter (where d.below_threshold),
    '[]'::jsonb
  )
  into v_alerts
  from deduct_inventory_for_order(v_new_order_id) d;

  insert into order_holds (order_id, participant_id, amount)
    values (v_new_order_id, p_participant_id, v_total);

  select string_agg(oi.quantity || 'x ' || d.name, ', ' order by d.name)
    into v_item_summary
    from order_items oi
    join dishes d on d.id = oi.dish_id
    where oi.order_id = v_new_order_id;

  select user_id, sub_account_number into v_diner_user_id, v_sub_account_number
    from session_participants where id = p_participant_id;

  v_label := case when v_table_type = 'bar'
    then 'הזמנה #' || lpad(coalesce(v_bar_ticket_number, 0)::text, 4, '0')
    else 'שולחן ' || coalesce(v_table_number, '—')
  end;

  v_account_suffix := case when v_table_type = 'bar' or v_sub_account_number is null
    then ''
    else ' · חשבון ' || coalesce(v_session_account_number, '—') || '-' || v_sub_account_number
  end;

  insert into notifications (staff_id, type, title, body, related_order_id)
    select s.id, 'order_status', 'הזמנה חדשה - ' || v_label, v_item_summary || v_account_suffix, v_new_order_id
    from staff s
    where s.restaurant_id = v_restaurant_id and s.is_active;

  if v_diner_user_id is not null then
    insert into notifications (user_id, type, title, body, related_order_id)
      values (v_diner_user_id, 'order_status', 'ההזמנה נשלחה בהצלחה', v_item_summary, v_new_order_id);
  end if;

  return query select v_new_order_id, v_alerts, v_bar_ticket_number;
end;
$$;

-- deduct_inventory_for_order / restock_inventory_for_order_item: scope
-- modifier_option_ingredients by the variant actually ordered, mirroring
-- dish_ingredients' own dish_size_option_id scoping exactly.
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
          and (moi.serving_variant_id is null or moi.serving_variant_id = oim.serving_variant_id)
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
          and (moi.serving_variant_id is null or moi.serving_variant_id = oim.serving_variant_id)
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
