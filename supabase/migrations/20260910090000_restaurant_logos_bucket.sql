-- Restaurant logos — diner-facing branding shown on the "פרטי מסעדה" screen
-- right after a QR scan (App Flow §2 flow-table row 6, §2.2א). restaurants.
-- logo_url has existed since the original tenant_and_identity migration but
-- was never wired to any upload path — this bucket is that missing piece.
--
-- Same reasoning as dish-photos (20260902090000_dish_photos_bucket.sql): a
-- logo is routine day-to-day branding, not a sensitive document like a
-- kosher certificate, so any active staff member of the restaurant can
-- upload it directly from the client — no Edge Function detour needed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('restaurant-logos', 'restaurant-logos', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Path convention: {restaurant_id}/{uuid}.{ext} — current_staff_restaurant_ids()
-- already exists (row_level_security migration) and is reused as-is.
create policy "staff_upload_own_restaurant_logo"
  on storage.objects for insert
  with check (
    bucket_id = 'restaurant-logos'
    and (storage.foldername(name))[1]::uuid in (select current_staff_restaurant_ids())
  );

create policy "staff_delete_own_restaurant_logo"
  on storage.objects for delete
  using (
    bucket_id = 'restaurant-logos'
    and (storage.foldername(name))[1]::uuid in (select current_staff_restaurant_ids())
  );

-- No read policy needed: the bucket is public, and Supabase Storage serves
-- /object/public/... without consulting RLS at all (same as dish-photos and
-- restaurant-documents).
