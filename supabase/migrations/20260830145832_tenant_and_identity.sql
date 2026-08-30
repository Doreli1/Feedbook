-- Feedbook Backend Schema — Domain: Tenant root + Identity & Users
-- Source: 5.Feedbook_Backend_Schema.docx §0, §2, §14 (DDL appendix)

create extension if not exists "uuid-ossp";

-- ---------- Core tenant ----------

create table restaurants (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text,
  phone text,
  hours jsonb,
  logo_url text,
  kosher_status text not null default 'not_certified'
    check (kosher_status in ('certified', 'not_certified')),
  kosher_certificate_url text,
  kosher_certificate_uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Identity ----------

create table genius_tiers (
  id int primary key,
  tier_name text not null,
  min_activity_score int not null,
  benefits_description text not null
);

create table user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  nickname text,
  profile_photo_url text,
  birthdate date,
  language_preference text not null default 'he'
    check (language_preference in ('he', 'en')),
  genius_tier_id int references genius_tiers (id),
  genius_activity_score int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('manager', 'waiter', 'kitchen')),
  created_at timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

create table consents (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  consent_type text not null
    check (consent_type in ('contacts_access', 'marketing_notifications')),
  granted boolean not null,
  granted_at timestamptz not null default now()
);
