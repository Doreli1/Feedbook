-- Feedbook Backend Schema — Domain: Ordering
-- Source: 5.Feedbook_Backend_Schema.docx §5, §14 (DDL appendix)

create table orders (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references table_sessions (id) on delete cascade,
  participant_id uuid not null references session_participants (id),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'ready', 'served', 'cancelled')),
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders (id) on delete cascade,
  dish_id uuid not null references dishes (id),
  quantity int not null default 1 check (quantity > 0),
  modifiers jsonb,
  unit_price numeric(10, 2) not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'ready', 'served', 'cancelled'))
);
