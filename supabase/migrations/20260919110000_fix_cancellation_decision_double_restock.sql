-- record_cancellation_inventory_decision (20260919100000) called
-- restock_inventory_for_order_item() unconditionally whenever p_restock was
-- true, guarding only the UPDATE (not the restock itself) with
-- "cancellation_restocked is null". Caught during verification: calling the
-- function twice with p_restock=true (e.g. a double-click on the kitchen's
-- banner button before onRefreshOrders() re-renders it away) silently
-- restocked the ingredient twice for one cancelled item. Fix: do the guarded
-- UPDATE first and only restock when it actually changed a row (i.e. this
-- is genuinely the first decision recorded for this item).
create or replace function record_cancellation_inventory_decision(p_order_item_id uuid, p_restock boolean)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_recorded boolean;
begin
  update order_items
    set cancellation_restocked = p_restock
    where id = p_order_item_id and status = 'cancelled' and cancellation_restocked is null
  returning true into v_recorded;

  if v_recorded and p_restock then
    perform restock_inventory_for_order_item(p_order_item_id);
  end if;
end;
$$;
