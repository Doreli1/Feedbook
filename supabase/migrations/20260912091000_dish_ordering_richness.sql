-- Feedbook Backend Schema — Booking.com-style menu richness (Stage 5 alignment, 2026-09-12).
-- Source: PRD §5.2.3 / §9 addendum 2026-09-12; Backend Schema §3.2.
--
-- is_special_value: staff-set "משתלם במיוחד" value badge (business decision,
-- not computed).
--
-- guest_rating_score: a Booking-style 0–10 score, purely derived from the
-- existing 5-star rating_avg (no independent rating pipeline, per product
-- decision). NOTE: rating_avg has no populating trigger yet anywhere in this
-- codebase — the reviews module (review_dish_ratings → dishes.rating_avg) is
-- Stage 7. Until then this generated column reads 0 for every dish; the
-- mobile UI must hide the guest-rating badge when rating_count = 0 rather
-- than display a misleading "0.0".
alter table dishes
  add column is_special_value boolean not null default false;

alter table dishes
  add column guest_rating_score numeric(3, 1)
  generated always as (round(coalesce(rating_avg, 0) * 2, 1)) stored;
