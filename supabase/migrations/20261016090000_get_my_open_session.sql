-- Mail-icon "open visit" reminder (2026-10-16, user request): a diner who
-- scans back into the app (e.g. profile.tsx, OrderingHeader.tsx) needs a
-- quick, honest way to see they still have an open table session waiting,
-- without exposing raw table/restaurant data they have no RLS read grant
-- on. `tables` and `session_participants` are both staff/self-scoped only
-- (row_level_security.sql) — a diner's client can read their OWN
-- session_participants rows, but has no SELECT policy on `tables` at all,
-- so a plain nested-join query from the client would silently drop that
-- part. security definer crosses that boundary for exactly this one
-- narrow, pre-aggregated purpose, same pattern already used by
-- sync_dish_likes_count()/current_staff_restaurant_ids() — returns only
-- the minimal display fields (restaurant name, table number), never raw
-- row access.
create or replace function get_my_open_session()
returns table (session_id uuid, restaurant_name text, table_number text)
language sql
security definer
set search_path = public
stable
as $$
  select ts.id, r.name, t.table_number
  from session_participants sp
  join table_sessions ts on ts.id = sp.session_id
  join tables t on t.id = ts.table_id
  join restaurants r on r.id = ts.restaurant_id
  where sp.user_id = auth.uid()
    and ts.status = 'open'
  order by sp.joined_at desc
  limit 1;
$$;

grant execute on function get_my_open_session() to authenticated;
