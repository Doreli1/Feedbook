-- Feedbook Backend Schema — restaurant-documents storage bucket
-- Tech Stack Doc §4.7: public-read (kosher certs are shown to diners), write
-- restricted to the owning restaurant's staff. In practice, ALL writes go
-- through the upload-kashrut-certificate Edge Function under service_role
-- (same wrapped-Edge-Function pattern as register-restaurant), so no client
-- INSERT/UPDATE/DELETE policy is added here: RLS is enabled by default with
-- no matching policy, which already blocks any direct client write. Reads
-- are served via the bucket's own public flag, not a SELECT policy.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-documents',
  'restaurant-documents',
  true,
  10485760, -- 10MB, matches API Spec §5.1 FILE_TOO_LARGE threshold
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do nothing;
