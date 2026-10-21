-- Editable display metadata; sensor_id remains the immutable telemetry key.
-- Nullable for compatibility with older firmware/apps that omit this field.
alter table public.sensors add column sensor_name text;

update public.sensors as s
set sensor_name = coalesce(
  (select nullif(btrim(h.diagnostics->>'device_name'), '')
   from public.sensor_health as h where h.sensor_id = s.sensor_id),
  s.sensor_id
);

alter table public.sensors add constraint sensors_sensor_name_valid
  check (sensor_name is null or
    (char_length(btrim(sensor_name)) between 1 and 200));

comment on column public.sensors.sensor_name is
  'Editable human-readable name shown in clients; independent of sensor_id and device health diagnostics.';
