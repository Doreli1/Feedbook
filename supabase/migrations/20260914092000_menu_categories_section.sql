-- Feedbook Backend Schema — food/drink category split (Stage 5 real
-- implementation, 2026-09-14).
-- Source: mockup 7.1-Meals menus.JPG — the menu screen's top level is a
-- "מנות / שתייה" (dishes / drinks) toggle above the category cards, which
-- menu_categories had no column to back. Existing categories all default to
-- 'food'; restaurant staff can manually reclassify any drink categories
-- afterward via the Web Admin menu manager — auto-detecting this from the
-- category name is out of scope.
alter table menu_categories
  add column section text not null default 'food' check (section in ('food', 'drink'));
