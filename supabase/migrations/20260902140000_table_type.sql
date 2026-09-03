-- Adds an optional table_type label — used only by the registration wizard's
-- bulk quick-add UI to group tables it created together for display (e.g.
-- "5 שולחנות משפחתיים") and to auto-number them. Not used by any backend
-- business logic (order/session/bill-split code keys off capacity, not
-- type) — same additive, display-only convention as is_outdoor. Null means
-- a manually/custom-added table with no preset type.
alter table tables
  add column table_type text
    check (table_type is null or table_type in ('couple', 'family', 'family_extended', 'high', 'bar'));
