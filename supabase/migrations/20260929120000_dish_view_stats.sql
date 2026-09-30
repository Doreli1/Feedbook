-- Real, data-driven "dish views today" bullet on the diner-facing menu
-- (2026-09-29) — same philosophy as the other realtime dish bullets
-- (20260924120000_dish_realtime_activity_and_critical_stock.sql): only ever
-- shows a real, live count, never a fabricated one.
--
-- Dedup design (explicit user decision, 2026-09-29): a "view" is counted at
-- most once per (session_participant, dish) — the same diner reopening the
-- same dish repeatedly within one table visit only counts once, but a
-- different diner at the same table, or the same person on a later/different
-- table session, each counts as a new view. This follows orders.participant_id
-- (session_participants, reset per table visit), not dish_likes.user_id
-- (auth.users, a lifetime identity) — a returning diner a week later is a
-- fresh, real signal of renewed interest, not a duplicate.
create table dish_views (
  participant_id uuid not null references session_participants (id) on delete cascade,
  dish_id uuid not null references dishes (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (participant_id, dish_id)
);

alter table dish_views enable row level security;

-- Insert-only from the client — a diner logs their own view and never reads
-- this table directly (the diner-facing count comes from the RPC below,
-- which returns only the minimal aggregate, same reasoning as
-- get_dish_order_stats). No update/delete policy: a logged view is never
-- edited or retracted.
create policy "participant_insert_own_dish_view"
  on dish_views for insert
  to authenticated
  with check (
    participant_id in (
      select sp.id from session_participants sp where sp.user_id = (select auth.uid())
    )
  );

-- Today-only count (resets daily, per explicit decision) — mirrors
-- get_dish_order_stats' date_trunc('day', now()) scoping and security
-- definer/RLS-bypass reasoning exactly (a diner's own client cannot read
-- other diners' dish_views rows, by design above).
create or replace function get_dish_view_stats(p_restaurant_id uuid)
returns table (dish_id uuid, views_today int)
language sql
security definer
set search_path = public
stable
as $$
  select dv.dish_id, count(*)::int
  from dish_views dv
  join dishes d on d.id = dv.dish_id
  where d.restaurant_id = p_restaurant_id
    and dv.viewed_at >= date_trunc('day', now())
  group by dv.dish_id;
$$;

grant execute on function get_dish_view_stats(uuid) to authenticated;

-- Broadcast-from-DB (not postgres_changes) — same realtime_publication_bug
-- class already hit twice this project (dish_ingredients/ingredients in
-- 20260927090000_inventory_change_broadcast.sql): a diner cannot read other
-- diners' dish_views rows via RLS above, so postgres_changes on this table
-- would never reach a diner's own subscription no matter how healthy the
-- connection is. realtime.messages already grants every authenticated user
-- SELECT on any broadcast topic (authenticated_receive_broadcasts, added in
-- the inventory-broadcast migration) — no new policy needed here.
create or replace function notify_dish_view_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
begin
  select d.restaurant_id into v_restaurant_id from dishes d where d.id = new.dish_id;
  if v_restaurant_id is not null then
    perform realtime.send('{}'::jsonb, 'changed', 'restaurant_dish_views:' || v_restaurant_id::text, true);
  end if;
  return new;
end;
$$;

create trigger notify_dish_view_change
  after insert on dish_views
  for each row execute function notify_dish_view_change();
