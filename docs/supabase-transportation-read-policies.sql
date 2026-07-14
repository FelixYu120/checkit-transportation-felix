-- Run this in the transportation Supabase SQL editor.
-- It allows the browser Supabase client to read the transportation directory
-- and 10-minute summary data used by the dashboard pages.
--
-- If the app still looks empty while ten_minute_summaries has rows, the most
-- common cause is that institutes/sensors are unreadable or missing. The app
-- uses those two tables to build the sidebar, page routes, and report targets.

grant usage on schema public to anon, authenticated;

grant select on public.institutes to anon, authenticated;
grant select on public.sensors to anon, authenticated;
grant select on public.ten_minute_summaries to anon, authenticated;

alter table public.institutes enable row level security;
alter table public.sensors enable row level security;
alter table public.ten_minute_summaries enable row level security;

drop policy if exists "Anyone can read transportation institutes" on public.institutes;
create policy "Anyone can read transportation institutes"
  on public.institutes
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Anyone can read transportation sensors" on public.sensors;
create policy "Anyone can read transportation sensors"
  on public.sensors
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Anyone can read transportation summaries" on public.ten_minute_summaries;
create policy "Anyone can read transportation summaries"
  on public.ten_minute_summaries
  for select
  to anon, authenticated
  using (true);

-- Optional seed rows for the sample CSV currently loaded in ten_minute_summaries.
-- Keep these if your directory tables do not already have matching records.

insert into public.institutes (institute_id, full_name)
values ('ucsd', 'UC San Diego')
on conflict (institute_id) do update
set full_name = excluded.full_name;

insert into public.sensors (
  sensor_id,
  institute_id,
  area_name,
  corridor_name,
  latitude,
  longitude,
  status
)
values (
  'peppercanyon1',
  'ucsd',
  'Pepper Canyon',
  'Pepper Canyon Corridor',
  32.8801,
  -117.234,
  'active'
)
on conflict (sensor_id) do update
set
  institute_id = excluded.institute_id,
  area_name = excluded.area_name,
  corridor_name = excluded.corridor_name,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  status = excluded.status;
