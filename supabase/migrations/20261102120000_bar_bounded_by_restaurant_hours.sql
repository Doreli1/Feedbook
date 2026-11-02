-- Reversed decision (2026-11-02, user): the bar's active window is no
-- longer independent of the restaurant's own hours — a restaurant can
-- never be "closed" while its bar is "active". The bar's own schedule is
-- now always a SUB-window of the restaurant's general hours, not a
-- parallel, independent one. This replaces the earlier "dance bar at
-- night" design (bar_is_active deliberately never checking
-- restaurant_is_active) — that scenario is still achievable, but now only
-- by configuring the restaurant's own general hours to span the whole
-- period the business is open in any capacity (dining AND bar), with
-- bar_hours narrower within it; see RestaurantDetailsForm.tsx's new
-- containment validation (apps/web/src/lib/hoursContainment.ts), which
-- blocks saving a bar-hours rule that isn't covered by the general hours.
--
-- Hard gate, not just a UI nudge: even a manual bar_manual_override='open'
-- can no longer force the bar active while the restaurant itself is
-- inactive — the override only ever narrows within the restaurant's own
-- window, never extends past it.
create or replace function bar_is_active(p_restaurant_id uuid)
returns boolean
language sql
stable
as $$
  select case
    when not restaurant_is_active(p_restaurant_id) then false
    when r.bar_manual_override = 'open' then true
    when r.bar_manual_override = 'closed' then false
    when r.bar_hours is not null
      and jsonb_typeof(r.bar_hours -> 'rules') = 'array'
      and jsonb_array_length(r.bar_hours -> 'rules') > 0
      then bar_hours_active_now(r.bar_hours)
    when r.hours is not null
      and jsonb_typeof(r.hours -> 'rules') = 'array'
      and jsonb_array_length(r.hours -> 'rules') > 0
      then bar_hours_active_now(r.hours)
    else true
  end
  from restaurants r
  where r.id = p_restaurant_id;
$$;
