-- Dish photos — Backend Schema §3 (dishes.photo_urls), AFD §3.7.1 screen 4.
--
-- Unlike restaurant-documents (kosher certs, manager-only, uploaded rarely,
-- so routed through an Edge Function), menu photos are ordinary day-to-day
-- staff work — dishes.photo_urls is already writable by any staff member of
-- the restaurant (staff_manage_own_restaurant_dishes RLS). Uploading the
-- underlying file follows the same scope: any active staff member, not just
-- managers, via a direct client upload — no Edge Function needed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dish-photos', 'dish-photos', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Path convention: {restaurant_id}/{uuid}.{ext} — current_staff_restaurant_ids()
-- already exists (row_level_security migration) and is reused as-is.
create policy "staff_upload_own_restaurant_dish_photos"
  on storage.objects for insert
  with check (
    bucket_id = 'dish-photos'
    and (storage.foldername(name))[1]::uuid in (select current_staff_restaurant_ids())
  );

create policy "staff_delete_own_restaurant_dish_photos"
  on storage.objects for delete
  using (
    bucket_id = 'dish-photos'
    and (storage.foldername(name))[1]::uuid in (select current_staff_restaurant_ids())
  );

-- No read policy needed: the bucket is public, and Supabase Storage serves
-- /object/public/... without consulting RLS at all (same as
-- restaurant-documents).
