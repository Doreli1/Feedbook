-- Tip policy redesign (2026-11-09, same-day follow-up to
-- 20261109090000_restaurant_minimum_tip_percent.sql): the restaurant-side
-- field becomes a real "מדיניות טיפים" section with its own enable/disable
-- toggle (mirroring the mobile bill-summary screen's own tip card), and the
-- minimum-percent dropdown's own range narrows from 0-50 in steps of 5 to a
-- plain 5-10 (integers, no step requirement needed at that narrow a range).

alter table restaurants
  add column tip_policy_enabled boolean not null default true;

alter table restaurants drop constraint restaurants_minimum_tip_percent_check;
alter table restaurants add constraint restaurants_minimum_tip_percent_check
  check (minimum_tip_percent >= 5 and minimum_tip_percent <= 10);
