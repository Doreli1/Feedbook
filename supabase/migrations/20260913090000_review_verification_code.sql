-- Feedbook Backend Schema — in-app review verification code (Stage 5 alignment follow-up, 2026-09-13).
-- Source: user request 2026-09-13, refining the original reviews.verification_code_hash
-- design (Backend Schema §7, which assumed a code EMAILED after the visit).
--
-- Simplification adopted: instead of emailing a one-time code post-visit, each
-- participant gets a 4-digit code the moment they join, shown persistently on
-- the mobile "ניהול חשבון" (account) tab alongside their personal account
-- number (session_participants.sub_account_number). To write a review later,
-- the diner supplies both together as a verification pair. Stored in the
-- clear (not hashed) — unlike the eventual reviews.verification_code_hash,
-- this is a per-participant convenience code the app must be able to
-- redisplay to its own legitimate owner at any time, not a one-time secret;
-- reviews.verification_code_hash still hashes whatever code was entered at
-- the moment a specific review is created, preserving that column's original
-- tamper-evidence purpose unchanged.
alter table session_participants
  add column review_verification_code text;

update session_participants
set review_verification_code = lpad(floor(random() * 10000)::text, 4, '0')
where review_verification_code is null;

alter table session_participants
  alter column review_verification_code set not null;

alter table session_participants
  add constraint review_verification_code_format
  check (review_verification_code ~ '^[0-9]{4}$');
