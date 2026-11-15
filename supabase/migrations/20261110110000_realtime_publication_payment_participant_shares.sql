-- Real gap found while making the "X סועדים נתנו טיפ היום" counter live
-- (2026-11-10): payment_participant_shares was never added to the
-- supabase_realtime publication, so bill-summary.tsx's new postgres_changes
-- subscription on it would silently never fire — same "unfiltered
-- subscribe, let the restaurant-scoped RPC refetch narrow it down" shape as
-- useDishOrderStats's own order_items channel, but that only works at all
-- if the table is actually in the publication to begin with.
alter publication supabase_realtime add table payment_participant_shares;
