-- PRD §5.1.3 requires table status management (available/occupied/awaiting
-- a third state before it can be reused) — the Web Admin's "שולחנות" screen
-- never actually surfaced tables.status at all. While building that display
-- (2026-10-15, user report), the user corrected the PRD's own third-state
-- name: "ממתין לחשבון" (awaiting_payment) assumes a waiter-mediated bill,
-- but Feedbook's diners pay entirely from their own phone (no waiter, no
-- terminal — PRD §2.1) — so there's no "waiting to be billed" state at all.
-- What actually needs tracking is the real physical gap between a session
-- closing and the table being ready for new diners: it needs cleaning.
-- Confirmed zero existing rows used 'awaiting_payment' (close-session never
-- actually wrote it — the check in scan-qr/index.ts was dead code).
alter table tables drop constraint tables_status_check;
alter table tables add constraint tables_status_check
  check (status = any (array['available'::text, 'occupied'::text, 'awaiting_cleaning'::text]));
