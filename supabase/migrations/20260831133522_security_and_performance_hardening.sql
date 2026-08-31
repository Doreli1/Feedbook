-- Feedbook Backend Schema — Fixes for findings from Supabase's own advisor
-- (get_advisors), run right after the schema first landed on the new
-- Frankfurt project. Three real, actionable findings, not noise:
--
-- 1. SECURITY — function_search_path_mutable on both PL/pgSQL functions.
--    Without a pinned search_path, a function is vulnerable to search_path
--    hijacking (an object created in an earlier-resolving schema could
--    shadow an unqualified reference). Standard fix: pin it explicitly.
--
-- 2. SECURITY (considered, deliberately NOT applied) — the advisor flags
--    current_staff_restaurant_ids() as callable by both anon and
--    authenticated via /rest/v1/rpc/current_staff_restaurant_ids, and
--    suggests revoking EXECUTE from roles that shouldn't call it directly.
--    Tried revoking it from anon first; that broke public-read access
--    entirely on every table with both a public-read policy and a
--    staff-scoped one (restaurants, menu_categories, dishes) — Postgres
--    must evaluate every applicable permissive policy for the querying
--    role, so anon needs EXECUTE just to *attempt* the staff-scoped check
--    even though it always returns zero rows for them (auth.uid() is null
--    for anon). Caught immediately by testing as anon, not assumed. Both
--    anon and authenticated keep EXECUTE — a direct RPC call is harmless
--    (empty result for anon, the caller's own restaurant_ids for a real
--    staff member, which they're already entitled to know).
--
-- 2. PERFORMANCE — auth_rls_initplan on 18 policies: a bare `auth.uid()`
--    inside a USING/WITH CHECK clause gets re-evaluated per row instead of
--    once per query. Wrapping it as `(select auth.uid())` lets Postgres
--    cache it via an InitPlan. Standard, well-documented Supabase fix,
--    applied to exactly the 18 policies the advisor flagged.
--
-- Not fixed here, deliberately: `multiple_permissive_policies` (170
-- findings) reflects the intentional design of keeping each of the three
-- access patterns — Staff-Scoped, Participant-Scoped, Public-Read — as its
-- own named, readable policy rather than one merged boolean expression per
-- table; `unindexed_foreign_keys` (28) is real but lower-priority schema
-- tuning with zero rows in every table right now, not a correctness issue.

-- ---------- 1. Pin search_path on both PL/pgSQL functions ----------

create or replace function deduct_inventory_for_order(p_order_id uuid)
returns table (ingredient_id uuid, below_threshold boolean)
language plpgsql
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select di.ingredient_id, di.quantity_required * oi.quantity as needed
    from order_items oi
    join dish_ingredients di on di.dish_id = oi.dish_id
    where oi.order_id = p_order_id
  loop
    perform 1 from ingredients where id = r.ingredient_id for update;

    if (select quantity_in_stock from ingredients where id = r.ingredient_id) < r.needed then
      raise exception 'Insufficient stock for ingredient %', r.ingredient_id;
    end if;

    update ingredients
      set quantity_in_stock = quantity_in_stock - r.needed,
          updated_at = now()
      where id = r.ingredient_id;

    return query
      select r.ingredient_id,
             (select quantity_in_stock < threshold_quantity
              from ingredients where id = r.ingredient_id);
  end loop;
end;
$$;

create or replace function calculate_bill_split(p_payment_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_split_type text;
  v_total numeric(10, 2);
  v_participant_count int;
begin
  select split_type, total_amount into v_split_type, v_total
  from payments where id = p_payment_id
  for update;

  if v_split_type = 'even' then
    select count(*) into v_participant_count
    from payment_participant_shares
    where payment_id = p_payment_id;

    update payment_participant_shares
      set amount_due = round(v_total / v_participant_count, 2)
      where payment_id = p_payment_id;

  elsif v_split_type = 'by_item' then
    update payment_participant_shares pps
      set amount_due = coalesce((
        select sum(oi.unit_price * oi.quantity)
        from orders o
        join order_items oi on oi.order_id = o.id
        where o.participant_id = pps.participant_id
      ), 0);
  end if;
end;
$$;

-- ---------- 2. Cache auth.uid() per-query instead of per-row (18 policies) ----------

alter policy "owner_manage_own_profile" on user_profiles
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "owner_manage_own_consents" on consents
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "owner_manage_own_dish_likes" on dish_likes
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "participant_read_own_session" on table_sessions
  using (
    id in (select session_id from session_participants where user_id = (select auth.uid()))
  );

alter policy "participant_read_own_session_participants" on session_participants
  using (
    session_id in (select session_id from session_participants where user_id = (select auth.uid()))
  );

alter policy "participant_manage_own_orders" on orders
  using (
    participant_id in (select id from session_participants where user_id = (select auth.uid()))
  )
  with check (
    participant_id in (select id from session_participants where user_id = (select auth.uid()))
  );

alter policy "participant_manage_own_order_items" on order_items
  using (
    order_id in (
      select id from orders
      where participant_id in (select id from session_participants where user_id = (select auth.uid()))
    )
  )
  with check (
    order_id in (
      select id from orders
      where participant_id in (select id from session_participants where user_id = (select auth.uid()))
    )
  );

alter policy "participant_read_own_session_payments" on payments
  using (
    session_id in (select session_id from session_participants where user_id = (select auth.uid()))
  );

alter policy "participant_manage_own_share" on payment_participant_shares
  using (
    participant_id in (select id from session_participants where user_id = (select auth.uid()))
  );

alter policy "author_manage_own_review" on reviews
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "author_manage_own_review_dish_ratings" on review_dish_ratings
  using (
    review_id in (select id from reviews where user_id = (select auth.uid()))
  )
  with check (
    review_id in (select id from reviews where user_id = (select auth.uid()))
  );

alter policy "voter_manage_own_helpful_vote" on review_helpful_votes
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "opener_manage_own_non_conformances" on non_conformances
  using (opened_by = (select auth.uid()))
  with check (opened_by = (select auth.uid()));

alter policy "participant_manage_own_session_waiter_calls" on waiter_calls
  using (
    session_id in (select session_id from session_participants where user_id = (select auth.uid()))
  )
  with check (
    session_id in (select session_id from session_participants where user_id = (select auth.uid()))
  );

alter policy "user_read_own_notifications" on notifications
  using (user_id = (select auth.uid()));

alter policy "user_mark_own_notifications_read" on notifications
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "staff_read_own_notifications" on notifications
  using (staff_id in (select id from staff where user_id = (select auth.uid())));

alter policy "staff_mark_own_notifications_read" on notifications
  using (staff_id in (select id from staff where user_id = (select auth.uid())))
  with check (staff_id in (select id from staff where user_id = (select auth.uid())));
