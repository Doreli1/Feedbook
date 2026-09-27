-- Feedbook Backend Schema — dish profitability: VAT-adjusted base price +
-- indirect (overhead) cost allocation (2026-09-16).
--
-- User decision (this session): ProfitabilityCard's margin only ever
-- subtracted a dish's linked ingredient cost (direct cost) from its
-- menu price — no restaurant carries any notion of indirect/overhead
-- expense at all today, and the menu price itself was never adjusted for
-- VAT (Israeli law requires the displayed price to already include it, so
-- dishes.price is VAT-inclusive — the real "profit" base is the price
-- BEFORE VAT). Standard restaurant cost-accounting practice (Toast POS,
-- Nisbets, Lightspeed menu-costing guides): total dish cost = direct cost
-- + indirect cost, where indirect cost is usually allocated as
-- (total monthly overhead) / (dishes sold in the same period) — the
-- simplest and most common method, and the one the user picked over
-- revenue-weighted allocation.

-- 18% is the VAT rate in Israel as of this project's timeline — kept as a
-- per-restaurant setting (not a hardcoded constant) since the rate changes
-- by law periodically and this product's own stated vision is eventual
-- multi-country deployment (see project_restaurant_content_not_bilingual).
alter table restaurants add column vat_rate_percent numeric(4, 1) not null default 18
  check (vat_rate_percent >= 0 and vat_rate_percent <= 100);

-- One row per (restaurant, category) — an upsert-style settings table, not
-- a free-form ledger: the admin screen always shows exactly these 6
-- category inputs (defaulting to 0 when no row exists yet) rather than a
-- growing list of arbitrary line items, matching how simple this needs to
-- stay for a monthly-overhead input.
create table overhead_expenses (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  category text not null check (category in ('rent', 'utilities', 'labor', 'insurance', 'marketing', 'other')),
  monthly_amount numeric(10, 2) not null default 0 check (monthly_amount >= 0),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, category)
);

alter table overhead_expenses enable row level security;

-- Same pattern as every other staff-owned operational table (ingredients,
-- tables, purchase_orders): any staff member of the restaurant can manage
-- its overhead figures.
create policy "staff_manage_own_restaurant_overhead_expenses"
  on overhead_expenses for all
  using (restaurant_id in (select current_staff_restaurant_ids()))
  with check (restaurant_id in (select current_staff_restaurant_ids()));
