-- Feedbook Backend Schema — keep dishes.likes_count in sync with dish_likes
-- (Stage 5 real implementation, 2026-09-14).
-- dish_likes(dish_id, user_id) already exists with per-user RLS
-- (owner_manage_own_dish_likes — a diner can insert/delete only their own
-- row, exactly what a real toggle-like button needs), but nothing ever kept
-- dishes.likes_count in sync with it — the column existed but no trigger,
-- Edge Function, or app code ever wrote to it. Mirrors the
-- order_items.status_updated_at trigger pattern from earlier the same day.
create or replace function sync_dish_likes_count()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    update dishes set likes_count = likes_count + 1 where id = new.dish_id;
    return new;
  elsif TG_OP = 'DELETE' then
    update dishes set likes_count = greatest(likes_count - 1, 0) where id = old.dish_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger trg_dish_likes_insert
  after insert on dish_likes
  for each row
  execute function sync_dish_likes_count();

create trigger trg_dish_likes_delete
  after delete on dish_likes
  for each row
  execute function sync_dish_likes_count();

-- Defensive backfill: reconcile any existing likes_count values against the
-- actual dish_likes rows, in case the column had drifted from reality before
-- this trigger existed.
update dishes d
  set likes_count = coalesce((select count(*) from dish_likes dl where dl.dish_id = d.id), 0)
  where likes_count <> coalesce((select count(*) from dish_likes dl where dl.dish_id = d.id), 0);
