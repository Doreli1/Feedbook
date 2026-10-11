-- API Specification §10.2 / PRD §5.1.4: resolving a service call ("סימון
-- כטופלה") is restricted to an active staff member with role='waiter' —
-- explicitly not any staff, not manager, not kitchen. The existing
-- staff_manage_own_restaurant_waiter_calls policy was FOR ALL with no role
-- scoping at all — any staff member could resolve a call via a raw
-- PostgREST update. Split into: SELECT stays open to all staff (so the
-- dashboard tab/bell still shows calls to everyone), UPDATE is scoped to
-- waiter role only. Mirrors current_manager_restaurant_ids()'s own pattern
-- exactly (20260901120000_staff_active_status.sql).

alter table waiter_calls add column resolved_by uuid references staff (id);

create or replace function current_waiter_restaurant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select restaurant_id from staff where user_id = auth.uid() and role = 'waiter' and is_active = true;
$$;

revoke all on function current_waiter_restaurant_ids() from public;
grant execute on function current_waiter_restaurant_ids() to authenticated;

drop policy "staff_manage_own_restaurant_waiter_calls" on waiter_calls;

create policy "staff_select_own_restaurant_waiter_calls"
  on waiter_calls for select
  using (
    session_id in (
      select table_sessions.id from table_sessions
      where table_sessions.restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "waiter_resolve_own_restaurant_waiter_calls"
  on waiter_calls for update
  using (
    session_id in (
      select table_sessions.id from table_sessions
      where table_sessions.restaurant_id in (select current_waiter_restaurant_ids())
    )
  )
  with check (
    session_id in (
      select table_sessions.id from table_sessions
      where table_sessions.restaurant_id in (select current_waiter_restaurant_ids())
    )
  );
