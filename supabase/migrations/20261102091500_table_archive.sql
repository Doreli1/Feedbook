-- Table archive (2026-11-02) — root cause: deleting a table whose
-- table_sessions history is non-empty (even fully closed) always fails with
-- a foreign-key violation on table_sessions_table_id_fkey, by design — a
-- hard DELETE must never silently orphan real order/payment/review history.
-- Diagnosed directly against this table's data (session #436255, closed
-- 2026-11-01) while the user was testing "remove the bar" in
-- TableManagerForm.tsx. Documented in Backend Schema vr14 §1.5 /
-- Implementation Plan v24 / Accounts Module Spec v5 before this migration.
--
-- archived_at is the reversible alternative: TableManagerForm.tsx now tries
-- a hard DELETE first (still correct for a table that was never actually
-- used) and falls back to setting archived_at on a foreign-key violation.
-- An archived table disappears from active floor-plan/allocation UI and
-- from scan-qr, while every row that ever referenced it stays exactly as
-- it was — clearing archived_at (the "undo") is instant and loses nothing.
alter table tables add column archived_at timestamptz;

-- Was: unique (restaurant_id) where table_type = 'bar' — blocked ever
-- creating a fresh bar-type row while an old, now-archived one (with its
-- own history) still exists. "At most one ACTIVE bar per restaurant" is
-- the rule that was actually intended.
drop index one_bar_table_per_restaurant;
create unique index one_bar_table_per_restaurant on tables (restaurant_id) where table_type = 'bar' and archived_at is null;
