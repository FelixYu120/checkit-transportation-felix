-- Stage 1: compatible with old detailed and new lean firmware. No deletions.
-- Apply only after backend tests and radar_connected build pass.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.traffic_passages ADD COLUMN IF NOT EXISTS observed_at timestamptz;
ALTER TABLE public.traffic_passages ADD COLUMN IF NOT EXISTS speed_kmh smallint
  CONSTRAINT traffic_passages_lean_speed_check CHECK (speed_kmh >= 0);
ALTER TABLE public.sensor_health ADD COLUMN IF NOT EXISTS diagnostics jsonb
  NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(diagnostics) = 'object');

-- Drop NOT NULL only on fields intentionally omitted by lean payloads. Keep
-- every old column/default/check, identity key, RLS policy and grant in place.
DO $migration$
DECLARE col record;
BEGIN
  FOR col IN SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND is_nullable = 'NO' AND (
      (table_name = 'traffic_passages' AND NOT column_name = ANY(ARRAY['sensor_id', 'boot_id', 'track_id', 'observed_at', 'direction', 'traffic_class', 'speed_kmh', 'max_speed_kmh', 'firmware_version', 'received_at']::text[])) OR
      (table_name = 'sensor_health' AND NOT column_name = ANY(ARRAY['sensor_id', 'last_seen_at', 'last_radar_frame_at', 'last_passage_at', 'health_status', 'boot_id', 'uptime_ms', 'radar_active', 'wifi_rssi_dbm', 'pending_passages', 'storage_free_bytes', 'last_http_status', 'firmware_version', 'updated_at', 'diagnostics']::text[])))
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', col.table_name, col.column_name);
  END LOOP;
END $migration$;

CREATE OR REPLACE FUNCTION public.fill_lean_passage_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  NEW.observed_at := coalesce(NEW.observed_at, NEW.ended_at);
  NEW.speed_kmh := coalesce(NEW.speed_kmh, NEW.median_speed_kmh);
  -- Only new compact payloads omit quality. Explicit old review/rejected values
  -- remain intact and are excluded from v2 archives and official aggregation.
  IF NEW.quality_status IS NULL AND NEW.speed_kmh IS NOT NULL THEN
    NEW.quality_status := 'accepted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.received_at := coalesce(OLD.received_at, NEW.received_at, now());
  ELSE
    NEW.received_at := coalesce(NEW.received_at, now());
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fill_lean_passage_transition() FROM PUBLIC;
CREATE TRIGGER fill_lean_passage_transition
BEFORE INSERT OR UPDATE ON public.traffic_passages
FOR EACH ROW EXECUTE FUNCTION public.fill_lean_passage_transition();

UPDATE public.traffic_passages
SET observed_at = coalesce(observed_at, ended_at),
    speed_kmh = coalesce(speed_kmh, median_speed_kmh)
WHERE observed_at IS NULL OR speed_kmh IS NULL;
CREATE INDEX IF NOT EXISTS traffic_passages_sensor_observed_idx
ON public.traffic_passages (sensor_id, observed_at);
NOTIFY pgrst, 'reload schema';
COMMIT;
