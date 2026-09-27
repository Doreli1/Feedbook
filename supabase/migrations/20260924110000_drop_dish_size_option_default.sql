-- Per the user's request (2026-09-24): the diner-side app must never
-- pre-select a serving size — every size option is presented neutrally, and
-- the diner must explicitly pick exactly one before an item can be added to
-- an order. "Default" served two purposes before this: (1) which size's
-- price synced onto dishes.price, and (2) which size the mobile app
-- pre-selected. Both are now handled without any "default" concept at all —
-- dishes.price syncs to the minimum size price instead (the same min-price
-- the dish list/mobile browse screens already independently compute and
-- display as "from ₪X", completely unaffected by this column), and mobile
-- simply starts with nothing selected. Nothing else in the codebase reads
-- is_default, so it's dropped outright rather than left unused.
drop index if exists dish_size_options_one_default;

alter table dish_size_options drop column is_default;
