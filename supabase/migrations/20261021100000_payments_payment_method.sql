-- Feedbook Backend Schema — Domain: Payments
-- Records HOW an account was actually settled (Tranzila card charge once
-- Stage 6 lands, or cash handed directly to staff) — flagged as a real gap
-- 2026-10-21: the Accounts module master table needs to show this per
-- PRD §5.1.5 ("קליטת אמצעי תשלום שונים"), but no column ever carried it.
-- Not populated by any flow yet (payments/payment_participant_shares are
-- still empty — the real payment flow is Stage 6), same forward-wiring
-- pattern already used for payment_events: the column and the UI are ready
-- ahead of the data that will fill them.
alter table payments
  add column payment_method text
    check (payment_method in ('credit_card', 'cash'));
