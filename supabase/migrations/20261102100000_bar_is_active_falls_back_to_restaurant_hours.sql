-- Correction found 2026-11-02 after the user tested the default behavior:
-- bar_is_active (20261102090000_bar_active_status.sql) treated an
-- unconfigured bar_hours as "always active", unconditionally. The intended
-- default is narrower: a bar with no schedule of its own should follow the
-- RESTAURANT's own general operating hours (restaurants.hours) instead —
-- "always active" is only the final fallback when the restaurant itself
-- has no hours configured either (nothing to go by at all).
create or replace function bar_is_active(p_restaurant_id uuid)
returns boolean
language sql
stable
as $$
  select case
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
