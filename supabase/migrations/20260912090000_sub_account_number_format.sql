-- Enforce PRD §4 step 4 / API contract: every session_participants row gets a
-- 6-digit personal account number, not an arbitrary string. Existing rows
-- (dev/local data) predate this rule, so backfill them to a random 6-digit
-- value before adding the hard CHECK constraint — a CHECK is validated
-- against all existing rows at creation time.
update session_participants
set sub_account_number = lpad(floor(random() * 1000000)::text, 6, '0')
where sub_account_number !~ '^[0-9]{6}$';

alter table session_participants
  add constraint sub_account_number_format
  check (sub_account_number ~ '^[0-9]{6}$');
