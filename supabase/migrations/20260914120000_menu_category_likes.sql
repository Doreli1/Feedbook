-- Feedbook Backend Schema — category-level likes, separate from dish-level
-- likes (Stage 5 real implementation, 2026-09-14).
-- Real-device feedback: liking a category card's hero image was wired to
-- dish_likes on that dish specifically — but a diner tapping like on a
-- CATEGORY card means "I like this category," not "I like this one
-- representative dish," which happened to change depending on which dish
-- the UI picked as the card's photo. Given a genuinely separate concept,
-- built as its own table rather than overloading dish_likes — mirrors that
-- table's exact shape (same PK, same RLS pattern) since it already proved
-- correct in production use today.
alter table menu_categories
  add column likes_count int not null default 0;

create table menu_category_likes (
  category_id uuid not null references menu_categories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (category_id, user_id)
);

alter table menu_category_likes enable row level security;

create policy "owner_manage_own_menu_category_likes"
  on menu_category_likes for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- security definer from the start this time — dish_likes' own trigger
-- (20260914110000/111000, same day) silently failed for a real diner
-- because a plain diner has no UPDATE grant on the parent table, and the
-- trigger ran as that diner. Same fix applied up front here instead of
-- being rediscovered.
create or replace function sync_menu_category_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    update menu_categories set likes_count = likes_count + 1 where id = new.category_id;
    return new;
  elsif TG_OP = 'DELETE' then
    update menu_categories set likes_count = greatest(likes_count - 1, 0) where id = old.category_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger trg_menu_category_likes_insert
  after insert on menu_category_likes
  for each row
  execute function sync_menu_category_likes_count();

create trigger trg_menu_category_likes_delete
  after delete on menu_category_likes
  for each row
  execute function sync_menu_category_likes_count();
