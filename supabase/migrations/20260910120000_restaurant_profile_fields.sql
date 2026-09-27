-- Restaurant profile fields for the diner "פרטי מסעדה" screen (App Flow §2
-- flow-table row 6): a short description/agenda blurb, general cuisine
-- tags, and an owner-editable order-cancellation window.
--
-- cuisine_tags business rule, confirmed directly with the product owner
-- (2026-09-10): a restaurant may carry any combination of cuisine tags
-- EXCEPT that a kosher-certified restaurant may pick only one of
-- dairy/meat, never both (a kosher establishment is strictly dairy or
-- meat, never mixed) — fish/asian/etc. aren't part of that exclusivity and
-- combine freely with either. Enforced as a real CHECK spanning both
-- columns so it can't be bypassed by editing kosher_status and
-- cuisine_tags in separate statements.
alter table restaurants
  add column description text,
  add column cuisine_tags text[] not null default '{}'::text[],
  add column cancellation_window_minutes integer;

alter table restaurants
  add constraint cuisine_tags_valid_values
  check (cuisine_tags <@ array['dairy', 'meat', 'fish', 'asian']::text[]);

alter table restaurants
  add constraint cuisine_tags_kosher_exclusive
  check (
    kosher_status <> 'certified'
    or not (cuisine_tags @> array['dairy']::text[] and cuisine_tags @> array['meat']::text[])
  );
