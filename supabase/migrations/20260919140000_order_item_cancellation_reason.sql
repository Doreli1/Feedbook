-- Requested 2026-09-19: before a diner's cancellation actually goes through,
-- the app now asks them to pick a reason (a short fixed list + free-text
-- "אחר") — confirmed to be stored server-side and visible to staff (the
-- existing "היסטוריה" tab), not just a client-side UX gate. Free text, no
-- CHECK constraint: "אחר" carries whatever the diner typed, and a fixed
-- list value is stored as its own display text too (simpler than a second
-- reason-code column no UI currently needs).
alter table order_items add column cancellation_reason text;
