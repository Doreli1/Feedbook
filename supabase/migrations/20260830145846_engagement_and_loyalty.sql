-- Feedbook Backend Schema — Domain: Engagement & Loyalty
-- Source: 5.Feedbook_Backend_Schema.docx §7, §14 (DDL appendix)
-- Note: genius_tiers itself lives in the identity migration (user_profiles references it).

create table reviews (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  session_id uuid not null references table_sessions (id),
  user_id uuid references auth.users (id),
  verification_code_hash text not null,
  service_rating int not null check (service_rating between 1 and 5),
  liked_text text,
  disliked_text text,
  nickname_display text,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'published', 'rejected')),
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table review_dish_ratings (
  id uuid primary key default uuid_generate_v4(),
  review_id uuid not null references reviews (id) on delete cascade,
  dish_id uuid not null references dishes (id),
  rating int not null check (rating between 1 and 5),
  unique (review_id, dish_id)
);

create table review_helpful_votes (
  id uuid primary key default uuid_generate_v4(),
  review_id uuid not null references reviews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  is_helpful boolean not null,
  created_at timestamptz not null default now(),
  unique (review_id, user_id)
);
