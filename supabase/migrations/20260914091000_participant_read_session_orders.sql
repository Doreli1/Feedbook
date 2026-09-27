-- Feedbook Backend Schema — table-wide live order visibility (Stage 5 real
-- implementation, 2026-09-14).
-- Source: API Specification §3 ("מעקב סטטוס הזמנה בזמן אמת לכל השולחן") and
-- App Flow §2.3 both already document that every participant at a table
-- should see the whole table's live order activity, not only their own —
-- this was never actually implemented. orders/order_items currently only
-- carry "manage my own" policies (participant_id-scoped). These two new
-- policies are additive SELECT-only grants scoped by session instead —
-- Postgres OR's multiple permissive policies of the same command together,
-- so this only ever *adds* read access; insert/update/delete stay exactly
-- as restricted to the owning participant as before via the existing
-- participant_manage_own_orders / participant_manage_own_order_items
-- policies.
create policy "participant_read_session_orders"
  on orders for select
  using (session_id in (select current_participant_session_ids()));

create policy "participant_read_session_order_items"
  on order_items for select
  using (
    order_id in (
      select id from orders
      where session_id in (select current_participant_session_ids())
    )
  );
