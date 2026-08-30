-- Feedbook Backend Schema — Domain: Audit & Security
-- Source: 5.Feedbook_Backend_Schema.docx §9, §14 (DDL appendix)

create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  staff_id uuid not null references staff (id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
