-- Adds an indoor/outdoor flag per table — e.g. a sun terrace or courtyard,
-- alongside the existing smoking_allowed flag. Not in the original PRD
-- §5.1.3 / Backend Schema §4.1 spec; added 2026-09-02 per direct product
-- request. Same convention as smoking_allowed: a plain boolean, not a
-- separate "areas" table — one flag per physical table, no grouping/naming
-- of areas themselves.
alter table tables
  add column is_outdoor boolean not null default false;
