-- Feedbook Backend Schema — bar shared-ticket system (2026-09-14).
-- Product decision (this session): bar seating is no longer modeled as N
-- individual 1-seat tables each needing their own printed QR code — one
-- shared QR represents the whole bar counter, any number of diners can join
-- it (join-session/add-participants already enforce no capacity cap — there
-- is no schema change needed for that part), and each diner's order is
-- tracked by a short-lived, staff-facing sequential pickup number (never the
-- diner's own persistent account number, which stays private to them) — the
-- same mental model as a deli-counter ticket, reset daily so it stays a
-- readable 4-digit number instead of growing forever across the table's
-- entire lifetime.

alter table orders add column bar_ticket_number int;

-- Enforces "the bar is a singleton" at the DB level, not just a UI
-- convention — a second table_type='bar' row is rejected outright even if
-- some future client bug tries to create one.
create unique index one_bar_table_per_restaurant on tables (restaurant_id) where table_type = 'bar';

create table bar_ticket_counters (
  restaurant_id uuid primary key references restaurants (id) on delete cascade,
  ticket_date date not null default current_date,
  last_number int not null default 0
);

alter table bar_ticket_counters enable row level security;
-- No policies: the only writer is next_bar_ticket_number() below (security
-- definer), invoked solely from place_order_transaction() via the
-- service-role place-order Edge Function — matching orders/order_items'
-- existing "no direct client access to internal accounting tables" pattern.
-- RLS enabled with zero policies denies all direct client access by default.

-- Atomic, race-safe daily-resetting counter — same "insert ... on conflict
-- do update" row-lock guarantee already relied on for
-- deduct_inventory_for_order under concurrent orders (Stage 2's own DoD
-- test), so two simultaneous bar orders can never be handed the same number.
create or replace function next_bar_ticket_number(p_restaurant_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number int;
begin
  insert into bar_ticket_counters (restaurant_id, ticket_date, last_number)
    values (p_restaurant_id, current_date, 1)
  on conflict (restaurant_id) do update
    set last_number = case
          when bar_ticket_counters.ticket_date = current_date then bar_ticket_counters.last_number + 1
          else 1
        end,
        ticket_date = current_date
  returning last_number into v_number;
  return v_number;
end;
$$;

revoke all on function next_bar_ticket_number(uuid) from public;
grant execute on function next_bar_ticket_number(uuid) to service_role;

-- Lets bar/kitchen staff print a pickup label with the diner's own display
-- name without granting blanket SELECT on user_profiles (which also carries
-- unrelated fields like birthdate/photo_url) — same "narrow security-definer
-- function instead of a broad RLS policy" choice already made for
-- sync_dish_likes_count's trigger earlier this session. Batches by order_id
-- so the kitchen screen makes one call for the whole queue, not one per row.
create or replace function bar_participant_display_names(p_order_ids uuid[])
returns table (order_id uuid, display_name text)
language sql
security definer
set search_path = public
stable
as $$
  select o.id, up.display_name
  from orders o
  join session_participants sp on sp.id = o.participant_id
  join user_profiles up on up.user_id = sp.user_id
  join table_sessions ts on ts.id = o.session_id
  where o.id = any(p_order_ids)
    and ts.restaurant_id in (select current_staff_restaurant_ids());
$$;

revoke all on function bar_participant_display_names(uuid[]) from public;
grant execute on function bar_participant_display_names(uuid[]) to authenticated;

-- place_order_transaction: now resolves the session's table_type and, only
-- for a bar order, assigns the next daily ticket number — everything else
-- is unchanged from the original 20260914093000 version. The return row
-- shape itself changed (added bar_ticket_number as a third OUT column),
-- which Postgres refuses to do via a plain CREATE OR REPLACE — the old
-- signature must be dropped first.
drop function if exists place_order_transaction(uuid, uuid, jsonb);

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
    v_bar_ticket_number := next_bar_ticket_number(v_restaurant_id);
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
