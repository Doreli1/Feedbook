-- Real bug found live (2026-11-17, user report): a diner who already paid
-- and left (session_participants.left_at set, by confirm-card-payment) kept
-- showing up in the "הוספת חברים לחשבון האישי" picker as if still an
-- active, addable table-mate — there was simply no way for the client to
-- know someone had already left, since session_participant_profiles()
-- never returned left_at at all. Extends it to do so; left_at itself
-- decides nothing server-side here (this RPC is a read, not a gate) — it's
-- up to each consumer whether a departed participant belongs in its own
-- list (bill-summary.tsx's own eligibleFriends/myAccountMembers now filter
-- on it; a general "who was ever at this table" view elsewhere is free not
-- to).
--
-- Re-snapshot of session_participant_profiles (20261115090000) — only
-- change is returning left_at too. Dropped first — adding a column to the
-- returned table shape isn't a plain CREATE OR REPLACE-compatible change.
drop function if exists session_participant_profiles(uuid);

create function session_participant_profiles(p_session_id uuid)
returns table (participant_id uuid, display_name text, profile_photo_url text, is_host boolean, billed_to_participant_id uuid, left_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select sp.id, up.display_name, up.profile_photo_url, sp.is_host, sp.billed_to_participant_id, sp.left_at
  from session_participants sp
  join user_profiles up on up.user_id = sp.user_id
  where sp.session_id = p_session_id
    and p_session_id in (select current_participant_session_ids())
  order by sp.joined_at asc;
$$;

revoke all on function session_participant_profiles(uuid) from public;
grant execute on function session_participant_profiles(uuid) to authenticated;
