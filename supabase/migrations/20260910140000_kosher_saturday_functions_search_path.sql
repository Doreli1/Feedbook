-- Fixes a real security-advisor finding flagged right after the previous
-- migration: the three new Shabbat-enforcement functions were created
-- without a pinned search_path, letting a malicious search_path (set by
-- whoever calls them) potentially redirect unqualified identifiers to a
-- attacker-controlled schema. All three already fully-qualify their own
-- references, but pinning search_path is the standard hardening regardless
-- (see Supabase's function_search_path_mutable lint).
alter function restaurant_hours_excludes_saturday(jsonb) set search_path = public;
alter function restaurant_hours_strip_saturday(jsonb) set search_path = public;
alter function enforce_kosher_saturday_closed() set search_path = public;
