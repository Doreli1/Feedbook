-- Bar menu scoping (2026-10-15, user decision, Implementation Plan §10):
-- some restaurants' bars serve a mixed subset of the full menu (mostly
-- drinks, but also e.g. pizza/veggie platter/fries) that a category-level
-- split (menu_categories.section = 'food'/'drink') can't express — needs
-- dish-level granularity. Default true: no existing restaurant's bar menu
-- changes until it opts in by unchecking specific dishes.
alter table dishes add column bar_orderable boolean not null default true;
