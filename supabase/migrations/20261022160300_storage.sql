-- Buckets and object policies. Paths, fixed for every package (see
-- `@barber/shared`'s paths module):
--   originals: <shop id>/<visit id>/<slot>.jpg and <shop id>/<visit id>/after.jpg
--   previews:  <shop id>/<visit id>/<preview id>.jpg and .thumb.jpg
--   styles:    <dimension>/<slug>.png, the style row's reference_image_path
-- Originals and previews are private and read through signed URLs; a barber
-- reads and writes under their own shop's prefix. Styles are public to read
-- and written by the service role only.

insert into storage.buckets (id, name, public)
values
  ('originals', 'originals', false),
  ('previews', 'previews', false),
  ('styles', 'styles', true)
on conflict (id) do nothing;

create policy "barbers read their shop's objects"
on storage.objects for select
to authenticated
using (
  bucket_id in ('originals', 'previews')
  and (storage.foldername(name))[1] = public.current_shop_id()::text
);

create policy "barbers add their shop's objects"
on storage.objects for insert
to authenticated
with check (
  bucket_id in ('originals', 'previews')
  and (storage.foldername(name))[1] = public.current_shop_id()::text
);

create policy "barbers replace their shop's objects"
on storage.objects for update
to authenticated
using (
  bucket_id in ('originals', 'previews')
  and (storage.foldername(name))[1] = public.current_shop_id()::text
)
with check (
  bucket_id in ('originals', 'previews')
  and (storage.foldername(name))[1] = public.current_shop_id()::text
);

create policy "barbers delete their shop's objects"
on storage.objects for delete
to authenticated
using (
  bucket_id in ('originals', 'previews')
  and (storage.foldername(name))[1] = public.current_shop_id()::text
);
