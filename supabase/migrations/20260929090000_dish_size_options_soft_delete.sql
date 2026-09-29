-- Soft-delete for dish_size_options (2026-09-29), per explicit user request:
-- "disabling serving options" (or removing one specific size) used to try
-- to hard-DELETE the row, which order_items.dish_size_option_id references
-- with no ON DELETE clause (by design — a past order must keep pointing at
-- a real row for its own history). Once a size option had ever actually
-- been ordered, that delete always failed with a 23503 foreign-key error —
-- a real, recurring friction point raised multiple times this session,
-- since real test orders on a busy test dish made this trivially easy to
-- hit. is_active replaces hard-delete entirely for this table: "removing" a
-- size option now just hides it (from the diner app and from the edit
-- form), never touches the row, and so can never conflict with historical
-- order data again — no retroactive changes, no risk to existing orders.
alter table dish_size_options
  add column is_active boolean not null default true;

-- Diners must never see a deactivated size, regardless of what the client
-- query asks for — enforced here, not just filtered client-side.
drop policy "public_read_available_dish_size_options" on dish_size_options;
create policy "public_read_available_dish_size_options"
  on dish_size_options for select
  using (
    is_active
    and dish_id in (select id from dishes where is_available = true)
  );
