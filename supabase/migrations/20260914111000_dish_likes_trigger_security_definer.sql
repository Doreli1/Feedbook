-- Feedbook Backend Schema — fix sync_dish_likes_count() to actually work for
-- a real diner (Stage 5 real implementation, 2026-09-14, follow-up).
-- Found via a real client-path test (PostgREST insert as an authenticated
-- diner, not a raw psql superuser session): the insert into dish_likes
-- succeeded, but dishes.likes_count silently stayed unchanged. Root cause:
-- the trigger function had no security definer, so its own internal
-- `update dishes ...` ran as the invoking diner — and a plain diner has no
-- UPDATE grant on dishes at all (only staff_manage_own_restaurant_dishes
-- does), so RLS quietly excluded the row from being seen as updatable (zero
-- rows affected, no error raised). security definer runs the trigger as its
-- owner instead, bypassing dishes' RLS for this one internal counter write —
-- same pattern already used by current_participant_ids() elsewhere in this
-- schema for the same class of problem.
create or replace function sync_dish_likes_count()
returns trigger
language plpgsql
security definer
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
