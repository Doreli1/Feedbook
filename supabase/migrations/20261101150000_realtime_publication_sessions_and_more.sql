-- Same systemic gap as 20260919160000_realtime_publication_tables.sql,
-- found 2026-11-01 while diagnosing "ending a visit doesn't update the
-- table's status live in the Web Admin, only on manual refresh": a table
-- being subscribed to via postgres_changes doesn't mean it's actually in
-- the Realtime publication — each one has to be added explicitly. Re-ran
-- the same audit (grepped every `.on('postgres_changes', { ... table: ... }`
-- call across apps/web and apps/mobile and diffed against
-- `pg_publication_tables`) and found five more tables added to the
-- publication-less `supabase_realtime` since that last audit:
-- useTables.ts (tables, 2026-10-15), useAccounts.ts (table_sessions),
-- EndVisitReasonModal's flow (session_participants, indirectly via
-- table_sessions's own status flip), order-item cancellation requests, and
-- dish likes — each shipped with a live subscription that was silently
-- inert from day one, same failure mode as before.
alter publication supabase_realtime add table tables;
alter publication supabase_realtime add table table_sessions;
alter publication supabase_realtime add table session_participants;
alter publication supabase_realtime add table order_item_cancellation_requests;
alter publication supabase_realtime add table dish_likes;
