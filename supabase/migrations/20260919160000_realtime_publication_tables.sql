-- Real, systemic bug found 2026-09-19 while diagnosing "notifications never
-- arrive live": `select * from pg_publication_tables where pubname =
-- 'supabase_realtime'` returned ZERO rows on BOTH local and cloud — no
-- table has ever actually been in the Realtime publication, on either
-- environment. Every earlier "confirmed via Realtime" QA entry (low-stock
-- alerts, kitchen queue, waiter calls) must have observed a page
-- reload/remount picking up fresh data via the initial fetch, not an actual
-- live postgres_changes push — the subscriptions were always silently
-- inert. This never surfaced before because every one of those flows also
-- has a plain initial fetch that eventually shows the right data on its own
-- (next reload/remount); notifications was the first feature where a
-- diner/staff member watching the screen in real time, with no reason to
-- reload, expected to *see* the badge change — which is what finally made
-- the gap visible.
--
-- Fixes it for every table the app already subscribes to via
-- postgres_changes (grepped from apps/web and apps/mobile), not just
-- notifications — ingredients (low-stock), order_items (kitchen queue +
-- diner tracker), and waiter_calls were equally broken.
alter publication supabase_realtime add table ingredients;
alter publication supabase_realtime add table order_items;
alter publication supabase_realtime add table waiter_calls;
alter publication supabase_realtime add table notifications;
