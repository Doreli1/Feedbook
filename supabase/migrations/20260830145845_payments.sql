-- Feedbook Backend Schema — Domain: Payments
-- Source: 5.Feedbook_Backend_Schema.docx §6, §14 (DDL appendix)

create table payments (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references table_sessions (id),
  split_type text not null check (split_type in ('even', 'by_item')),
  total_amount numeric(10, 2) not null,
  service_fee numeric(10, 2) not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'refunded')),
  payment_gateway_ref text,
  receipt_number text,
  paid_at timestamptz
);

create table payment_participant_shares (
  id uuid primary key default uuid_generate_v4(),
  payment_id uuid not null references payments (id) on delete cascade,
  participant_id uuid not null references session_participants (id),
  amount_due numeric(10, 2) not null check (amount_due >= 0),
  amount_paid numeric(10, 2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_at timestamptz
);
