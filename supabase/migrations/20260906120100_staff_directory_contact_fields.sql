-- list_restaurant_staff() — return the new HR-style first_name/last_name/
-- phone from staff itself instead of user_profiles.display_name, matching
-- the Users & Roles table (PRD §5.1.7): שם | משפחה | תפקיד | אימייל | טלפון
-- נייד | סטטוס. Signature/security unchanged from 20260906091000 — but
-- changing a RETURNS TABLE column list isn't allowed via CREATE OR REPLACE,
-- so the old signature has to be dropped first.
drop function if exists list_restaurant_staff(uuid);

create function list_restaurant_staff(p_restaurant_id uuid)
returns table (
  id uuid,
  role text,
  is_active boolean,
  created_at timestamptz,
  first_name text,
  last_name text,
  phone text,
  email text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if p_restaurant_id not in (select current_manager_restaurant_ids()) then
    raise exception 'Not a manager of this restaurant';
  end if;

  return query
    select s.id, s.role, s.is_active, s.created_at,
           s.first_name, s.last_name, s.phone, u.email::text
    from staff s
    join auth.users u on u.id = s.user_id
    where s.restaurant_id = p_restaurant_id
    order by s.created_at;
end;
$$;

revoke all on function list_restaurant_staff(uuid) from public;
grant execute on function list_restaurant_staff(uuid) to authenticated;
