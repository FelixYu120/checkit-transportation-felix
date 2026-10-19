-- Check-It Transportation: destructive cleanup after verified R2 migration
--
-- DO NOT RUN this file until:
--   1. archive_all_to_r2.py completed with status PASS;
--   2. every traffic_passages partition has a schema_version=2 VERIFIED
--      public.historical_archives row;
--   3. the website has been tested against ten_minute_summaries and
--      traffic_daily;
--   4. the full PostgreSQL dump has been downloaded from R2 and its SHA-256
--      has been verified.
--
-- This script deletes detailed historical rows only. It does NOT drop the
-- traffic_passages table because firmware will continue inserting new rows.

begin;

do $$
declare
  source_total bigint;
  manifest_total bigint;
  mismatch_count bigint;
begin
  select count(*) into source_total
  from public.traffic_passages;

  select coalesce(sum(row_count), 0) into manifest_total
  from public.historical_archives
  where dataset = 'traffic_passages'
    and schema_version = 2
    and status = 'verified';

  with source_days as (
    select
      sensor_id,
      (coalesce(ended_at, received_at) at time zone 'UTC')::date as day,
      count(*)::bigint as row_count
    from public.traffic_passages
    group by sensor_id, day
  ),
  manifest_days as (
    select
      sensor_id,
      (started_at at time zone 'UTC')::date as day,
      sum(row_count)::bigint as row_count
    from public.historical_archives
    where dataset = 'traffic_passages'
      and schema_version = 2
      and status = 'verified'
    group by sensor_id, day
  )
  select count(*) into mismatch_count
  from (
    select
      coalesce(s.sensor_id, m.sensor_id) as sensor_id,
      coalesce(s.day, m.day) as day,
      s.row_count as source_rows,
      m.row_count as archived_rows
    from source_days s
    full outer join manifest_days m
      on m.sensor_id = s.sensor_id
     and m.day = s.day
    where s.row_count is distinct from m.row_count
  ) mismatches;

  if source_total = 0 then
    raise exception 'traffic_passages is already empty; nothing to delete';
  end if;

  if source_total <> manifest_total then
    raise exception
      'ABORT: source total % differs from verified schema-v2 manifest total %',
      source_total, manifest_total;
  end if;

  if mismatch_count <> 0 then
    raise exception
      'ABORT: % sensor/day partitions have count mismatches',
      mismatch_count;
  end if;
end $$;

-- Delete only rows belonging to sensor/day partitions proven by verified
-- schema-v2 manifests.
with verified_days as (
  select
    sensor_id,
    (started_at at time zone 'UTC')::date as day
  from public.historical_archives
  where dataset = 'traffic_passages'
    and schema_version = 2
    and status = 'verified'
  group by sensor_id, day
),
deleted as (
  delete from public.traffic_passages p
  using verified_days v
  where p.sensor_id = v.sensor_id
    and (coalesce(p.ended_at, p.received_at) at time zone 'UTC')::date = v.day
  returning p.sensor_id
)
select count(*) as deleted_rows from deleted;

do $$
begin
  if exists (select 1 from public.traffic_passages) then
    raise exception 'ABORT: traffic_passages still contains rows after deletion';
  end if;
end $$;

update public.historical_archives
set status = 'deleted_from_hot',
    deleted_from_hot_at = now()
where dataset = 'traffic_passages'
  and schema_version = 2
  and status = 'verified';

commit;

-- Run separately after the transaction:
-- vacuum (analyze) public.traffic_passages;
--
-- Keep these Supabase objects:
--   sensors
--   sensor_health
--   ten_minute_summaries
--   traffic_daily
--   traffic_passages (empty hot table for future writes)
--   historical_archives
--   profiles/roles/institutes/saved_reports
--   reference_* and raw_radar_archives for future sensor features
--
-- Do not drop the traffic_* views merely to save space. Views store almost no
-- data; they will reflect only the rows currently retained in traffic_passages.
