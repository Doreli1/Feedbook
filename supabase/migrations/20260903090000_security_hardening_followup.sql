-- Feedbook Backend Schema — Follow-up to security_and_performance_hardening
-- (20260831133522). That migration pinned search_path on the two PL/pgSQL
-- functions that existed at the time (deduct_inventory_for_order,
-- calculate_bill_split) and wrapped auth.uid() in 18 RLS policies for the
-- InitPlan optimization. Two functions and one policy added afterwards
-- (restaurant_self_registration, staff_active_status) never got the same
-- treatment — caught by Supabase's own advisor (get_advisors) after a
-- schema sync, 2026-09-03, not by inspection.

-- ---------- 1. Pin search_path on the two functions added since ----------

create or replace function guard_last_active_manager()
returns trigger
language plpgsql
set search_path = public
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

create or replace function guard_restaurant_onboarding_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.onboarding_status is distinct from old.onboarding_status
     and current_setting('role') <> 'service_role'
     and new.onboarding_status not in ('draft', 'pending_review')
  then
    raise exception 'onboarding_status can only be set to draft or pending_review via the client API; approval/rejection is a manual service_role operation';
  end if;
  return new;
end;
$$;

-- ---------- 2. Wrap auth.uid() in the one policy added since ----------

drop policy "staff_read_own_row" on staff;

create policy "staff_read_own_row"
  on staff for select
  using (user_id = (select auth.uid()));

-- ---------- 3. Documented, not fixed: current_manager_restaurant_ids() ----------
-- staff_active_status's `revoke all on function ... from public` does not
-- actually remove anon's EXECUTE — verified via
-- has_function_privilege('anon', 'public.current_manager_restaurant_ids()',
-- 'EXECUTE') returning true despite the revoke, 2026-09-03. Supabase grants
-- EXECUTE to anon/authenticated directly (not via the PUBLIC pseudo-role) on
-- every new public-schema function; revoking from PUBLIC doesn't touch a
-- role's own direct grant — `revoke ... from anon` explicitly would be
-- needed instead. Not fixed here: same reasoning already accepted for
-- current_staff_restaurant_ids() in the original hardening migration —
-- auth.uid() is null for anon, so the function returns zero rows regardless
-- of who can call it. No data exposure, just a misleading comment in the
-- migration that wrote the ineffective revoke.
