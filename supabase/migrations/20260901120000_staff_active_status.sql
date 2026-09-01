-- Feedbook Backend Schema — Staff active/inactive status
-- A departed or terminated staff member gets is_active=false rather than
-- being deleted, so order/audit history keeps pointing at a real row (same
-- append-only principle already used for audit_log). Matches the M1 UI
-- prototype's "disable, never delete" pattern for Users & Roles.

alter table staff
  add column is_active boolean not null default true;

-- current_staff_restaurant_ids() must exclude inactive staff — otherwise
-- disabling someone in the Users screen wouldn't actually revoke their
-- restaurant-wide access, since every staff-scoped RLS policy in the schema
-- (dishes, orders, payments, inventory, ...) keys off this function. This
-- is the single most important line in this migration.
create or replace function current_staff_restaurant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select restaurant_id from staff where user_id = auth.uid() and is_active = true;
$$;

-- ---------- staff table access: manager-only, not "any staff" ----------
-- Deliberate correction to the original staff_manage_own_restaurant_staff
-- policy (row_level_security migration), which let ANY staff member —
-- waiter, kitchen — read and modify the entire staff roster, including
-- disabling the manager or promoting themselves. That was tolerable when
-- the only thing staff rows gated was "am I staff at this restaurant", but
-- becomes a real, immediately exploitable hole now that this table also
-- carries the is_active/role state that controls who can act as staff at
-- all. Restricted to active managers, via the same SECURITY DEFINER
-- pattern as current_staff_restaurant_ids() to avoid policy self-recursion
-- (a plain subquery on staff inside a policy defined on staff re-enters the
-- same policy and recurses).
create or replace function current_manager_restaurant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select restaurant_id from staff where user_id = auth.uid() and role = 'manager' and is_active = true;
$$;

revoke all on function current_manager_restaurant_ids() from public;
grant execute on function current_manager_restaurant_ids() to authenticated;

drop policy "staff_manage_own_restaurant_staff" on staff;

create policy "manager_manage_restaurant_staff"
  on staff for all
  using (restaurant_id in (select current_manager_restaurant_ids()))
  with check (restaurant_id in (select current_manager_restaurant_ids()));

create policy "staff_read_own_row"
  on staff for select
  using (user_id = auth.uid());

-- ---------- guard: cannot remove the last active manager ----------
-- Same rule the M1 prototype enforces client-side (Users & Roles screen,
-- delUser()) — re-enforced here server-side, since a client-only check is
-- not a security boundary (CLAUDE.md non-negotiable rule). service_role is
-- exempted for manual support fixes, same as the restaurant-onboarding
-- guard trigger.
create or replace function guard_last_active_manager()
returns trigger
language plpgsql
as $$
declare
  v_remaining_active_managers int;
begin
  if old.role = 'manager' and old.is_active = true
     and not (new.role = 'manager' and new.is_active = true)
     and current_setting('role') <> 'service_role'
  then
    select count(*) into v_remaining_active_managers
    from staff
    where restaurant_id = old.restaurant_id
      and role = 'manager'
      and is_active = true
      and id <> old.id;

    if v_remaining_active_managers = 0 then
      raise exception 'Cannot disable or reassign the last active manager for this restaurant';
    end if;
  end if;
  return new;
end;
$$;

create trigger staff_guard_last_active_manager
  before update on staff
  for each row execute function guard_last_active_manager();
