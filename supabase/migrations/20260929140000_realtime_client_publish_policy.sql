-- Fix the new "diners viewing now" presence feature never showing anything,
-- for anyone, ever (2026-09-29). Root cause: every broadcast in this schema
-- until now was server-originated — a security definer PL/pgSQL trigger
-- calling realtime.send() (see 20260927090000_inventory_change_broadcast.sql,
-- 20260929120000_dish_view_stats.sql), which runs as the function owner and
-- bypasses RLS on realtime.messages entirely. Presence is the first feature
-- where the DINER'S OWN CLIENT publishes directly (channel.track() sends a
-- message the client itself originates, not a DB trigger) — and
-- realtime.messages only ever had a SELECT policy
-- (authenticated_receive_broadcasts), no INSERT policy, so every client-side
-- publish attempt was silently rejected by Realtime's authorization check
-- (a synthetic RLS check against the channel's topic, not a literal
-- persisted row) with nothing surfacing as a JS exception to notice.
--
-- Scoped the same (blanket, no topic restriction) as the existing SELECT
-- policy for consistency — this schema has no per-topic authorization
-- granularity yet, and a diner's own client only ever publishes to topics it
-- has legitimate reason to (dish_presence:<restaurant_id>, matching the
-- table session they already joined via a validated qr_token).
create policy "authenticated_send_broadcasts"
  on realtime.messages
  for insert
  to authenticated
  with check (true);
