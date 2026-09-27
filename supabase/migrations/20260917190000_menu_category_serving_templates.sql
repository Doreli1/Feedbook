-- Per-category serving-option templates (2026-09-17). Real request from
-- restaurant usage: a category like "יינות משובחים" needs a shared set of
-- serving alternatives ("כוסית"/"בקבוק") that every dish in it offers, with
-- only the price differing per dish — and editing the template (renaming an
-- alternative, adding a new one) should propagate live to every dish
-- already in that category, confirmed explicitly with the user rather than
-- assumed. This lives on menu_categories, not a separate "drink type"
-- entity — the user's own words: "הכל עובד לפי סגמנטים של מנות/שתייה", i.e.
-- the category itself already IS the "type."
create table menu_category_serving_options (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid not null references menu_categories (id) on delete cascade,
  name text not null,
  sort_order int not null default 0
);

alter table menu_category_serving_options enable row level security;

create policy "public_read_menu_category_serving_options"
  on menu_category_serving_options for select
  using (
    category_id in (
      select id from menu_categories
      where restaurant_id in (select id from restaurants where onboarding_status = 'approved')
    )
  );

create policy "staff_manage_own_restaurant_menu_category_serving_options"
  on menu_category_serving_options for all
  using (
    category_id in (
      select id from menu_categories
      where restaurant_id in (select current_staff_restaurant_ids())
    )
  );

-- dish_size_options rows can now optionally be "instances" of a category
-- template slot instead of fully free-text per dish. `price` becomes
-- nullable to represent "this dish hasn't priced this alternative yet" —
-- explicitly confirmed behavior when a new alternative is added to a
-- template with existing dishes already in the category: it should appear
-- everywhere unpriced, not silently default to free or 0 (0 is a legitimate
-- real price for a complimentary item, so it can't double as "unset").
-- Free-text rows (dishes in a category with no template) are unaffected —
-- category_serving_option_id stays null and price stays required for them,
-- enforced by the trigger below rather than a blanket NOT NULL.
alter table dish_size_options
  add column category_serving_option_id uuid references menu_category_serving_options (id) on delete cascade,
  alter column price drop not null;

create or replace function enforce_dish_size_option_price_required() returns trigger
language plpgsql
as $$
begin
  if new.category_serving_option_id is null and new.price is null then
    raise exception 'PRICE_REQUIRED_FOR_FREE_TEXT_SIZE_OPTION';
  end if;
  return new;
end;
$$;

create trigger dish_size_options_price_required
  before insert or update on dish_size_options
  for each row execute function enforce_dish_size_option_price_required();

-- Renaming (or otherwise editing) a template slot propagates live to every
-- dish already using it — the whole point of a shared template per the
-- user's explicit confirmation, not a one-time copy.
create or replace function sync_dish_size_options_from_category_template() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update dish_size_options
      set name = new.name
      where category_serving_option_id = new.id;
  end if;
  return new;
end;
$$;

create trigger menu_category_serving_options_sync_name
  after update on menu_category_serving_options
  for each row execute function sync_dish_size_options_from_category_template();

-- Adding a new alternative to a category that already has dishes: it must
-- show up, unpriced, on every existing dish in that category (explicitly
-- confirmed) rather than requiring staff to notice and add it per dish.
create or replace function add_serving_option_to_existing_dishes() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into dish_size_options (dish_id, name, price, is_default, sort_order, category_serving_option_id)
  select d.id, new.name, null, false, new.sort_order, new.id
    from dishes d
    where d.category_id = new.category_id;
  return new;
end;
$$;

create trigger menu_category_serving_options_seed_dishes
  after insert on menu_category_serving_options
  for each row execute function add_serving_option_to_existing_dishes();
