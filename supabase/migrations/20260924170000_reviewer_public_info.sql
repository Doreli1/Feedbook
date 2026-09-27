-- Verified-diner review card on the dish detail screen (2026-09-24). Reviews
-- themselves are already public once approved — reviews.status = 'published'
-- only happens after Feedbook's own moderation (see the review lifecycle:
-- a diner fills the review out after closing their table's bill, it queues
-- as 'pending_review', and only a 'published' one is ever readable by
-- anyone but its author or restaurant staff — public_read_published_reviews
-- / public_read_published_review_dish_ratings, 20260830145852). Those two
-- tables + reviews.nickname_display / liked_text are already safely
-- queryable straight from the client under that existing RLS — no new
-- function needed for them.
--
-- What IS missing: a reviewer's real photo and birthdate live on
-- user_profiles, which is owner-only (owner_manage_own_profile) — a diner
-- reading someone else's published review cannot see who wrote it beyond
-- the nickname they chose. This function exposes exactly two more fields,
-- and nothing else: the photo, and a 5-year age BUCKET (never the raw
-- birthdate) — scoped to reviewers who actually have at least one published
-- review, so this can't be used as a general "look up anyone's profile by
-- id" endpoint.
create or replace function get_reviewer_public_info(p_user_ids uuid[])
returns table (user_id uuid, photo_url text, age_range text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct
    up.user_id,
    up.profile_photo_url,
    case
      when up.birthdate is null then null
      else
        (5 * floor(extract(year from age(up.birthdate)) / 5))::int
        || '-' ||
        (5 * floor(extract(year from age(up.birthdate)) / 5) + 4)::int
    end
  from user_profiles up
  where up.user_id = any(p_user_ids)
    and exists (
      select 1 from reviews r where r.user_id = up.user_id and r.status = 'published'
    );
$$;
grant execute on function get_reviewer_public_info(uuid[]) to authenticated;
