-- Feedbook Backend Schema — Domain: Tables & Sessions
-- Source: 5.Feedbook_Backend_Schema.docx §4, §14 (DDL appendix)

create table tables (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  table_number text not null,
  capacity int not null check (capacity > 0),
  smoking_allowed boolean not null default false,
  status text not null default 'available'
    check (status in ('available', 'occupied', 'awaiting_payment')),
  qr_code_token text not null unique,
  created_at timestamptz not null default now(),
  unique (restaurant_id, table_number)
);

create table table_sessions (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  table_id uuid not null references tables (id),
  session_account_number text not null unique,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table session_participants (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references table_sessions (id) on delete cascade,
  user_id uuid references auth.users (id),
  sub_account_number text not null,
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (session_id, sub_account_number)
);
