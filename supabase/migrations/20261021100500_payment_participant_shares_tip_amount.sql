-- Feedbook Backend Schema — Domain: Payments
-- §6.2 payment_participant_shares documents tip_amount ("נתפס בזמן
-- confirm-participant-payment, בנפרד לגמרי מ-service_fee" — captured
-- 2026-10-07 in Settlement Architecture §3.6) but the column was never
-- actually migrated — found 2026-10-21 while wiring the Accounts module's
-- tip total against real local data (PostgREST 42703: column doesn't
-- exist). Added now to match the documented schema; still unpopulated
-- until the real confirm-participant-payment flow lands in Stage 6.
alter table payment_participant_shares
  add column tip_amount numeric(10, 2) not null default 0;
