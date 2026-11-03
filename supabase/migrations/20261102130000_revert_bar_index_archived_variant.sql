-- Reverted same day (2026-11-02) — the user clarified there's no real use
-- case for creating a NEW bar table while an old one sits archived: a
-- restaurant has exactly one conceptual bar, and the only path back after
-- archiving it is restoring it (TableManagerForm's own archive-section
-- "שחזור" button), never creating a parallel second one. So the original,
-- simpler "at most one bar row per restaurant, period — active or
-- archived" constraint was correct all along. This undoes
-- 20261102091500_table_archive.sql's index swap (which this same local DB
-- had applied, but the cloud project's safety gate had actually already
-- refused to apply — so this migration also brings local back in line
-- with cloud, not just with the new product decision).
drop index one_bar_table_per_restaurant;
create unique index one_bar_table_per_restaurant on tables (restaurant_id) where table_type = 'bar';
