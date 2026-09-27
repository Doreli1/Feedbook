-- Revert 20260917190000_menu_category_serving_templates.sql +
-- 20260917191500_serving_templates_advisor_fixes.sql (2026-09-18). User
-- feedback after seeing the feature live: serving-alternative definition
-- already belongs at the dish level — each dish already had its own
-- free-text size-options editor — and a separate category-wide template
-- didn't match how the menu is actually structured in the user's mental
-- model ("כל צורות ההגשה זה ברמת המנה"). Reverting the whole mechanism;
-- the per-dish free-text size-options field stays exactly as it was before
-- this feature, with only its label/hint microcopy now adapting by
-- category type (food/drink).
drop trigger if exists menu_category_serving_options_seed_dishes on menu_category_serving_options;
drop trigger if exists menu_category_serving_options_sync_name on menu_category_serving_options;
drop trigger if exists dish_size_options_price_required on dish_size_options;

drop function if exists add_serving_option_to_existing_dishes();
drop function if exists sync_dish_size_options_from_category_template();
drop function if exists enforce_dish_size_option_price_required();

alter table dish_size_options
  drop column if exists category_serving_option_id;

alter table dish_size_options
  alter column price set not null;

drop table if exists menu_category_serving_options;
