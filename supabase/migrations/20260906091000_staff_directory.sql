-- Feedbook Backend Schema — list_restaurant_staff()
-- Source: 5.Feedbook_Backend_Schema.docx §11 (PL/pgSQL functions appendix)
--
-- Users & Roles (PRD §5.1.7) needs to show a manager who their staff actually
-- are — but user_profiles RLS is own-row-only (owner_manage_own_profile) and
-- auth.users isn't exposed to PostgREST at all, so there is otherwise no way
-- for a manager to read a colleague's name/email. security definer, scoped
-- explicitly to current_manager_restaurant_ids() (same helper the staff RLS
-- policies use), following the same pattern as current_staff_restaurant_ids/
-- current_manager_restaurant_ids themselves.
create or replace function list_restaurant_staff(p_restaurant_id uuid)
returns table (
  id uuid,
  role text,
  is_active boolean,
  created_at timestamptz,
  display_name text,
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
           coalesce(p.display_name, ''), u.email::text
    from staff s
    join auth.users u on u.id = s.user_id
    left join user_profiles p on p.user_id = s.user_id
    where s.restaurant_id = p_restaurant_id
    order by s.created_at;
end;
$$;

revoke all on function list_restaurant_staff(uuid) from public;
grant execute on function list_restaurant_staff(uuid) to authenticated;
