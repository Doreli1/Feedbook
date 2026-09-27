-- Feedbook Backend Schema — fix infinite RLS recursion on session-scoped tables
--
-- Discovered via direct PostgREST testing as a real diner (not service_role,
-- not staff): any query against table_sessions, session_participants,
-- orders, order_items, payments, payment_participant_shares, or
-- waiter_calls failed with "infinite recursion detected in policy for
-- relation session_participants" (Postgres 42P17). Root cause:
-- session_participants' own "read my session" policy inline-subqueries
-- session_participants from within its own USING clause — evaluating that
-- subquery re-invokes the same policy, which recurses forever. Every other
-- table above transitively hits the same wall the moment its own
-- participant-scoped policy reads session_participants to resolve "am I a
-- participant here".
--
-- Same root cause, same fix shape as current_staff_restaurant_ids() /
-- current_manager_restaurant_ids() (20260901120000_staff_active_status.sql):
-- a SECURITY DEFINER helper bypasses RLS on its own internal read (the
-- function owner isn't subject to session_participants' RLS), breaking the
-- cycle instead of re-entering it.

create or replace function current_participant_session_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select session_id from session_participants where user_id = auth.uid();
$$;

revoke all on function current_participant_session_ids() from public;
grant execute on function current_participant_session_ids() to authenticated;

create or replace function current_participant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from session_participants where user_id = auth.uid();
$$;

revoke all on function current_participant_ids() from public;
grant execute on function current_participant_ids() to authenticated;

-- ---------- table_sessions ----------
drop policy "participant_read_own_session" on table_sessions;
create policy "participant_read_own_session"
  on table_sessions for select
  using (id in (select current_participant_session_ids()));

-- ---------- session_participants (the actual recursion root) ----------
drop policy "participant_read_own_session_participants" on session_participants;
create policy "participant_read_own_session_participants"
  on session_participants for select
  using (session_id in (select current_participant_session_ids()));

-- ---------- orders ----------
drop policy "participant_manage_own_orders" on orders;
create policy "participant_manage_own_orders"
  on orders for all
  using (participant_id in (select current_participant_ids()))
  with check (participant_id in (select current_participant_ids()));

-- ---------- order_items ----------
drop policy "participant_manage_own_order_items" on order_items;
create policy "participant_manage_own_order_items"
  on order_items for all
  using (
    order_id in (select id from orders where participant_id in (select current_participant_ids()))
  )
  with check (
    order_id in (select id from orders where participant_id in (select current_participant_ids()))
  );

-- ---------- payments ----------
drop policy "participant_read_own_session_payments" on payments;
create policy "participant_read_own_session_payments"
  on payments for select
  using (session_id in (select current_participant_session_ids()));

-- ---------- payment_participant_shares ----------
drop policy "participant_manage_own_share" on payment_participant_shares;
create policy "participant_manage_own_share"
  on payment_participant_shares for all
  using (participant_id in (select current_participant_ids()));

-- ---------- waiter_calls ----------
drop policy "participant_manage_own_session_waiter_calls" on waiter_calls;
create policy "participant_manage_own_session_waiter_calls"
  on waiter_calls for all
  using (session_id in (select current_participant_session_ids()))
  with check (session_id in (select current_participant_session_ids()));
