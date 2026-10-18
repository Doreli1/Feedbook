-- Real gap found 2026-10-18 (user request): there was no way to record when
-- a kosher certificate expires, so there was nothing to validate against or
-- warn an owner about before it lapses. A plain date (not timestamptz) —
-- expiry is a calendar date, same convention a real printed certificate
-- uses, with no time-of-day component to track.
alter table restaurants
  add column kosher_certificate_expires_at date;
