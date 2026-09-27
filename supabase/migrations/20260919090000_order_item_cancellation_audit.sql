-- Closes a real gap the user raised right after testing cancellation-
-- confirmation for the first time: once a kitchen staff member picks
-- "restock" vs "already used", that decision left no trace anywhere except
-- an indirect, unattributable change to ingredients.quantity_in_stock —
-- there was no way to later ask "how much stock did we lose to cancelled
-- orders this month?". This adds one column recording exactly that choice,
-- set at the same moment the item is actually cancelled.
alter table order_items
  add column cancellation_restocked boolean;

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
    set status = 'cancelled', cancellation_restocked = p_restock
    where id = p_order_item_id and status = 'cancellation_requested';
end;
$$;
