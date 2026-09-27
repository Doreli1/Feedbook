-- Feedbook Backend Schema — Feedstars dish-level eligibility (2026-09-15).
--
-- User decision (this session): a dish can be marked as participating in
-- the Feedstars program; a diner viewing an eligible dish is entitled to a
-- discount based on their CURRENT tier, expressed as a percentage per tier
-- (their choice among percentage/fixed-amount/single-perk models).
--
-- feedstars_tiers existed only as literal placeholder rows since the
-- 2026-09-01 Genius→Feedstars rename ("Placeholder Tier 1/2/3",
-- "TODO: replace with real tier definition") — the PRD (§5.2.7) explicitly
-- deferred designing the real tier/benefit structure. This migration is
-- that design round for the one piece actually requested: the discount
-- percentage per tier, replacing the placeholder names/descriptions with
-- real ones. min_activity_score thresholds (0/100/500) are left as they
-- were — changing what "activity" means/how it accrues was not asked here
-- and is a separate, still-open piece (see the follow-up note that
-- accompanies this migration in conversation).
alter table dishes add column feedstars_eligible boolean not null default false;

alter table feedstars_tiers add column discount_percentage numeric(4, 1) not null default 0
  check (discount_percentage >= 0 and discount_percentage <= 100);

update feedstars_tiers set
  tier_name = 'רמה 1',
  discount_percentage = 5,
  benefits_description = '5% הנחה על מנות המשתתפות בתוכנית Feedstars.'
  where id = 1;

update feedstars_tiers set
  tier_name = 'רמה 2',
  discount_percentage = 10,
  benefits_description = '10% הנחה על מנות המשתתפות בתוכנית Feedstars.'
  where id = 2;

update feedstars_tiers set
  tier_name = 'רמה 3',
  discount_percentage = 15,
  benefits_description = '15% הנחה על מנות המשתתפות בתוכנית Feedstars.'
  where id = 3;
