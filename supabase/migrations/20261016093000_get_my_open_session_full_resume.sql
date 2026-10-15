-- Real gap found 2026-10-16 (user question): the mail-icon reminder's own
-- "scan QR to return" CTA is a dead end for a diner who already left the
-- restaurant and has no scanner access. They don't need to re-prove
-- physical presence to RESUME a session they already legitimately joined —
-- that's a fundamentally different case from join-session's own qr_token
-- requirement, which exists to stop a stranger from joining a session for
-- the FIRST time (see join-session/index.ts's own security-fix comment).
-- Resuming grants no new capability: this RPC is still scoped to the
-- caller's own existing session_participants row for an open session, same
-- as before.
--
-- Expands get_my_open_session() to return every field
-- tableSessionStore.setTableSession() needs, so the client can restore its
-- local session state directly and route straight back into /menu — no
-- physical QR scan required. Return type is changing, so CREATE OR REPLACE
-- can't be used (Postgres rejects a changed return signature); drop and
-- recreate under the same name instead.
drop function if exists get_my_open_session();

create or replace function get_my_open_session()
returns table (
  session_id uuid,
  participant_id uuid,
  restaurant_id uuid,
  restaurant_name text,
  table_id uuid,
  table_number text,
  table_type text,
  session_account_number text,
  sub_account_number text,
  bar_ticket_number int,
  review_verification_code text,
  qr_token text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ts.id,
    sp.id,
    r.id,
    r.name,
    t.id,
    t.table_number,
    t.table_type,
    ts.session_account_number,
    sp.sub_account_number,
    sp.bar_ticket_number,
    sp.review_verification_code,
    t.qr_code_token
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
