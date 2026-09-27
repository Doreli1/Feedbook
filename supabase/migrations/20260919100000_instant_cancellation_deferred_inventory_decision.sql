-- Corrects a real design mistake from yesterday: the restaurant's actual
-- policy is that a diner's cancellation within the 5-minute edit window is
-- IMMEDIATE and final — it never waits on the kitchen. The kitchen is only
-- ever asked, afterward, whether the ingredients were already used (purely
-- an inventory bookkeeping question) — that decision has zero bearing on
-- whether the order itself is cancelled, which it already is by the time
-- anyone in the kitchen looks at it.
--
-- Yesterday's 'cancellation_requested' status modeled this backwards (the
-- cancellation itself waited on kitchen confirmation). No row has ever
-- reached that status in practice, so it's safe to drop outright rather
-- than migrate data.
alter table order_items drop constraint order_items_status_check;
alter table order_items
  add constraint order_items_status_check
  check (status in ('in_progress', 'ready', 'served', 'cancelled'));

drop function if exists confirm_order_item_cancellation(uuid, boolean);

-- Called once the kitchen notices a cancelled item still needs an
-- inventory decision (cancellation_restocked is null) — purely records
-- that decision and, if applicable, restores stock. Never touches status:
-- the order was already 'cancelled' the instant the diner requested it.
create or replace function record_cancellation_inventory_decision(p_order_item_id uuid, p_restock boolean)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_restock then
    perform restock_inventory_for_order_item(p_order_item_id);
  end if;

  update order_items
    set cancellation_restocked = p_restock
    where id = p_order_item_id and status = 'cancelled' and cancellation_restocked is null;
end;
$$;
