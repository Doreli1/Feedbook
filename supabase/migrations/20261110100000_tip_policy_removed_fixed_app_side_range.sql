-- Tip policy redesign, take two (2026-11-10, explicit user decision — a
-- more efficient solution than the per-restaurant policy from 2026-11-09):
-- the restaurant-side "מדיניות טיפים" toggle + minimum-percent dropdown
-- (20261109090000_restaurant_minimum_tip_percent.sql,
-- 20261109100000_tip_policy_enabled_and_range.sql) is removed entirely.
-- Tipping is now a fixed, app-wide choice every diner makes for themselves
-- on the bill-summary screen (0/5/10/15/20/25% chips + a free-amount
-- option, no restaurant-configured floor or on/off switch) — see
-- bill-summary.tsx's own comment for the full new flow.
alter table restaurants drop constraint restaurants_minimum_tip_percent_check;
alter table restaurants drop column tip_policy_enabled;
alter table restaurants drop column minimum_tip_percent;

-- "X סועדים נתנו טיפ היום" (2026-11-10, explicit user request) — a real,
-- restaurant-scoped social-proof counter for the new tip card, same
-- "aggregate across every diner's own payment rows" shape as
-- get_dish_order_stats (hence security definer: a diner's own RLS
-- (participant_manage_own_share) only ever lets them see their OWN share
-- rows, never another diner's, so this needs to run as the definer to
-- count across the whole restaurant). "Today" matches that same function's
-- own date_trunc('day', now()) convention (UTC day boundary) rather than
-- bar_hours_active_now's Asia/Jerusalem conversion — this is a diner-facing
-- activity counter in the same family as dish order stats, not a schedule
-- evaluation, so it stays consistent with that precedent instead of
-- introducing a second "today" definition into the same screen family.
-- Counts distinct participants, not raw share rows, in case a diner ever
-- ends up with more than one paid share in a day (e.g. a bar diner closing
-- out more than once) — each diner should count once regardless.
create or replace function get_tippers_today_count(p_restaurant_id uuid)
returns int
language sql
security definer
set search_path = public
stable
as $$
  select count(distinct pps.participant_id)::int
  from payment_participant_shares pps
  join payments p on p.id = pps.payment_id
  join table_sessions ts on ts.id = p.session_id
  where ts.restaurant_id = p_restaurant_id
    and pps.tip_amount <> 0
    and pps.paid_at >= date_trunc('day', now());
$$;

grant execute on function get_tippers_today_count(uuid) to authenticated;
