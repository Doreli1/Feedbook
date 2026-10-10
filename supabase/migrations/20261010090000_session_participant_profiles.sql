-- Feedbook Backend Schema — diner-to-diner participant visibility (2026-10-10)
--
-- Needed for the "ניהול חשבון" account screen's table-mates row (mockups
-- 10.1/10.2): every diner should see their table-mates' photo + display
-- name, regardless of how each joined (direct QR scan or added by another
-- participant — both paths already produce a real session_participants row,
-- so no change needed there).
--
-- user_profiles' own RLS ("owner_manage_own_profile", user_id = auth.uid())
-- only ever lets a diner read their own profile — a plain join from the
-- client would silently return null name/photo for every table-mate. Same
-- shape of problem already solved once for the bar-ticket feature
-- (bar_participant_display_names, 20260914130000) but that one is scoped to
-- restaurant staff via current_staff_restaurant_ids() and returns only
-- display_name — wrong audience (staff, not diners) and missing the photo
-- this screen needs. A narrow SECURITY DEFINER function scoped to "caller is
-- themselves a participant of this session" (current_participant_session_ids(),
-- 20260908090000) is the same pattern used throughout this schema in place
-- of a broader RLS grant on user_profiles, which also carries unrelated
-- fields (birthdate, language_preference).
--
-- No anonymous participants to account for here (project convention —
-- every diner is a registered account, see join-session): the inner join to
-- user_profiles is expected to always match.
create or replace function session_participant_profiles(p_session_id uuid)
returns table (participant_id uuid, display_name text, profile_photo_url text, is_host boolean)
language sql
security definer
set search_path = public
stable
as $$
  select sp.id, up.display_name, up.profile_photo_url, sp.is_host
  from session_participants sp
  join user_profiles up on up.user_id = sp.user_id
  where sp.session_id = p_session_id
    and p_session_id in (select current_participant_session_ids());
$$;

revoke all on function session_participant_profiles(uuid) from public;
grant execute on function session_participant_profiles(uuid) to authenticated;
