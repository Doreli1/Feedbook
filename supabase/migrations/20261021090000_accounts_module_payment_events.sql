-- "חשבונות" module (apps/web, 2026-10-21) — see
-- 12.Feedbook_Accounts_Module_Spec v2.docx for the full design this
-- implements. Two new tables:
--
-- payment_events: append-only money journal, per Backend Schema §6.5
-- (characterized there since 2026-10-09, never implemented until now).
-- Never UPDATEd — a correction is its own new row, same append-only
-- principle as audit_log/ledger_entries.
--
-- order_item_cancellation_requests: NOT in Backend Schema §6.5 — added
-- today for the two-tier approval model (manager: direct; waiter: pending
-- manager approval) decided during spec review. Exists specifically so a
-- pending/rejected request never has to touch the append-only
-- payment_events table — only an approved cancellation ever creates a
-- payment_events row.

create table payment_events (
  id uuid primary key default uuid_generate_v4(),
  share_id uuid not null references payment_participant_shares (id) on delete cascade,
  event_type text not null
    check (event_type in ('charge', 'refund', 'tip_added', 'tip_adjusted', 'cancellation_refund')),
  amount numeric(10, 2) not null,
  related_order_item_id uuid references order_items (id),
  reason text,
  created_by uuid references staff (id),
  created_at timestamptz not null default now()
);

create table order_item_cancellation_requests (
  id uuid primary key default uuid_generate_v4(),
  order_item_id uuid not null references order_items (id),
  requested_by uuid not null references staff (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reason text,
  created_at timestamptz not null default now(),
  decided_by uuid references staff (id),
  decided_at timestamptz
);

alter table payment_events enable row level security;
alter table order_item_cancellation_requests enable row level security;

-- Read-only for managers, via the already-existing
-- current_manager_restaurant_ids() (20260901120000_staff_active_status.sql)
-- — deliberately not current_staff_restaurant_ids(): §6.5 scopes this data
-- to owner/manager only, not waiter/kitchen. All writes to both tables
-- happen exclusively through the two new Edge Functions under
-- service_role — same pattern as order_holds/bar_ticket_counters — so
-- neither table has an insert/update/delete policy for any client role.

create policy "manager_select_own_restaurant_payment_events"
  on payment_events for select
  using (
    share_id in (
      select payment_participant_shares.id from payment_participant_shares
      join payments on payments.id = payment_participant_shares.payment_id
      join table_sessions on table_sessions.id = payments.session_id
      where table_sessions.restaurant_id in (select current_manager_restaurant_ids())
    )
  );

create policy "manager_select_own_restaurant_cancellation_requests"
  on order_item_cancellation_requests for select
  using (
    order_item_id in (
      select order_items.id from order_items
      join orders on orders.id = order_items.order_id
      join table_sessions on table_sessions.id = orders.session_id
      where table_sessions.restaurant_id in (select current_manager_restaurant_ids())
    )
  );
