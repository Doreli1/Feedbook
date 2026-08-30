-- Feedbook Backend Schema — Domain: Support & Operations
-- Source: 5.Feedbook_Backend_Schema.docx §8, §14 (DDL appendix)

create table non_conformances (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  session_id uuid references table_sessions (id),
  serial_code text not null unique,
  type text not null
    check (type in ('dish_return', 'transaction_cancel', 'content_removal', 'other')),
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'closed')),
  opened_by uuid references auth.users (id),
  closed_by uuid references staff (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table waiter_calls (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references table_sessions (id) on delete cascade,
  table_id uuid not null references tables (id),
  reason text,
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved')),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users (id),
  staff_id uuid references staff (id),
  type text not null
    check (type in ('order_status', 'waiter_ack', 'promotion', 'inventory_alert', 'review_ready')),
  title text not null,
  body text not null,
  sent_at timestamptz not null default now(),
  read_at timestamptz
);
