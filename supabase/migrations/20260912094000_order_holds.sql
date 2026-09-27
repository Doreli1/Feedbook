-- Feedbook Backend Schema — per-order payment hold (Stage 5 alignment, 2026-09-12).
-- Source: PRD §4 step 4 / §5.2.5 (per-participant "secure but don't charge"
-- ordering model). Placing an order secures it via a hold, not an immediate
-- charge, so each participant can later settle only what they personally
-- ordered — extending the existing Split-by-Item concept with an order-time
-- authorization step.
--
-- STUB for Stage 5: gateway_hold_ref stays null and status stays 'held' until
-- Stage 6 wires up the real Tranzila authorization call. Actually inserting
-- rows here is Stage 5 place-order implementation work, done after this
-- migration — this only creates the shape.
create table order_holds (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders (id) on delete cascade unique,
  participant_id uuid not null references session_participants (id),
  status text not null default 'held'
    check (status in ('held', 'released', 'captured', 'failed')),
  gateway_hold_ref text,
  amount numeric(10, 2) not null check (amount >= 0),
  held_at timestamptz not null default now(),
  released_at timestamptz
);

alter table order_holds enable row level security;

create policy "staff_manage_own_restaurant_order_holds"
  on order_holds for all
  using (
    order_id in (
      select o.id from orders o
      join table_sessions ts on ts.id = o.session_id
      where ts.restaurant_id in (select current_staff_restaurant_ids())
    )
  );

create policy "participant_manage_own_order_holds"
  on order_holds for all
  using (
    participant_id in (select id from session_participants where user_id = auth.uid())
  )
  with check (
    participant_id in (select id from session_participants where user_id = auth.uid())
  );
