-- get_advisors flagged this immediately after the previous migration: the
-- composite primary key (modifier_option_id, ingredient_id) covers lookups
-- by modifier_option_id but not by ingredient_id alone, which cascade
-- deletes and "which add-ons use this ingredient" queries need.
create index modifier_option_ingredients_ingredient_id_idx
  on modifier_option_ingredients (ingredient_id);
