-- Feedbook Backend Schema — Row Level Security
-- Source: 5.Feedbook_Backend_Schema.docx §10 defines three repeating patterns
-- (Staff-Scoped, Participant-Scoped, Public-Read) and gives 3 illustrative
-- example policies (dishes, table_sessions, payment_participant_shares).
-- This migration extends those same three patterns to full coverage across
-- all 25 business tables, per the pattern/table assignments implied by the
-- domain map (§1.1) and the design doc's own text.
--
-- Deliberate deviation from the doc: audit_log is listed under "Staff-Scoped"
-- (full CRUD) in §10, but a mutable audit trail defeats its own purpose.
-- Staff get INSERT + SELECT only here; no UPDATE/DELETE policy is created,
-- so existing rows are immutable via the client API (append-only).
--
-- Every "staff-scoped" policy below needs "which restaurant_ids is the
-- current user staff at" — including the policy on the staff table itself.
-- A plain `select restaurant_id from staff where user_id = auth.uid()`
-- inlined into staff's own policy causes infinite recursion (evaluating
-- the policy re-queries the same RLS-protected table, which re-evaluates
-- the same policy...). This was caught by actually running the migration
-- against local Postgres and querying as the anon role, not by inspection.
-- Fix: a SECURITY DEFINER function bypasses RLS for this one lookup, so
-- resolving it never re-enters staff's own policy.
create or replace function current_staff_restaurant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select restaurant_id from staff where user_id = auth.uid();
$$;

revoke all on function current_staff_restaurant_ids() from public;
grant execute on function current_staff_restaurant_ids() to authenticated;

-- ---------- restaurants ----------
alter table restaurants enable row level security;

create policy "public_read_restaurants"
  on restaurants for select
  using (true);

create policy "staff_manage_own_restaurant"
  on restaurants for all
  using (
    id in (select current_staff_restaurant_ids())
  );

-- ---------- genius_tiers (static reference) ----------
alter table genius_tiers enable row level security;

create policy "public_read_genius_tiers"
  on genius_tiers for select
  using (true);

-- ---------- user_profiles ----------
alter table user_profiles enable row level security;

create policy "owner_manage_own_profile"
  on user_profiles for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- staff ----------
alter table staff enable row level security;

create policy "staff_manage_own_restaurant_staff"
  on staff for all
  using (
    restaurant_id in (select current_staff_restaurant_ids())
  );

-- ---------- consents ----------
alter table consents enable row level security;

create policy "owner_manage_own_consents"
  on consents for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- menu_categories ----------
alter table menu_categories enable row level security;

create policy "public_read_menu_categories"
  on menu_categories for select
  using (true);

create policy "staff_manage_own_restaurant_menu_categories"
  on menu_categories for all
  using (
    restaurant_id in (select current_staff_restaurant_ids())
  );

-- ---------- dishes ----------
alter table dishes enable row level security;

create policy "staff_manage_own_restaurant_dishes"
  on dishes for all
  using (
    restaurant_id in (select current_staff_restaurant_ids())
  );

create policy "public_read_available_dishes"
  on dishes for select
  using (is_available = true);

-- ---------- dish_likes ----------
alter table dish_likes enable row level security;

create policy "owner_manage_own_dish_likes"
  on dish_likes for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- ingredients (internal operational data — no public read) ----------
alter table ingredients enable row level security;

create policy "staff_manage_own_restaurant_ingredients"
  on ingredients for all
  using (
    restaurant_id in (select current_staff_restaurant_ids())
  );

-- ---------- dish_ingredients ----------
alter table dish_ingredients enable row level security;

create policy "staff_manage_own_restaurant_dish_ingredients"
  on dish_ingredients for all
  using (
    dish_id in (
      select id from dishes
      where restaurant_id in (select current_staff_restaurant_ids())
    )
  );

-- ---------- purchase_orders ----------
alter table purchase_orders enable row level security;

create policy "staff_manage_own_restaurant_purchase_orders"
  on purchase_orders for all
  using (
    restaurant_id in (select current_staff_restaurant_ids())
  );

-- ---------- tables (floor plan — staff only; diners resolve via QR through a
-- SECURITY DEFINER function / Edge Function, not direct table SELECT) ----------
alter table tables enable row level security;

create policy "staff_manage_own_restaurant_tables"
  on tables for all
  using (
    restaurant_id in (select current_staff_restaurant_ids())
  );

-- ---------- table_sessions ----------
alter table table_sessions enable row level security;

create policy "staff_manage_own_restaurant_sessions"
  on table_sessions for all
  using (
    restaurant_id in (select current_staff_restaurant_ids())
  );

create policy "participant_read_own_session"
  on table_sessions for select
  using (
    id in (select session_id from session_participants where user_id = auth.uid())
  );

-- ---------- session_participants ----------
alter table session_participants enable row level security;

create policy "staff_manage_own_restaurant_session_participants"
  on session_participants for all
  using (
    session_id in (
      select id from table_sessions
      where restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "participant_read_own_session_participants"
  on session_participants for select
  using (
    session_id in (select session_id from session_participants where user_id = auth.uid())
  );

-- ---------- orders ----------
alter table orders enable row level security;

create policy "staff_manage_own_restaurant_orders"
  on orders for all
  using (
    session_id in (
      select id from table_sessions
      where restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "participant_manage_own_orders"
  on orders for all
  using (
    participant_id in (select id from session_participants where user_id = auth.uid())
  )
  with check (
    participant_id in (select id from session_participants where user_id = auth.uid())
  );

-- ---------- order_items ----------
alter table order_items enable row level security;

create policy "staff_manage_own_restaurant_order_items"
  on order_items for all
  using (
    order_id in (
      select o.id from orders o
      join table_sessions ts on ts.id = o.session_id
      where ts.restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "participant_manage_own_order_items"
  on order_items for all
  using (
    order_id in (
      select id from orders
      where participant_id in (select id from session_participants where user_id = auth.uid())
    )
  )
  with check (
    order_id in (
      select id from orders
      where participant_id in (select id from session_participants where user_id = auth.uid())
    )
  );

-- ---------- payments ----------
alter table payments enable row level security;

create policy "staff_manage_own_restaurant_payments"
  on payments for all
  using (
    session_id in (
      select id from table_sessions
      where restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "participant_read_own_session_payments"
  on payments for select
  using (
    session_id in (select session_id from session_participants where user_id = auth.uid())
  );

-- ---------- payment_participant_shares ----------
alter table payment_participant_shares enable row level security;

create policy "staff_manage_own_restaurant_payment_shares"
  on payment_participant_shares for all
  using (
    payment_id in (
      select p.id from payments p
      join table_sessions ts on ts.id = p.session_id
      where ts.restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "participant_manage_own_share"
  on payment_participant_shares for all
  using (
    participant_id in (select id from session_participants where user_id = auth.uid())
  );

-- ---------- reviews ----------
alter table reviews enable row level security;

create policy "staff_manage_own_restaurant_reviews"
  on reviews for all
  using (
    restaurant_id in (select current_staff_restaurant_ids())
  );

create policy "public_read_published_reviews"
  on reviews for select
  using (status = 'published');

create policy "author_manage_own_review"
  on reviews for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- review_dish_ratings ----------
alter table review_dish_ratings enable row level security;

create policy "staff_read_own_restaurant_review_dish_ratings"
  on review_dish_ratings for select
  using (
    review_id in (
      select id from reviews
      where restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "public_read_published_review_dish_ratings"
  on review_dish_ratings for select
  using (
    review_id in (select id from reviews where status = 'published')
  );

create policy "author_manage_own_review_dish_ratings"
  on review_dish_ratings for all
  using (
    review_id in (select id from reviews where user_id = auth.uid())
  )
  with check (
    review_id in (select id from reviews where user_id = auth.uid())
  );

-- ---------- review_helpful_votes ----------
alter table review_helpful_votes enable row level security;

create policy "voter_manage_own_helpful_vote"
  on review_helpful_votes for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "public_read_helpful_votes_on_published_reviews"
  on review_helpful_votes for select
  using (
    review_id in (select id from reviews where status = 'published')
  );

-- ---------- non_conformances ----------
alter table non_conformances enable row level security;

create policy "staff_manage_own_restaurant_non_conformances"
  on non_conformances for all
  using (
    restaurant_id in (select current_staff_restaurant_ids())
  );

create policy "opener_manage_own_non_conformances"
  on non_conformances for all
  using (opened_by = auth.uid())
  with check (opened_by = auth.uid());

-- ---------- waiter_calls ----------
alter table waiter_calls enable row level security;

create policy "staff_manage_own_restaurant_waiter_calls"
  on waiter_calls for all
  using (
    session_id in (
      select id from table_sessions
      where restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "participant_manage_own_session_waiter_calls"
  on waiter_calls for all
  using (
    session_id in (select session_id from session_participants where user_id = auth.uid())
  )
  with check (
    session_id in (select session_id from session_participants where user_id = auth.uid())
  );

-- ---------- notifications (recipient-owned; inserts happen server-side) ----------
alter table notifications enable row level security;

create policy "user_read_own_notifications"
  on notifications for select
  using (user_id = auth.uid());

create policy "user_mark_own_notifications_read"
  on notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "staff_read_own_notifications"
  on notifications for select
  using (staff_id in (select id from staff where user_id = auth.uid()));

create policy "staff_mark_own_notifications_read"
  on notifications for update
  using (staff_id in (select id from staff where user_id = auth.uid()))
  with check (staff_id in (select id from staff where user_id = auth.uid()));

-- ---------- audit_log (append-only — see note at top of file) ----------
alter table audit_log enable row level security;

create policy "staff_read_own_restaurant_audit_log"
  on audit_log for select
  using (
    restaurant_id in (select current_staff_restaurant_ids())
  );

create policy "staff_insert_own_restaurant_audit_log"
  on audit_log for insert
  with check (
    restaurant_id in (select current_staff_restaurant_ids())
  );
