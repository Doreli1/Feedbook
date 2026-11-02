-- Restaurant active/inactive status (2026-11-02, user decision: schedule
-- only — no manual override, unlike the bar's hybrid model). Evaluates
-- restaurants.hours (already existed, but was purely informational — never
-- enforced anywhere) using the same bar_hours_active_now() time-of-day
-- evaluator the bar feature already built, since the evaluator itself
-- doesn't care what the jsonb {rules:[...]} is called.
--
-- Deliberately independent from bar_is_active: the bar feature exists
-- specifically so a restaurant can be inactive (kitchen/floor closed) while
-- its bar is active (the "becomes a dance bar at night" case) — so this
-- function must never gate the bar, and bar_is_active must never call this.
create or replace function restaurant_is_active(p_restaurant_id uuid)
returns boolean
language sql
stable
as $$
  select case
    when r.hours is not null
      and jsonb_typeof(r.hours -> 'rules') = 'array'
      and jsonb_array_length(r.hours -> 'rules') > 0
      then bar_hours_active_now(r.hours)
    else true
  end
  from restaurants r
  where r.id = p_restaurant_id;
$$;

grant execute on function restaurant_is_active(uuid) to authenticated;
