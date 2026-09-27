-- get_advisors flagged this immediately after the previous migration,
-- same class of gap as modifier_option_ingredients' own follow-up index.
create index ingredient_units_ingredient_id_idx
  on ingredient_units (ingredient_id);
