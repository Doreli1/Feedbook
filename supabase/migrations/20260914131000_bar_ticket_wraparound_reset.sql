-- Feedbook Backend Schema — bar ticket counter: wrap-around instead of
-- midnight reset (2026-09-15, follow-up to 20260914130000).
--
-- The original design reset the counter at midnight (current_date). A bar
-- that operates past midnight would have diners who ordered right before
-- midnight and diners who ordered right after both holding tickets drawn
-- from the same freshly-reset low range (e.g. two different people both
-- holding "0003") — a real collision risk for exactly the businesses most
-- likely to use this feature. There is no clean per-restaurant "day
-- boundary" to reset on that avoids this for every possible operating
-- schedule.
--
-- Fix: drop the date dimension entirely. The counter just wraps from 9999
-- back to 1 whenever it's incremented past 9999 — the same mechanism a real
-- deli-counter ticket roll uses. Collision would require 9999 simultaneous
-- unpicked-up bar orders outstanding at once, which is not a real scenario.
alter table bar_ticket_counters drop column ticket_date;

create or replace function next_bar_ticket_number(p_restaurant_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number int;
begin
  insert into bar_ticket_counters (restaurant_id, last_number)
    values (p_restaurant_id, 1)
  on conflict (restaurant_id) do update
    set last_number = case
          when bar_ticket_counters.last_number >= 9999 then 1
          else bar_ticket_counters.last_number + 1
        end
  returning last_number into v_number;
  return v_number;
end;
$$;
