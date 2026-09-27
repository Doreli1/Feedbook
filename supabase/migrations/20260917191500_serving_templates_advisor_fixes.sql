-- Advisor follow-up for 20260917190000_menu_category_serving_templates.sql:
-- the price-required trigger function was missing `set search_path`
-- (the other two trigger functions in that migration already had it — this
-- one was simply missed), and the two new foreign keys had no covering
-- index, both flagged by get_advisors right after applying to cloud.
create or replace function enforce_dish_size_option_price_required() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.category_serving_option_id is null and new.price is null then
    raise exception 'PRICE_REQUIRED_FOR_FREE_TEXT_SIZE_OPTION';
  end if;
  return new;
end;
$$;

create index dish_size_options_category_serving_option_id_idx
  on dish_size_options (category_serving_option_id);

create index menu_category_serving_options_category_id_idx
  on menu_category_serving_options (category_id);
