-- Real feature (2026-11-15, explicit user request): "הוספת חבר לחשבון
-- האישי" — a diner on bill-summary.tsx can add an EXISTING table-mate
-- (already a real session_participants row, not a brand-new QR invite —
-- that's add-participants.tsx's own separate flow) to their own personal
-- account, so one person can pay for/split with another. There was
-- previously no real data for this at all: join-session accepts an
-- `invited_by_participant_id` body field but never persists it anywhere
-- (confirmed by reading that function directly) — this is the first real
-- column backing the concept.
--
-- billed_to_participant_id null = pays for themself (the default, and the
-- overwhelming common case). Set = this participant's charges are combined
-- into the pointed-to participant's own personal account instead — that
-- target participant is who actually pays. Self-reference blocked outright;
-- cross-session references are prevented at the application layer (the new
-- link-personal-account-members Edge Function validates both rows share a
-- session_id before writing, since a cross-table CHECK can't express that).
alter table session_participants
  add column billed_to_participant_id uuid references session_participants(id);

alter table session_participants
  add constraint session_participants_billed_to_not_self
  check (billed_to_participant_id is distinct from id);

-- Re-snapshot of session_participant_profiles (20261010191000) — only
-- change is returning the new column too, so useSessionParticipants.ts can
-- know who's already been added to whose account (gates
-- billSummarySplitEquallyButton's own visibility, and pre-fills the add-
-- members picker). Dropped first — adding a column to the returned table
-- shape isn't a plain CREATE OR REPLACE-compatible change in Postgres.
drop function if exists session_participant_profiles(uuid);

create function session_participant_profiles(p_session_id uuid)
returns table (participant_id uuid, display_name text, profile_photo_url text, is_host boolean, billed_to_participant_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select sp.id, up.display_name, up.profile_photo_url, sp.is_host, sp.billed_to_participant_id
  from session_participants sp
  join user_profiles up on up.user_id = sp.user_id
  where sp.session_id = p_session_id
    and p_session_id in (select current_participant_session_ids())
  order by sp.joined_at asc;
$$;

revoke all on function session_participant_profiles(uuid) from public;
grant execute on function session_participant_profiles(uuid) to authenticated;
