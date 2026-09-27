-- Real-time, data-driven dish bullets on the diner-facing menu (2026-09-24) —
-- see the "Real-time, data-driven dish bullets" plan. Every bullet must be
-- backed by genuine live data (never a fixed/fabricated claim) per the
-- user's own conclusion after researching the EU's dark-patterns
-- enforcement against Booking.com: the legal risk there wasn't "marketplace
-- vs single business", it was unsubstantiated urgency/social-proof claims.
--
-- Both RPCs below exist because the diner's own Supabase client cannot see
-- the underlying tables at all: orders/order_items RLS only grants a diner
-- their own rows or staff their own restaurant's
-- (20260830145852_row_level_security.sql), and ingredients/dish_ingredients
-- are staff-only (same file) — exact stock quantities, SKUs, and supplier
-- info are private operational data. `security definer` crosses that RLS
-- boundary for one narrow, pre-aggregated purpose only, the same pattern
-- already used by sync_dish_likes_count() in
-- 20260914111000_dish_likes_trigger_security_definer.sql — neither function
-- below ever returns a raw order row or an exact stock quantity, only the
-- minimal aggregate a diner's own menu screen needs.

-- A restaurant marks its own dish's key ingredient(s) as critical — scoped
-- to dish_ingredients only (the dish's own base recipe), not
-- modifier_option_ingredients (add-ons): an optional extra running low
-- shouldn't flag the whole dish as almost-out.
alter table dish_ingredients
  add column is_critical boolean not null default false;

create or replace function get_dish_order_stats(p_restaurant_id uuid)
returns table (dish_id uuid, orders_today int, last_ordered_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select oi.dish_id, count(*)::int, max(o.placed_at)
  from order_items oi
  join orders o on o.id = oi.order_id
  join table_sessions ts on ts.id = o.session_id
  join dishes d on d.id = oi.dish_id
  where d.restaurant_id = p_restaurant_id
    and o.placed_at >= date_trunc('day', now())
    and oi.status <> 'cancelled'
  group by oi.dish_id;
$$;

grant execute on function get_dish_order_stats(uuid) to authenticated;

create or replace function get_dish_critical_stock_status(p_restaurant_id uuid)
returns table (dish_id uuid, status text) -- 'low' | 'out'
language sql
security definer
set search_path = public
stable
as $$
  select di.dish_id,
    case when min(i.quantity_in_stock) <= 0 then 'out' else 'low' end
  from dish_ingredients di
  join ingredients i on i.id = di.ingredient_id
  where di.is_critical
    and i.restaurant_id = p_restaurant_id
    and i.quantity_in_stock < i.threshold_quantity
  group by di.dish_id;
$$;

grant execute on function get_dish_critical_stock_status(uuid) to authenticated;
