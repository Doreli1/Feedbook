-- Real feature (2026-11-17, explicit user request): adding a friend to your
-- personal account used to take effect unilaterally the moment the adder
-- confirmed the picker — the target never got a say. This adds a real
-- consent step: a request now sits as `pending_billing_request_from` until
-- the target explicitly approves it (which is what actually sets
-- `billed_to_participant_id`) or declines it. The target can also later
-- cancel an already-approved link themselves and go back to paying for
-- themself — same `decline` action, just acting on billed_to_participant_id
-- instead of a still-pending request (see respond-to-personal-account-link's
-- own comment).
alter table session_participants
  add column pending_billing_request_from uuid references session_participants(id);

alter table session_participants
  add constraint session_participants_pending_request_not_self
  check (pending_billing_request_from is distinct from id);

-- Re-snapshot of session_participant_profiles (20261117090000) — only change
-- is returning pending_billing_request_from too, so the client can show a
-- real approval prompt and reflect "request sent, awaiting approval" state.
drop function if exists session_participant_profiles(uuid);

create function session_participant_profiles(p_session_id uuid)
returns table (
  participant_id uuid,
  display_name text,
  profile_photo_url text,
  is_host boolean,
  billed_to_participant_id uuid,
  left_at timestamptz,
  pending_billing_request_from uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select sp.id, up.display_name, up.profile_photo_url, sp.is_host, sp.billed_to_participant_id, sp.left_at, sp.pending_billing_request_from
  from session_participants sp
  join user_profiles up on up.user_id = sp.user_id
  where sp.session_id = p_session_id
    and p_session_id in (select current_participant_session_ids())
  order by sp.joined_at asc;
$$;

revoke all on function session_participant_profiles(uuid) from public;
grant execute on function session_participant_profiles(uuid) to authenticated;
