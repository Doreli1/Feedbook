-- Feedbook Backend Schema — per-stage timestamp for the order-item status
-- tracker (Stage 5 real implementation, 2026-09-14).
-- Source: project memory project_stage5_alignment_decisions — the diner
-- app's order tracker was decided as a vertical timeline "with a timestamp
-- per completed stage" (Style B, comparison artifact). order_items had no
-- column at all recording *when* a status transition happened (only
-- orders.placed_at, which only covers the order's creation, not later
-- kitchen-side ready/served transitions) — this closes that gap.
--
-- A trigger, not a client-set column: the kitchen screen (Web Admin) updates
-- order_items.status directly via PostgREST (API Specification §7.3), not
-- through an Edge Function — a trigger guarantees the timestamp is always
-- correct regardless of which caller changes the status, rather than relying
-- on every future caller to remember to set it themselves.
alter table order_items
  add column status_updated_at timestamptz not null default now();

create or replace function set_order_item_status_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.status_updated_at = now();
  end if;
  return new;
end;
$$;

create trigger trg_order_item_status_updated_at
  before update on order_items
  for each row
  execute function set_order_item_status_updated_at();
