-- Same recurring bug class as 20260919160000 / 20261101150000: Web Admin's
-- useBarStatus.ts (2026-11-02) now subscribes to postgres_changes on
-- `restaurants` (bar_manual_override/bar_hours changing from another
-- screen or tab) so the bar status indicator updates live — but `restaurants`
-- was never added to the supabase_realtime publication, so no such
-- subscription could ever fire.
alter publication supabase_realtime add table restaurants;
