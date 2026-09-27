-- Web Admin gains UI for the dish-modifier-groups mechanism that already
-- existed (built 2026-09-12 for mobile ordering, never had an admin editor)
-- for two specific, fixed-identity use cases: "תוספות למנה" (paid/free
-- add-ons, selection_type='multiple') and "מידת עשייה" (required doneness
-- level, selection_type='single'). Both need an optional photo per option
-- ("תוספת אבוקדו" with a picture, or a "מדיום" doneness reference photo) —
-- a genuinely new capability, since dish_modifier_options had no image
-- column at all.
alter table dish_modifier_options
  add column photo_url text;
