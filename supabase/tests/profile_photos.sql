\set ON_ERROR_STOP on
-- Only run against a disposable local database; never a hosted project.
do $$ begin
  if current_database() <> 'checkit_profile_photos_test' then raise exception 'Use the isolated checkit_profile_photos_test database.'; end if;
end $$;
create role authenticated nologin;
create role anon nologin;
create schema auth;
create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
grant usage on schema auth, storage to authenticated, anon;
create table public.profile(id uuid primary key, role text, assigned_institute varchar);
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, anon;
grant select on public.profile to authenticated;
-- Simulate a legacy broad policy: new bucket boundaries must still hold.
create policy legacy_open_storage on storage.objects for all to authenticated, anon using (true) with check (true);
\i :migration_file
create function public.photo_test_assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end $$;
insert into public.profile(id,role,assigned_institute) values
('00000000-0000-0000-0000-000000000001','viewer','institute-a'),
('00000000-0000-0000-0000-000000000002','admin','institute-a'),
('00000000-0000-0000-0000-000000000003','viewer','institute-b'),
('00000000-0000-0000-0000-000000000004','checkit_admin','institute-b');
insert into storage.objects(bucket_id,name,owner_id)
select 'profile-photos', id::text || '/00000000-0000-0000-0000-000000000010.webp', id::text from public.profile;
update public.profile set avatar_path=id::text || '/00000000-0000-0000-0000-000000000010.webp';
select public.photo_test_assert((select not public and file_size_limit=5242880 and allowed_mime_types=array['image/webp'] from storage.buckets where id='profile-photos'), 'Bucket must be private and constrained');
select public.photo_test_assert(not has_function_privilege('anon','public.set_my_profile_photo(text)','execute'), 'Anonymous photo changes must be denied');
select public.photo_test_assert(not has_function_privilege('anon','public.can_read_profile_photo(text)','execute'), 'Anonymous photo reads must be denied');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.photo_test_assert((select count(*)=4 from storage.objects), 'Viewers can read current profile photos across all institutions');
insert into storage.objects(bucket_id,name,owner_id) values ('profile-photos','00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000011.webp','00000000-0000-0000-0000-000000000001');
select public.set_my_profile_photo('00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000011.webp');
select public.photo_test_assert((select role='viewer' and assigned_institute='institute-a' and avatar_path like '%11.webp' from public.profile where id=auth.uid()), 'Photo save cannot change membership or role');
do $$ begin
  begin perform public.set_my_profile_photo('00000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000010.webp'); raise exception 'Cross-account save unexpectedly allowed';
  exception when raise_exception then if sqlerrm <> 'Choose a photo uploaded to your own profile.' then raise; end if; end;
  begin perform public.set_my_profile_photo('00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000099.webp'); raise exception 'Missing object save unexpectedly allowed';
  exception when raise_exception then if sqlerrm <> 'Choose a photo uploaded to your own profile.' then raise; end if; end;
  begin insert into storage.objects(bucket_id,name,owner_id) values ('profile-photos','00000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000012.webp',auth.uid()::text); raise exception 'Cross-account upload unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects(bucket_id,name,owner_id) values ('profile-photos','00000000-0000-0000-0000-000000000001/fake.svg',auth.uid()::text); raise exception 'Invalid path unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
with deleted as (delete from storage.objects where owner_id <> auth.uid()::text returning *) select public.photo_test_assert(count(*)=0,'Other users photos cannot be deleted') from deleted;
with changed as (update storage.objects set name=name where bucket_id='profile-photos' returning *) select public.photo_test_assert(count(*)=0,'Immutable photos cannot be overwritten') from changed;
select public.set_my_profile_photo(null);
select public.photo_test_assert((select avatar_path is null and role='viewer' and assigned_institute='institute-a' from public.profile where id=auth.uid()), 'Removal changes only the photo');
reset role;
update public.profile set assigned_institute=null where id='00000000-0000-0000-0000-000000000001';
set role authenticated;
select public.photo_test_assert((select count(*)=5 from storage.objects), 'All signed-in accounts can see current profile photos regardless of institution assignment');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select public.photo_test_assert((select count(*)=3 from storage.objects), 'Other-institute viewers can see all current photos but not old or removed pictures');
select public.photo_test_assert(not exists(select 1 from storage.objects where owner_id='00000000-0000-0000-0000-000000000001'), 'Another user cannot access an owner''s unselected old uploads');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
select public.photo_test_assert((select count(*)=3 from storage.objects), 'CheckIt admins see current teammate photos across institutions plus own objects');
select set_config('request.jwt.claim.sub','',false);
do $$ begin
  begin perform public.set_my_profile_photo(null); raise exception 'Signed-out photo change unexpectedly allowed';
  exception when raise_exception then if sqlerrm <> 'Sign in before changing your photo.' then raise; end if; end;
end $$;
reset role;
set role anon;
select public.photo_test_assert((select count(*)=0 from storage.objects), 'Anonymous users cannot read photos even with legacy open storage policies');
\echo Profile photo visibility and ownership checks passed.
