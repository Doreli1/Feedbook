-- Feedbook Backend Schema — ingredients.unit_cost
-- Per-dish profitability (PRD dashboard requirement) needs a cost figure to
-- compare against dishes.price — nothing in the schema captured what an
-- ingredient actually costs the restaurant (only quantity_in_stock/
-- threshold_quantity, which are stock-level fields, not pricing). Nullable:
-- a manager may not have entered it yet, and profitability for a dish must
-- then read as "cost unknown", never silently default to 0 (which would
-- show a false 100% margin).
alter table ingredients
  add column unit_cost numeric(10, 2) check (unit_cost is null or unit_cost >= 0);
