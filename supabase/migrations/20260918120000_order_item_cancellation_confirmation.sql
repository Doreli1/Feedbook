-- Closes a real gap the user raised: canceling an order item always
-- restocked ingredients unconditionally, with no way to know whether the
-- kitchen had already started using them. A diner-initiated cancel now only
-- REQUESTS cancellation; the kitchen must confirm it (and explicitly choose
-- whether the ingredients are still returnable) before the item is actually
-- cancelled and any restock happens.
alter table order_items drop constraint order_items_status_check;
alter table order_items
  add constraint order_items_status_check
  check (status in ('in_progress', 'ready', 'served', 'cancellation_requested', 'cancelled'));

-- Called by the Kitchen screen (staff context) once they've decided whether
-- the ingredients are still physically returnable. security invoker (the
-- default here) means the update below is still gated by the caller's own
-- staff_manage_own_restaurant_order_items RLS — this function only adds the
-- "restock, then cancel, atomically" coordination, not a new permission.
create or replace function confirm_order_item_cancellation(p_order_item_id uuid, p_restock boolean)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_restock then
    perform restock_inventory_for_order_item(p_order_item_id);
  end if;

  update order_items
    set status = 'cancelled'
    where id = p_order_item_id and status = 'cancellation_requested';
end;
$$;
