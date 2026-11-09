-- Restaurant-configured minimum tip percentage (2026-11-09, explicit user
-- request): the mobile app's bill-summary tip chips used to be hardcoded
-- 10/15/20/25% regardless of restaurant — this lets each restaurant set its
-- own floor, in steps of 5, and the diner app generates its quick-select
-- chips starting from that floor (see bill-summary.tsx's own comment).
-- Public-read, same as every other diner-facing restaurant field (name,
-- hours, cuisine_tags, ...) — a diner must be able to see this before
-- ever signing in as staff, same reasoning as every other Public-Read
-- restaurant column (Backend Schema #10).

alter table restaurants
  add column minimum_tip_percent integer not null default 10
    check (minimum_tip_percent >= 0 and minimum_tip_percent <= 50 and minimum_tip_percent % 5 = 0);
