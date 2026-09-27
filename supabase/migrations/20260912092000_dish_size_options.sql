-- Feedbook Backend Schema — multi-size/multi-price dishes (Stage 5 alignment, 2026-09-12).
-- Source: PRD §5.2.3 / §9 addendum 2026-09-12 (Booking.com-style menu richness).
--
-- Dishes with no sizes simply have zero rows here and keep using
-- dishes.price / order_items.unit_price directly, unchanged.
create table dish_size_options (
  id uuid primary key default uuid_generate_v4(),
  dish_id uuid not null references dishes (id) on delete cascade,
  name text not null,
  price numeric(10, 2) not null check (price >= 0),
  is_default boolean not null default false,
  sort_order int not null default 0
);

-- At most one default size per dish.
create unique index dish_size_options_one_default
  on dish_size_options (dish_id)
  where is_default;

alter table order_items
  add column dish_size_option_id uuid references dish_size_options (id);

alter table dish_size_options enable row level security;

create policy "staff_manage_own_restaurant_dish_size_options"
  on dish_size_options for all
  using (
    dish_id in (
      select id from dishes
      where restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "public_read_available_dish_size_options"
  on dish_size_options for select
  using (
    dish_id in (select id from dishes where is_available = true)
  );
