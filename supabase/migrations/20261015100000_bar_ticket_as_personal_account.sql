-- Bar diners get a real personal account, not just a pickup ticket
-- (2026-10-15, user decision, follow-up to the bar status-tracking
-- exclusion). The bar's shared table_session — any number of unrelated
-- diners joining/leaving independently, no capacity cap — means the
-- existing "חשבון כללי" (general account) view, which shows every
-- participant's items together, would otherwise mix up strangers' orders
-- with no real relationship between them. Resolution:
--   1. bar_ticket_number moves from per-ORDER (place_order_transaction) to
--      per-PARTICIPANT (join-session) — one number per diner's whole visit,
--      not a fresh one per order, so it can double as their personal
--      account number (matches what's literally printed on their own
--      pickup ticket).
--   2. The mobile "חשבון כללי" tab is hidden entirely for a bar session
--      (app-side change, AccountScreen.tsx) — each bar diner only ever
--      sees their own items, identified by this same number.

alter table session_participants add column bar_ticket_number int;

-- place_order_transaction: for a bar table, look up the calling
-- participant's already-assigned bar_ticket_number instead of minting a
-- fresh one per order — same signature as before (CREATE OR REPLACE is
-- enough, no DROP needed).
create or replace function place_order_transaction(
  p_session_id uuid,
  p_participant_id uuid,
  p_items jsonb
)
returns table (order_id uuid, inventory_alerts jsonb, bar_ticket_number int)
language plpgsql
set search_path = public
as $$
declare
  v_session_status text;
  v_restaurant_id uuid;
  v_table_type text;
  v_bar_ticket_number int;
  v_new_order_id uuid;
  v_item jsonb;
  v_dish_id uuid;
  v_quantity int;
  v_size_option_id uuid;
  v_dish_is_available boolean;
  v_unit_price numeric(10, 2);
  v_new_order_item_id uuid;
  v_modifier_id uuid;
  v_modifier_price numeric(10, 2);
  v_total numeric(10, 2) := 0;
  v_item_total numeric(10, 2);
  v_alerts jsonb;
begin
  select ts.status, ts.restaurant_id, t.table_type
    into v_session_status, v_restaurant_id, v_table_type
    from table_sessions ts
    join tables t on t.id = ts.table_id
    where ts.id = p_session_id
    for update of ts;

  if v_session_status is distinct from 'open' then
    raise exception 'SESSION_NOT_OPEN';
  end if;

  if v_table_type = 'bar' then
    select sp.bar_ticket_number into v_bar_ticket_number
      from session_participants sp
      where sp.id = p_participant_id;
  end if;

  insert into orders (session_id, participant_id, bar_ticket_number)
    values (p_session_id, p_participant_id, v_bar_ticket_number)
    returning id into v_new_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_dish_id := (v_item ->> 'dish_id')::uuid;
    v_quantity := coalesce((v_item ->> 'quantity')::int, 1);
    v_size_option_id := nullif(v_item ->> 'dish_size_option_id', '')::uuid;

    select is_available, price into v_dish_is_available, v_unit_price
      from dishes where id = v_dish_id;

    if v_dish_is_available is distinct from true then
      raise exception 'DISH_NOT_AVAILABLE';
    end if;

    if v_size_option_id is not null then
      select price into v_unit_price
        from dish_size_options
        where id = v_size_option_id and dish_id = v_dish_id;
      if v_unit_price is null then
        raise exception 'DISH_NOT_AVAILABLE';
      end if;
    end if;

    insert into order_items (order_id, dish_id, dish_size_option_id, quantity, unit_price)
      values (v_new_order_id, v_dish_id, v_size_option_id, v_quantity, v_unit_price)
      returning id into v_new_order_item_id;

    v_item_total := v_unit_price * v_quantity;

    for v_modifier_id in
      select jsonb_array_elements_text(coalesce(v_item -> 'modifier_option_ids', '[]'::jsonb))::uuid
    loop
      select price_delta into v_modifier_price
        from dish_modifier_options where id = v_modifier_id;
      if v_modifier_price is null then
        raise exception 'DISH_NOT_AVAILABLE';
      end if;

      insert into order_item_modifiers (order_item_id, modifier_option_id, price_delta_at_order)
        values (v_new_order_item_id, v_modifier_id, v_modifier_price);

      v_item_total := v_item_total + (v_modifier_price * v_quantity);
    end loop;

    v_total := v_total + v_item_total;
  end loop;

  select coalesce(
    jsonb_agg(jsonb_build_object('ingredient_id', d.ingredient_id, 'below_threshold', d.below_threshold))
      filter (where d.below_threshold),
    '[]'::jsonb
  )
  into v_alerts
  from deduct_inventory_for_order(v_new_order_id) d;

  -- Stub hold per order_holds' own design (20260912094000_order_holds.sql):
  -- gateway_hold_ref stays null and status stays 'held' until Stage 6 wires
  -- up the real Tranzila authorization call.
  insert into order_holds (order_id, participant_id, amount)
    values (v_new_order_id, p_participant_id, v_total);

  return query select v_new_order_id, v_alerts, v_bar_ticket_number;
end;
$$;
