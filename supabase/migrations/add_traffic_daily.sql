-- Additive only. Review and apply manually; this migration deletes no data.
create table if not exists public.traffic_daily (
  sensor_id varchar not null references public.sensors(sensor_id),
  day date not null,
  volume integer not null default 0 check (volume >= 0),
  approach_volume integer not null default 0 check (approach_volume >= 0),
  away_volume integer not null default 0 check (away_volume >= 0),
  motor_vehicle_volume integer not null default 0 check (motor_vehicle_volume >= 0),
  micromobility_volume integer not null default 0 check (micromobility_volume >= 0),
  unknown_volume integer not null default 0 check (unknown_volume >= 0),
  speed_count integer not null default 0 check (speed_count >= 0),
  speed_sum_kmh bigint not null default 0 check (speed_sum_kmh >= 0),
  max_speed_kmh smallint not null default 0 check (max_speed_kmh >= 0),
  speed_histogram integer[] not null,
  histogram_bin_size_kmh smallint not null default 5 check (histogram_bin_size_kmh = 5),
  histogram_version smallint not null default 1 check (histogram_version = 1),
  speeding_count integer not null default 0 check (speeding_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  snr_sum bigint not null default 0,
  snr_count integer not null default 0 check (snr_count >= 0),
  source_passage_count integer not null default 0 check (source_passage_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (sensor_id, day),
  constraint traffic_daily_histogram_shape_check check (
    cardinality(speed_histogram) = 25 and 0 <= all (speed_histogram)
  ),
  constraint traffic_daily_volume_components_check check (
    motor_vehicle_volume + micromobility_volume + unknown_volume = volume
  )
);

create index if not exists traffic_daily_sensor_day_desc_idx
  on public.traffic_daily (sensor_id, day desc);

alter table public.traffic_daily enable row level security;

-- No client access model was available, so expose nothing through Data API roles.
revoke all on table public.traffic_daily from anon, authenticated;

comment on column public.traffic_daily.speed_histogram is
  '25 bins: [0,5), [5,10), ..., [115,120), and [120,+infinity) km/h.';
comment on column public.traffic_daily.speeding_count is
  'Zero when no verified site-specific speeding threshold is configured.';
