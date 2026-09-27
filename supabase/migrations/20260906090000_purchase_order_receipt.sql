-- Feedbook Backend Schema — receive_purchase_order()
-- Source: 5.Feedbook_Backend_Schema.docx §11 (PL/pgSQL functions appendix)
--
-- Marking a purchase order "received" has to update two tables together
-- (purchase_orders.status + ingredients.quantity_in_stock) or the two can
-- drift apart under a client crash/race between the two writes. Unlike
-- deduct_inventory_for_order()/calculate_bill_split(), this doesn't need
-- security definer: both tables' existing RLS ("staff_manage_own_restaurant_*")
-- already let the calling staff member write to both rows directly, so the
-- only thing this function adds is atomicity + row locking, not privilege
-- escalation.
create or replace function receive_purchase_order(p_po_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_po purchase_orders%rowtype;
begin
  select * into v_po from purchase_orders where id = p_po_id for update;

  if not found then
    raise exception 'Purchase order not found';
  end if;
  if v_po.status <> 'pending' then
    raise exception 'Purchase order is not pending';
  end if;

  perform 1 from ingredients where id = v_po.ingredient_id for update;

  update ingredients
  set quantity_in_stock = quantity_in_stock + v_po.quantity_ordered,
      updated_at = now()
  where id = v_po.ingredient_id;

  update purchase_orders
  set status = 'received', received_at = now()
  where id = p_po_id;
end;
$$;

revoke all on function receive_purchase_order(uuid) from public;
grant execute on function receive_purchase_order(uuid) to authenticated;
