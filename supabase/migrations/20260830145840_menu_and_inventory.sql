-- Feedbook Backend Schema — Domain: Menu & Inventory
-- Source: 5.Feedbook_Backend_Schema.docx §3, §14 (DDL appendix)

create table menu_categories (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  sort_order int not null default 0
);

create table dishes (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  category_id uuid not null references menu_categories (id),
  name text not null,
  description text check (char_length(description) <= 200),
  price numeric(10, 2) not null check (price >= 0),
  photo_urls text[] not null default '{}',
  allergens text[] not null default '{}',
  is_available boolean not null default true,
  likes_count int not null default 0,
  rating_avg numeric(2, 1),
  rating_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dish_likes (
  dish_id uuid not null references dishes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (dish_id, user_id)
);

create table ingredients (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  sku text not null,
  name text not null,
  unit text not null,
  quantity_in_stock numeric(10, 3) not null default 0 check (quantity_in_stock >= 0),
  threshold_quantity numeric(10, 3) not null default 0,
  supplier_info text,
  updated_at timestamptz not null default now(),
  unique (restaurant_id, sku)
);

create table dish_ingredients (
  dish_id uuid not null references dishes (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  quantity_required numeric(10, 3) not null check (quantity_required > 0),
  primary key (dish_id, ingredient_id)
);

create table purchase_orders (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id),
  quantity_ordered numeric(10, 3) not null check (quantity_ordered > 0),
  status text not null default 'pending'
    check (status in ('pending', 'received', 'cancelled')),
  created_by uuid not null references staff (id),
  created_at timestamptz not null default now(),
  received_at timestamptz
);
