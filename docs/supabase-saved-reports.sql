-- Run this in the transportation Supabase SQL editor.
-- It allows Insights Studio to list, open, create, update, and delete saved reports
-- through the browser Supabase client after a user is signed in.

create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  title text,
  author text,
  period text,
  date text,
  layout_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.saved_reports enable row level security;

grant select, insert, update, delete on public.saved_reports to authenticated;

drop policy if exists "Authenticated users can read saved reports" on public.saved_reports;
create policy "Authenticated users can read saved reports"
  on public.saved_reports
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can create saved reports" on public.saved_reports;
create policy "Authenticated users can create saved reports"
  on public.saved_reports
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update saved reports" on public.saved_reports;
create policy "Authenticated users can update saved reports"
  on public.saved_reports
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can delete saved reports" on public.saved_reports;
create policy "Authenticated users can delete saved reports"
  on public.saved_reports
  for delete
  to authenticated
  using (true);
