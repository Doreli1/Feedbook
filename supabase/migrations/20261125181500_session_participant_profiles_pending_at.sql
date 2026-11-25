-- Real feature (2026-11-25, explicit user request): a countdown badge on
-- both sides of the personal-account-link request (the approver's own
-- accept/decline modal, top-left; the sender's own pending-blocks-payment
-- notice, bottom-left) needs to know WHEN the request was sent — that's
-- pending_billing_request_at (20261125170000_pending_billing_request_expiry
-- .sql), which exists on the table but was never returned by this RPC, the
-- only way the mobile client ever reads participant rows (RLS on
-- user_profiles is "own profile only" — see this function's own original
-- comment). Re-snapshot, same shape as the 20261117100000 one that added
-- pending_billing_request_from itself — dropped first since adding a column
-- to a RETURNS TABLE shape isn't CREATE OR REPLACE-compatible.
drop function if exists session_participant_profiles(uuid);

create function session_participant_profiles(p_session_id uuid)
returns table (
  participant_id uuid,
  display_name text,
  profile_photo_url text,
  is_host boolean,
  billed_to_participant_id uuid,
  left_at timestamptz,
  pending_billing_request_from uuid,
  pending_billing_request_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select sp.id, up.display_name, up.profile_photo_url, sp.is_host, sp.billed_to_participant_id, sp.left_at, sp.pending_billing_request_from, sp.pending_billing_request_at
  from session_participants sp
  join user_profiles up on up.user_id = sp.user_id
  where sp.session_id = p_session_id
    and p_session_id in (select current_participant_session_ids())
  order by sp.joined_at asc;
$$;

revoke all on function session_participant_profiles(uuid) from public;
grant execute on function session_participant_profiles(uuid) to authenticated;
