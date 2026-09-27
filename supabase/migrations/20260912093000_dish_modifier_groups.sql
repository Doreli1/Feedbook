-- Feedbook Backend Schema — Modifier Groups (planned 2026-09-03, migrated 2026-09-12).
-- Source: 5.Feedbook_Backend_Schema.docx §3.2 DDL comment. Replaces/extends the
-- loose order_items.modifiers jsonb column with a defined structure, migrated
-- now "together with the ordering module" (Stage 5) per that comment's own
-- instruction.
create table dish_modifier_groups (
  id uuid primary key default uuid_generate_v4(),
  dish_id uuid not null references dishes (id) on delete cascade,
  name text not null,
  selection_type text not null check (selection_type in ('single', 'multiple')),
  is_required boolean not null default false,
  sort_order int not null default 0
);

create table dish_modifier_options (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references dish_modifier_groups (id) on delete cascade,
  name text not null,
  -- 0 = included in the dish price, positive = a paid add-on.
  price_delta numeric(10, 2) not null default 0,
  sort_order int not null default 0
);

create table order_item_modifiers (
  order_item_id uuid not null references order_items (id) on delete cascade,
  modifier_option_id uuid not null references dish_modifier_options (id),
  -- Price snapshot at order time, in case the restaurant changes pricing later.
  price_delta_at_order numeric(10, 2) not null,
  primary key (order_item_id, modifier_option_id)
);

-- Final order-item price = order_items.unit_price + sum of all selected
-- price_delta_at_order. Deliberate limitation: no link between a modifier
-- option and inventory deduction (dish_ingredients) — only the base dish is
-- deducted from JIT stock; a modifier option with its own stock requirement
-- is an unresolved future extension.

alter table dish_modifier_groups enable row level security;
alter table dish_modifier_options enable row level security;
alter table order_item_modifiers enable row level security;

create policy "staff_manage_own_restaurant_dish_modifier_groups"
  on dish_modifier_groups for all
  using (
    dish_id in (
      select id from dishes
      where restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "public_read_available_dish_modifier_groups"
  on dish_modifier_groups for select
  using (
    dish_id in (select id from dishes where is_available = true)
  );

create policy "staff_manage_own_restaurant_dish_modifier_options"
  on dish_modifier_options for all
  using (
    group_id in (
      select g.id from dish_modifier_groups g
      join dishes d on d.id = g.dish_id
      where d.restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "public_read_available_dish_modifier_options"
  on dish_modifier_options for select
  using (
    group_id in (
      select g.id from dish_modifier_groups g
      join dishes d on d.id = g.dish_id
      where d.is_available = true
    )
  );

create policy "staff_manage_own_restaurant_order_item_modifiers"
  on order_item_modifiers for all
  using (
    order_item_id in (
      select oi.id from order_items oi
      join orders o on o.id = oi.order_id
      join table_sessions ts on ts.id = o.session_id
      where ts.restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "participant_manage_own_order_item_modifiers"
  on order_item_modifiers for all
  using (
    order_item_id in (
      select oi.id from order_items oi
      join orders o on o.id = oi.order_id
      where o.participant_id in (select id from session_participants where user_id = auth.uid())
    )
  )
  with check (
    order_item_id in (
      select oi.id from order_items oi
      join orders o on o.id = oi.order_id
      where o.participant_id in (select id from session_participants where user_id = auth.uid())
    )
  );
