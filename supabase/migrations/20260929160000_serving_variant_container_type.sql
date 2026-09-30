-- Splits a drink add-on's serving-format rows into an explicit container
-- type (בקבוק/חבית) plus a size label within it (2026-09-29, follow-up per
-- explicit user request) — previously "name" was a single free-text field
-- ("חבית - ליטר") with no structured way for the mobile client to know
-- whether an option offers bottle, draft, or both, or to branch its picker
-- UI on that. default 'bottle' is safe for any already-saved row (none in
-- real use yet — this table shipped the same day).
alter table modifier_option_serving_variants
  add column container_type text not null default 'bottle' check (container_type in ('bottle', 'draft'));
