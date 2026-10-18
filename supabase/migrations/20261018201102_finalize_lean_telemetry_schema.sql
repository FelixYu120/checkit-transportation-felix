-- Stage 2: MANUAL, DEFERRED. Never include in an unattended db push.
-- Drain every sensor, deploy lean firmware, confirm fresh health, then execute.
-- Existing R2 objects and historical_archives are deliberately untouched.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.sensor_health, public.traffic_passages IN ACCESS EXCLUSIVE MODE;
DO $gate$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sensor_health) OR EXISTS (
    SELECT 1 FROM public.sensor_health
    WHERE pending_passages IS NULL OR pending_passages <> 0
       OR firmware_version IS DISTINCT FROM '3.1.0-lean'
       OR last_seen_at IS NULL OR last_seen_at < now() - interval '24 hours'
  ) THEN
    RAISE EXCEPTION 'Lean finalization blocked: all sensors must report zero pending passages and fresh 3.1.0-lean health after deployment';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sensors s WHERE s.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM public.sensor_health h WHERE h.sensor_id = s.sensor_id)) THEN
    RAISE EXCEPTION 'Lean finalization blocked: an active sensor has no health report';
  END IF;
END $gate$;

DELETE FROM public.traffic_passages WHERE quality_status IS DISTINCT FROM 'accepted';
UPDATE public.sensor_health h SET diagnostics =
  jsonb_strip_nulls(to_jsonb(h) - ARRAY['sensor_id', 'last_seen_at', 'last_radar_frame_at', 'last_passage_at', 'health_status', 'boot_id', 'uptime_ms', 'radar_active', 'wifi_rssi_dbm', 'pending_passages', 'storage_free_bytes', 'last_http_status', 'firmware_version', 'updated_at', 'diagnostics']::text[]) || coalesce(h.diagnostics, '{}'::jsonb);

DROP TRIGGER fill_lean_passage_transition ON public.traffic_passages;
DROP FUNCTION public.fill_lean_passage_transition();
-- Retain server-side receipt stamping for the explicit null sent by firmware.
CREATE OR REPLACE FUNCTION public.stamp_lean_passage_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.received_at := coalesce(OLD.received_at, NEW.received_at, now());
  ELSE
    NEW.received_at := coalesce(NEW.received_at, now());
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.stamp_lean_passage_receipt() FROM PUBLIC;
CREATE TRIGGER stamp_lean_passage_receipt BEFORE INSERT OR UPDATE ON public.traffic_passages
FOR EACH ROW EXECUTE FUNCTION public.stamp_lean_passage_receipt();

-- No CASCADE: an unexpected view, FK or policy dependency aborts the entire
-- transaction, instead of silently deleting downstream access controls.
DO $migration$
DECLARE col record;
BEGIN
  FOR col IN SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND (
      (table_name = 'traffic_passages' AND NOT column_name = ANY(ARRAY['sensor_id', 'boot_id', 'track_id', 'observed_at', 'direction', 'traffic_class', 'speed_kmh', 'max_speed_kmh', 'firmware_version', 'received_at']::text[])) OR
      (table_name = 'sensor_health' AND NOT column_name = ANY(ARRAY['sensor_id', 'last_seen_at', 'last_radar_frame_at', 'last_passage_at', 'health_status', 'boot_id', 'uptime_ms', 'radar_active', 'wifi_rssi_dbm', 'pending_passages', 'storage_free_bytes', 'last_http_status', 'firmware_version', 'updated_at', 'diagnostics']::text[])) OR
      (table_name = 'traffic_daily' AND NOT column_name = ANY(ARRAY['sensor_id', 'day', 'volume', 'approach_volume', 'away_volume', 'motor_vehicle_volume', 'micromobility_volume', 'unknown_volume', 'speed_count', 'speed_sum_kmh', 'max_speed_kmh', 'speed_histogram', 'updated_at']::text[])))
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN %I', col.table_name, col.column_name);
  END LOOP;
END $migration$;
ALTER TABLE public.traffic_passages ALTER COLUMN speed_kmh SET NOT NULL;

ALTER TABLE public.ten_minute_summaries DROP CONSTRAINT ten_minute_summaries_pkey;
ALTER TABLE public.ten_minute_summaries DROP COLUMN id, DROP COLUMN created_at,
  DROP COLUMN reference_measurement;
ALTER TABLE public.ten_minute_summaries ADD PRIMARY KEY (sensor_id, time_bucket, direction);
-- Keep the existing composite unique index for existing ON CONFLICT clients.
NOTIFY pgrst, 'reload schema';
COMMIT;
