-- AccountScreen.tsx's participants strip (2026-10-10 redesign) relies on
-- oldest-participant-first ordering — the newest joiner must render as the
-- last JSX child so it lands leftmost, right next to the "+" button, under
-- native RTL. The original function had no ORDER BY (arbitrary scan order),
-- which happened to work by coincidence but was never guaranteed.
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
    and p_session_id in (select current_participant_session_ids())
  order by sp.joined_at asc;
$$;

revoke all on function session_participant_profiles(uuid) from public;
grant execute on function session_participant_profiles(uuid) to authenticated;
