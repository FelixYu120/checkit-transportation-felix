-- Profile photo support. Prepared locally; not applied to either hosted database.
-- Apply this migration alone, before releasing the matching frontend.
begin;
alter table public.profile add column if not exists avatar_path text;
alter table public.profile add constraint profile_avatar_path_owned_check check (
  avatar_path is null or (split_part(avatar_path, '/', 1) = id::text
    and avatar_path ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}[.]webp$')
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 5242880, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/webp'];

create or replace function public.can_read_profile_photo(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    split_part(object_name, '/', 1) = auth.uid()::text
    -- Current profile pictures are visible to every signed-in user.
    or exists (select 1 from public.profile target where target.avatar_path = object_name)
  );
$$;
revoke all on function public.can_read_profile_photo(text) from public, anon;
grant execute on function public.can_read_profile_photo(text) to authenticated;

create policy profile_photos_read on storage.objects for select to authenticated
using (bucket_id = 'profile-photos' and public.can_read_profile_photo(name));
create policy profile_photos_insert on storage.objects for insert to authenticated
with check (bucket_id = 'profile-photos' and owner_id = auth.uid()::text
  and split_part(name, '/', 1) = auth.uid()::text
  and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}[.]webp$');
create policy profile_photos_delete on storage.objects for delete to authenticated
using (bucket_id = 'profile-photos' and owner_id = auth.uid()::text
  and split_part(name, '/', 1) = auth.uid()::text);
-- Restrictive guards also protect this bucket if an older broad policy exists.
create policy profile_photos_no_anonymous on storage.objects as restrictive for all to anon
using (bucket_id <> 'profile-photos') with check (bucket_id <> 'profile-photos');
create policy profile_photos_read_boundary on storage.objects as restrictive for select to authenticated
using (bucket_id <> 'profile-photos' or public.can_read_profile_photo(name));
create policy profile_photos_insert_boundary on storage.objects as restrictive for insert to authenticated
with check (bucket_id <> 'profile-photos' or (owner_id = auth.uid()::text
  and split_part(name, '/', 1) = auth.uid()::text
  and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}[.]webp$'));
create policy profile_photos_delete_boundary on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'profile-photos' or (owner_id = auth.uid()::text
  and split_part(name, '/', 1) = auth.uid()::text));
create policy profile_photos_no_overwrite on storage.objects as restrictive for update to authenticated
using (bucket_id <> 'profile-photos') with check (bucket_id <> 'profile-photos');
-- No UPDATE policy: replacements get a new immutable object name.

create or replace function public.set_my_profile_photo(photo_path text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  previous_path text;
begin
  if actor_id is null then raise exception 'Sign in before changing your photo.'; end if;
  select avatar_path into previous_path from public.profile where id = actor_id for update;
  if not found then raise exception 'Your profile could not be found.'; end if;
  if photo_path is not null and (
    split_part(photo_path, '/', 1) <> actor_id::text
    or photo_path !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}[.]webp$'
    or not exists (select 1 from storage.objects where bucket_id = 'profile-photos'
      and name = photo_path and owner_id = actor_id::text)
  ) then raise exception 'Choose a photo uploaded to your own profile.'; end if;
  update public.profile set avatar_path = photo_path where id = actor_id;
  return jsonb_build_object('avatar_path', photo_path, 'previous_path', previous_path);
end;
$$;
revoke all on function public.set_my_profile_photo(text) from public, anon;
grant execute on function public.set_my_profile_photo(text) to authenticated;
commit;
