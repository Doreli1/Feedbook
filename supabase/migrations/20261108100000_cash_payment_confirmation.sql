-- Cash-payment confirmation flow (2026-11-08, explicit user request).
--
-- The mobile app's bill-summary screen lets a diner select "מזומן" as their
-- payment preference; doing so fires a real waiter_calls row (same
-- mechanism as the plain call-waiter button) so a waiter physically comes
-- collect payment. Until now waiter_calls had no way to say WHICH diner a
-- call is about (resolve-waiter-call's own comment: "waiter_calls has no
-- participant_id column recording which specific diner at the table made
-- the call") and no way to distinguish a generic call from a structured
-- request a specific Edge Function action should attach to. This adds
-- exactly that, scoped to this one new call shape — not a general
-- participant_id on every call, which stays the documented, separate gap it
-- already was.

alter table waiter_calls
  add column call_type text not null default 'general'
    check (call_type in ('general', 'cash_payment'));

alter table waiter_calls
  add column cash_payment_participant_id uuid references session_participants(id);

-- A 'cash_payment' call always names the diner it's about; a 'general' call
-- never does — keeps the two new columns from drifting out of sync with
-- each other instead of relying on every caller to remember the pairing.
alter table waiter_calls
  add constraint waiter_calls_cash_payment_participant_consistency
  check (
    (call_type = 'cash_payment' and cash_payment_participant_id is not null)
    or (call_type = 'general' and cash_payment_participant_id is null)
  );

-- notifications.type gains 'payment_completed' — the diner-facing "your
-- cash payment was confirmed, here's your receipt" message sent once staff
-- declares the cash payment received (confirm-cash-payment Edge Function).
-- Shown via the mail icon (HeaderMailIcon), not the bell (reserved for
-- order events — see that component's own comment).
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type = any (array['order_status', 'waiter_ack', 'promotion', 'inventory_alert', 'review_ready', 'payment_completed']));
