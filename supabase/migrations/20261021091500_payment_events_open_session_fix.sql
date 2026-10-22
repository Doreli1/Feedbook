-- Real gap found while building request-order-item-cancellation
-- (20261021090000_accounts_module_payment_events.sql, minutes earlier): a
-- cancellation_refund event for an OPEN, not-yet-paid account has no
-- payment_participant_shares row to attach to — that row is only ever
-- created once real payment is initiated, which doesn't exist yet in this
-- codebase (no Tranzila integration — see Implementation Plan §16). The
-- NOT NULL FK to payment_participant_shares made the open-account
-- cancel+credit case (explicitly required today) impossible to write.
--
-- Fix: share_id becomes nullable (populated once real payment exists, e.g.
-- for 'charge'/'tip_added' events that naturally occur at payment time),
-- and session_id is added as the always-required link so every event is
-- unambiguously attributable to a session regardless of payment state.

alter table payment_events
  alter column share_id drop not null,
  add column session_id uuid references table_sessions (id);

update payment_events pe
set session_id = p.session_id
from payment_participant_shares pps
join payments p on p.id = pps.payment_id
where pe.share_id = pps.id;

alter table payment_events
  add constraint payment_events_session_id_required
  check (session_id is not null);

-- The read policy keyed off share_id -> payment_participant_shares, which
-- is now sometimes null. Replaced with a direct session_id join, simpler
-- and correct for both the open-account and the post-payment case.
drop policy "manager_select_own_restaurant_payment_events" on payment_events;

create policy "manager_select_own_restaurant_payment_events"
  on payment_events for select
  using (
    session_id in (
      select table_sessions.id from table_sessions
      where table_sessions.restaurant_id in (select current_manager_restaurant_ids())
    )
  );
