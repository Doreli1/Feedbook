-- Feedbook Backend Schema — Critical transaction functions
-- Source: 5.Feedbook_Backend_Schema.docx §11
-- Per TSD §4.3: the two most consistency-sensitive operations run as single
-- Postgres transactions with row locking (SELECT ... FOR UPDATE), not in
-- application code, to guarantee atomicity under concurrent requests.

-- ---------- 11.1 JIT inventory deduction ----------
-- Triggered on order confirmation. Locks the relevant ingredient rows,
-- checks availability, deducts, and returns which ingredients dropped
-- below their reorder threshold.
create or replace function deduct_inventory_for_order(p_order_id uuid)
returns table (ingredient_id uuid, below_threshold boolean)
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select di.ingredient_id, di.quantity_required * oi.quantity as needed
    from order_items oi
    join dish_ingredients di on di.dish_id = oi.dish_id
    where oi.order_id = p_order_id
  loop
    -- Row lock to prevent a race condition between concurrent orders
    perform 1 from ingredients where id = r.ingredient_id for update;

    if (select quantity_in_stock from ingredients where id = r.ingredient_id) < r.needed then
      raise exception 'Insufficient stock for ingredient %', r.ingredient_id;
    end if;

    update ingredients
      set quantity_in_stock = quantity_in_stock - r.needed,
          updated_at = now()
      where id = r.ingredient_id;

    return query
      select r.ingredient_id,
             (select quantity_in_stock < threshold_quantity
              from ingredients where id = r.ingredient_id);
  end loop;
end;
$$;

-- ---------- 11.2 Bill split (even / by item) ----------
-- Triggered when the bill is closed. Locks the payment row, computes each
-- participant's share by split type, and updates payment_participant_shares.
create or replace function calculate_bill_split(p_payment_id uuid)
returns void
language plpgsql
as $$
declare
  v_split_type text;
  v_total numeric(10, 2);
  v_participant_count int;
begin
  select split_type, total_amount into v_split_type, v_total
  from payments where id = p_payment_id
  for update; -- lock the payment row

  if v_split_type = 'even' then
    select count(*) into v_participant_count
    from payment_participant_shares
    where payment_id = p_payment_id;

    update payment_participant_shares
      set amount_due = round(v_total / v_participant_count, 2)
      where payment_id = p_payment_id;

  elsif v_split_type = 'by_item' then
    update payment_participant_shares pps
      set amount_due = coalesce((
        select sum(oi.unit_price * oi.quantity)
        from orders o
        join order_items oi on oi.order_id = o.id
        where o.participant_id = pps.participant_id
      ), 0);
  end if;
end;
$$;
