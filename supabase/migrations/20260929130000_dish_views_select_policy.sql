-- Fix dish_views' insert silently failing for every real diner (2026-09-29,
-- follow-up to 20260929120000_dish_view_stats.sql). Found via a real-client
-- test: the mobile app's `.upsert(..., { onConflict: 'participant_id,dish_id',
-- ignoreDuplicates: true })` call raised "new row violates row-level security
-- policy for table dish_views" for every attempt — 0 rows ever landed in the
-- table, so the "views today" bullet never appeared on mobile no matter how
-- many dishes were opened.
--
-- Root cause: dish_views had an INSERT policy but no SELECT policy at all.
-- Per Postgres's own RLS documentation, `INSERT ... ON CONFLICT` (even
-- `DO NOTHING`) requires a SELECT policy on the target table — the arbiter
-- has to determine whether a conflicting row exists and is visible to the
-- caller, and that check itself goes through RLS. A verified isolated test
-- confirmed this precisely: the identical INSERT with the identical WITH
-- CHECK-satisfying row succeeded with no ON CONFLICT clause, and failed only
-- once `ON CONFLICT (participant_id, dish_id) DO NOTHING` was added — with
-- zero actual conflicting rows in the table at the time.
--
-- Fix: add a SELECT policy scoped the same way as the INSERT policy (a
-- participant can see only their own logged view, never another diner's) —
-- this doesn't change what any diner can ever read (the diner-facing count
-- still only ever comes from get_dish_view_stats' aggregate), it only lets
-- the ON CONFLICT arbiter do its own internal visibility check correctly.
create policy "participant_read_own_dish_view"
  on dish_views for select
  to authenticated
  using (
    participant_id in (
      select sp.id from session_participants sp where sp.user_id = (select auth.uid())
    )
  );
