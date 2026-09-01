-- Feedbook Backend Schema — Rename loyalty program: Genius -> Feedstars
-- Source: PRD §13.3 flagged "Genius" as a deliberate echo of Booking.com's
-- registered Genius loyalty program, a real trademark-collision risk. Renamed
-- before any UI/marketing exists, so this is a pure identifier rename with no
-- production user data or live copy referencing the old name.

alter table genius_tiers rename to feedstars_tiers;
alter index genius_tiers_pkey rename to feedstars_tiers_pkey;

alter policy "public_read_genius_tiers" on feedstars_tiers
  rename to "public_read_feedstars_tiers";

alter table user_profiles rename column genius_tier_id to feedstars_tier_id;
alter table user_profiles rename column genius_activity_score to feedstars_activity_score;
alter table user_profiles rename constraint user_profiles_genius_tier_id_fkey to user_profiles_feedstars_tier_id_fkey;
