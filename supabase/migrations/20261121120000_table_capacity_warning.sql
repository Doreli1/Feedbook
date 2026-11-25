-- Real gap found live (2026-11-21, user report): a "couple" table
-- (capacity 2) ended up with 4 real session_participants rows joined to it
-- (general account #635287, table 4) — tables.capacity is a real, required
-- column, but nothing anywhere (join-session, scan-qr, the mobile client)
-- ever reads it. Explicit user decision after two clarifying questions:
-- warn staff only (never block a scan/join), and only for regular tables —
-- the bar is already deliberately uncapped by design (shared ticket system,
-- see project_bar_shared_ticket_system memory), not a bug to fix here.
--
-- Just a new notification `type` value here — the actual counting/warning
-- logic lives in join-session/index.ts itself (a one-time check at join
-- time, not a recurring/triggered DB concern).
alter table notifications
  drop constraint notifications_type_check;

alter table notifications
  add constraint notifications_type_check
  check (type = any (array['order_status', 'waiter_ack', 'promotion', 'inventory_alert', 'review_ready', 'payment_completed', 'table_capacity_exceeded']));
