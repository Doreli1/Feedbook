-- Feedbook Backend Schema — Seed: genius_tiers
-- Source: 5.Feedbook_Backend_Schema.docx §13: "genius_tiers מאוכלסת בנתוני
-- Seed קבועים (לא דרך ה-UI), בהתאם למספר הרמות שיוגדר עסקית."
--
-- PLACEHOLDER DATA — the design doc explicitly defers tier count, names,
-- thresholds and benefits to a business decision not yet made. The three
-- rows below exist only so genius_tier_id has valid values to reference
-- during development/testing. Replace with real values via a follow-up
-- migration once the business defines the actual loyalty program.

insert into genius_tiers (id, tier_name, min_activity_score, benefits_description)
values
  (1, 'Placeholder Tier 1', 0, 'TODO: replace with real tier definition'),
  (2, 'Placeholder Tier 2', 100, 'TODO: replace with real tier definition'),
  (3, 'Placeholder Tier 3', 500, 'TODO: replace with real tier definition');
