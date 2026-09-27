-- Same systemic gap as 20260919160000_realtime_publication_tables.sql, found
-- the same way (a real save that should have updated live on mobile without
-- a manual refresh, didn't): `dishes`, `menu_categories`,
-- `dish_size_options`, `dish_modifier_groups` and `dish_modifier_options`
-- were never added to the supabase_realtime publication, so
-- MenuBrowser.tsx's useMenuData had nothing to subscribe to even once a
-- postgres_changes listener was added — every admin save only ever reached
-- a diner's screen on their next screen remount, never live.
--
-- dish_ingredients is included too even though nothing in useMenuData reads
-- it directly — useDishCriticalStock (20260924120000) already subscribes to
-- it for the critical-stock bullets, and that subscription has been
-- silently inert the same way for the same reason since it was written.
alter publication supabase_realtime add table menu_categories;
alter publication supabase_realtime add table dishes;
alter publication supabase_realtime add table dish_size_options;
alter publication supabase_realtime add table dish_modifier_groups;
alter publication supabase_realtime add table dish_modifier_options;
alter publication supabase_realtime add table dish_ingredients;
