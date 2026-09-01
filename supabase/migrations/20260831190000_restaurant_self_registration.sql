-- Feedbook Backend Schema — Restaurant self-registration
-- Source: 5.Feedbook_Backend_Schema.docx §1.2, §2.4, §10.2, §11.3

-- ---------- §1.2: onboarding columns on restaurants ----------
alter table restaurants
  add column onboarding_status text not null default 'draft'
    check (onboarding_status in ('draft', 'pending_review', 'approved', 'rejected')),
  add column submitted_at timestamptz,
  add column reviewed_at timestamptz,
  add column rejection_reason text,
  add column created_by uuid references auth.users (id);

-- ---------- §2.4: merchant_agreement_acceptances ----------
create table merchant_agreement_acceptances (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  agreement_version text not null,
  accepted_at timestamptz not null default now()
);

alter table merchant_agreement_acceptances enable row level security;

create policy "staff_read_own_restaurant_agreement_acceptances"
  on merchant_agreement_acceptances for select
  using (restaurant_id in (select current_staff_restaurant_ids()));

-- Deliberate deviation from the doc's literal §11.3 design, which has
-- register_restaurant() insert this row atomically alongside the restaurant.
-- That can't work with the actual wizard flow (AFD §3.7): the restaurant is
-- created at screen 2, but the agreement isn't accepted until screen 5, three
-- steps later — by then register_restaurant() has already run and returned.
-- So acceptance is a normal staff-scoped client insert instead, made right
-- before the draft -> pending_review PATCH (API Spec §4.3) at screen 5.
create policy "staff_insert_own_restaurant_agreement_acceptances"
  on merchant_agreement_acceptances for insert
  with check (restaurant_id in (select current_staff_restaurant_ids()));

-- ---------- §10.2: public-read policies must hide non-approved restaurants ----------
alter policy "public_read_restaurants" on restaurants
  using (onboarding_status = 'approved');

alter policy "public_read_menu_categories" on menu_categories
  using (
    restaurant_id in (select id from restaurants where onboarding_status = 'approved')
  );

alter policy "public_read_available_dishes" on dishes
  using (
    is_available = true
    and restaurant_id in (select id from restaurants where onboarding_status = 'approved')
  );

-- ---------- §10.2: staff must not self-approve/self-reject ----------
-- Deliberate deviation from the doc's literal WITH CHECK example: a WITH CHECK
-- of `onboarding_status in ('draft','pending_review')` on the NEW row would also
-- permanently block staff from editing an already-approved restaurant's own
-- name/address/etc (the resulting row's onboarding_status would still be
-- 'approved', which fails that check on every future update). A BEFORE UPDATE
-- trigger comparing OLD vs NEW lets staff edit freely and move draft/rejected
-- -> pending_review, while only service_role (manual review) can set
-- approved/rejected. Caught by testing an edit-after-approval scenario, not by
-- inspection — same discipline as the current_staff_restaurant_ids() recursion
-- fix in the row_level_security migration.
-- Uses current_setting('role') (the actual Postgres session role) rather than
-- auth.role() (which reads the 'role' claim out of request.jwt.claims, a
-- client-asserted JSON value that can be stale/mismatched relative to the
-- real executing role). A first version used auth.role() and it incorrectly
-- blocked genuine service_role updates whenever request.jwt.claims still held
-- a leftover 'authenticated' claim — caught by testing the actual
-- service_role approval path, not by inspection.
create or replace function guard_restaurant_onboarding_transition()
returns trigger
language plpgsql
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

create trigger restaurants_guard_onboarding_transition
  before update on restaurants
  for each row execute function guard_restaurant_onboarding_transition();

-- ---------- §11.3: register_restaurant() ----------
-- Called only from the register-restaurant Edge Function under service_role
-- (API Specification §4.2) — not exposed as client RPC, same pattern as
-- deduct_inventory_for_order / calculate_bill_split.
--
-- Two deliberate deviations from the doc's literal §11.3 design:
-- 1. Takes p_user_id as an explicit parameter instead of reading auth.uid().
--    A service_role Postgres session (which is how the Edge Function must
--    call this, since it's revoked from authenticated) carries no
--    request.jwt.claims for the original caller, so auth.uid() resolves to
--    NULL there — every row would be created with a NULL owner. The Edge
--    Function verifies the caller's Bearer token itself
--    (supabase.auth.getUser) and passes the verified id through.
-- 2. Does not create merchant_agreement_acceptances (no p_agreement_version
--    param) — see the comment on that table's insert policy above for why:
--    the wizard doesn't collect agreement acceptance until three screens
--    after the restaurant already exists.
-- Both caught by testing the actual call path against the AFD flow, not by
-- inspection.
create or replace function register_restaurant(
  p_user_id uuid,
  p_name text,
  p_address text,
  p_phone text,
  p_hours jsonb,
  p_kosher_status text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
begin
  insert into restaurants (name, address, phone, hours, kosher_status, onboarding_status, created_by)
  values (p_name, p_address, p_phone, p_hours, p_kosher_status, 'draft', p_user_id)
  returning id into v_restaurant_id;

  insert into staff (restaurant_id, user_id, role)
  values (v_restaurant_id, p_user_id, 'manager');

  return v_restaurant_id;
end;
$$;

revoke all on function register_restaurant(uuid, text, text, text, jsonb, text) from public, authenticated, anon;
grant execute on function register_restaurant(uuid, text, text, text, jsonb, text) to service_role;
