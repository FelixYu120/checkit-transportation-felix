-- Schema-only fixture captured from Transportation before the lean transition.
-- No production rows or credentials. Policies below are test-only.
CREATE TABLE public.sensors (sensor_id varchar(64) PRIMARY KEY, status text);

CREATE TABLE public.traffic_passages (
  "sensor_id" character varying NOT NULL,
  "boot_id" bigint NOT NULL,
  "track_id" bigint NOT NULL,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "direction" character varying NOT NULL,
  "traffic_class" character varying NOT NULL,
  "class_confidence" real NOT NULL,
  "quality_status" character varying NOT NULL,
  "quality_score" smallint NOT NULL,
  "association_confidence" real NOT NULL,
  "direction_consistency" real NOT NULL,
  "hit_count" integer NOT NULL,
  "duration_ms" bigint NOT NULL,
  "median_speed_kmh" smallint NOT NULL,
  "p85_speed_kmh" smallint NOT NULL,
  "max_speed_kmh" smallint NOT NULL,
  "mean_snr" smallint NOT NULL,
  "max_snr" smallint NOT NULL,
  "peak_cluster_size" smallint NOT NULL,
  "travel_distance_m" real NOT NULL,
  "entry_distance_m" smallint NOT NULL,
  "entry_angle_deg" smallint NOT NULL,
  "exit_distance_m" smallint NOT NULL,
  "exit_angle_deg" smallint NOT NULL,
  "firmware_version" text NOT NULL,
  "model_version" text NOT NULL,
  "path_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "human_label" character varying,
  "label_confidence" real,
  "label_notes" text,
  "labeled_at" timestamp with time zone,
  CONSTRAINT "traffic_passages_association_confidence_check" CHECK (((association_confidence >= (0)::double precision) AND (association_confidence <= (1)::double precision))),
  CONSTRAINT "traffic_passages_boot_id_check" CHECK (((boot_id >= 1) AND (boot_id <= '4294967295'::bigint))),
  CONSTRAINT "traffic_passages_check" CHECK ((ended_at >= started_at)),
  CONSTRAINT "traffic_passages_class_confidence_check" CHECK (((class_confidence >= (0)::double precision) AND (class_confidence <= (1)::double precision))),
  CONSTRAINT "traffic_passages_direction_check" CHECK (((direction)::text = ANY ((ARRAY['approach'::character varying, 'away'::character varying])::text[]))),
  CONSTRAINT "traffic_passages_direction_consistency_check" CHECK (((direction_consistency >= (0)::double precision) AND (direction_consistency <= (1)::double precision))),
  CONSTRAINT "traffic_passages_duration_ms_check" CHECK ((duration_ms >= 0)),
  CONSTRAINT "traffic_passages_entry_angle_deg_check" CHECK (((entry_angle_deg >= '-128'::integer) AND (entry_angle_deg <= 127))),
  CONSTRAINT "traffic_passages_entry_distance_m_check" CHECK ((entry_distance_m >= 0)),
  CONSTRAINT "traffic_passages_exit_angle_deg_check" CHECK (((exit_angle_deg >= '-128'::integer) AND (exit_angle_deg <= 127))),
  CONSTRAINT "traffic_passages_exit_distance_m_check" CHECK ((exit_distance_m >= 0)),
  CONSTRAINT "traffic_passages_hit_count_check" CHECK ((hit_count > 0)),
  CONSTRAINT "traffic_passages_human_label_check" CHECK (((human_label IS NULL) OR ((human_label)::text = ANY ((ARRAY['motor_vehicle'::character varying, 'micromobility'::character varying, 'pedestrian'::character varying, 'noise'::character varying, 'other'::character varying])::text[])))),
  CONSTRAINT "traffic_passages_label_confidence_check" CHECK (((label_confidence IS NULL) OR ((label_confidence >= (0)::double precision) AND (label_confidence <= (1)::double precision)))),
  CONSTRAINT "traffic_passages_max_snr_check" CHECK (((max_snr >= 0) AND (max_snr <= 255))),
  CONSTRAINT "traffic_passages_max_speed_kmh_check" CHECK ((max_speed_kmh >= 0)),
  CONSTRAINT "traffic_passages_mean_snr_check" CHECK (((mean_snr >= 0) AND (mean_snr <= 255))),
  CONSTRAINT "traffic_passages_median_speed_kmh_check" CHECK ((median_speed_kmh >= 0)),
  CONSTRAINT "traffic_passages_p85_speed_kmh_check" CHECK ((p85_speed_kmh >= 0)),
  CONSTRAINT "traffic_passages_path_points_check" CHECK ((jsonb_typeof(path_points) = 'array'::text)),
  CONSTRAINT "traffic_passages_peak_cluster_size_check" CHECK ((peak_cluster_size > 0)),
  CONSTRAINT "traffic_passages_pkey" PRIMARY KEY (sensor_id, boot_id, track_id),
  CONSTRAINT "traffic_passages_quality_score_check" CHECK (((quality_score >= 0) AND (quality_score <= 100))),
  CONSTRAINT "traffic_passages_quality_status_check" CHECK (((quality_status)::text = ANY ((ARRAY['accepted'::character varying, 'review'::character varying, 'rejected'::character varying])::text[]))),
  CONSTRAINT "traffic_passages_sensor_id_fkey" FOREIGN KEY (sensor_id) REFERENCES sensors(sensor_id),
  CONSTRAINT "traffic_passages_track_id_check" CHECK (((track_id >= 1) AND (track_id <= '4294967295'::bigint))),
  CONSTRAINT "traffic_passages_traffic_class_check" CHECK (((traffic_class)::text = ANY ((ARRAY['motor_vehicle'::character varying, 'micromobility'::character varying, 'unknown'::character varying])::text[]))),
  CONSTRAINT "traffic_passages_travel_distance_m_check" CHECK ((travel_distance_m >= (0)::double precision))
);

ALTER TABLE public.traffic_passages ENABLE ROW LEVEL SECURITY;

CREATE POLICY test_sensor_scope ON public.traffic_passages FOR SELECT TO PUBLIC USING (sensor_id = 'fixture');

GRANT SELECT ON public.traffic_passages TO PUBLIC;

CREATE TABLE public.sensor_health (
  "sensor_id" character varying NOT NULL,
  "device_name" character varying NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "last_radar_frame_at" timestamp with time zone,
  "last_passage_at" timestamp with time zone,
  "health_status" character varying NOT NULL,
  "boot_id" bigint NOT NULL,
  "uptime_ms" bigint NOT NULL,
  "radar_active" boolean NOT NULL,
  "radar_frame_count" bigint NOT NULL,
  "radar_frame_errors" bigint NOT NULL,
  "wifi_rssi_dbm" smallint NOT NULL,
  "pending_passages" bigint NOT NULL,
  "storage_used_bytes" bigint NOT NULL,
  "storage_free_bytes" bigint NOT NULL,
  "storage_errors" bigint NOT NULL,
  "last_http_status" integer NOT NULL,
  "speed_limit_kmh" smallint NOT NULL,
  "reset_reason" smallint NOT NULL,
  "provisioned" boolean NOT NULL,
  "ble_active" boolean NOT NULL,
  "firmware_version" text NOT NULL,
  "model_version" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "low_snr_returns_filtered" bigint DEFAULT 0 NOT NULL,
  "slow_returns_excluded" bigint DEFAULT 0 NOT NULL,
  "weak_extreme_speed_returns_filtered" bigint DEFAULT 0 NOT NULL,
  "target_capacity_frames" bigint DEFAULT 0 NOT NULL,
  "truncated_target_frames" bigint DEFAULT 0 NOT NULL,
  "maximum_reported_targets" smallint DEFAULT 0 NOT NULL,
  "feature_version" text DEFAULT 'legacy-polar-only'::text NOT NULL,
  CONSTRAINT "sensor_health_boot_id_check" CHECK (((boot_id >= 1) AND (boot_id <= '4294967295'::bigint))),
  CONSTRAINT "sensor_health_health_status_check" CHECK (((health_status)::text = ANY ((ARRAY['online'::character varying, 'radar_stale'::character varying, 'storage_fault'::character varying])::text[]))),
  CONSTRAINT "sensor_health_low_snr_returns_filtered_check" CHECK ((low_snr_returns_filtered >= 0)),
  CONSTRAINT "sensor_health_maximum_reported_targets_check" CHECK (((maximum_reported_targets >= 0) AND (maximum_reported_targets <= 255))),
  CONSTRAINT "sensor_health_pending_passages_check" CHECK ((pending_passages >= 0)),
  CONSTRAINT "sensor_health_pkey" PRIMARY KEY (sensor_id),
  CONSTRAINT "sensor_health_radar_frame_count_check" CHECK ((radar_frame_count >= 0)),
  CONSTRAINT "sensor_health_radar_frame_errors_check" CHECK ((radar_frame_errors >= 0)),
  CONSTRAINT "sensor_health_sensor_id_fkey" FOREIGN KEY (sensor_id) REFERENCES sensors(sensor_id),
  CONSTRAINT "sensor_health_slow_returns_excluded_check" CHECK ((slow_returns_excluded >= 0)),
  CONSTRAINT "sensor_health_speed_limit_kmh_check" CHECK (((speed_limit_kmh >= 1) AND (speed_limit_kmh <= 240))),
  CONSTRAINT "sensor_health_storage_errors_check" CHECK ((storage_errors >= 0)),
  CONSTRAINT "sensor_health_storage_free_bytes_check" CHECK ((storage_free_bytes >= 0)),
  CONSTRAINT "sensor_health_storage_used_bytes_check" CHECK ((storage_used_bytes >= 0)),
  CONSTRAINT "sensor_health_target_capacity_frames_check" CHECK ((target_capacity_frames >= 0)),
  CONSTRAINT "sensor_health_truncated_target_frames_check" CHECK ((truncated_target_frames >= 0)),
  CONSTRAINT "sensor_health_uptime_ms_check" CHECK ((uptime_ms >= 0)),
  CONSTRAINT "sensor_health_weak_extreme_speed_returns_filtered_check" CHECK ((weak_extreme_speed_returns_filtered >= 0))
);

ALTER TABLE public.sensor_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY test_sensor_scope ON public.sensor_health FOR SELECT TO PUBLIC USING (sensor_id = 'fixture');

GRANT SELECT ON public.sensor_health TO PUBLIC;

CREATE TABLE public.ten_minute_summaries (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "sensor_id" character varying(50) NOT NULL,
  "time_bucket" timestamp with time zone NOT NULL,
  "direction" character varying(20) NOT NULL,
  "volume" integer,
  "avg_speed" numeric(5,2),
  "v85_speed" numeric(5,2),
  "max_speed" numeric(5,2),
  "created_at" timestamp with time zone DEFAULT now(),
  "reference_measurement" jsonb,
  CONSTRAINT "fk_sensor" FOREIGN KEY (sensor_id) REFERENCES sensors(sensor_id) ON DELETE CASCADE,
  CONSTRAINT "ten_minute_summaries_pkey" PRIMARY KEY (id),
  CONSTRAINT "ten_minute_summaries_reference_measurement_object" CHECK (((reference_measurement IS NULL) OR (jsonb_typeof(reference_measurement) = 'object'::text))),
  CONSTRAINT "ten_minute_summaries_sensor_id_time_bucket_direction_key" UNIQUE (sensor_id, time_bucket, direction)
);

ALTER TABLE public.ten_minute_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY test_sensor_scope ON public.ten_minute_summaries FOR SELECT TO PUBLIC USING (sensor_id = 'fixture');

GRANT SELECT ON public.ten_minute_summaries TO PUBLIC;

CREATE TABLE public.traffic_daily (
  "sensor_id" character varying NOT NULL,
  "day" date NOT NULL,
  "volume" integer DEFAULT 0 NOT NULL,
  "approach_volume" integer DEFAULT 0 NOT NULL,
  "away_volume" integer DEFAULT 0 NOT NULL,
  "motor_vehicle_volume" integer DEFAULT 0 NOT NULL,
  "micromobility_volume" integer DEFAULT 0 NOT NULL,
  "unknown_volume" integer DEFAULT 0 NOT NULL,
  "speed_count" integer DEFAULT 0 NOT NULL,
  "speed_sum_kmh" bigint DEFAULT 0 NOT NULL,
  "max_speed_kmh" smallint DEFAULT 0 NOT NULL,
  "speed_histogram" integer[] NOT NULL,
  "histogram_bin_size_kmh" smallint DEFAULT 5 NOT NULL,
  "histogram_version" smallint DEFAULT 1 NOT NULL,
  "speeding_count" integer DEFAULT 0 NOT NULL,
  "accepted_count" integer DEFAULT 0 NOT NULL,
  "review_count" integer DEFAULT 0 NOT NULL,
  "rejected_count" integer DEFAULT 0 NOT NULL,
  "snr_sum" bigint DEFAULT 0 NOT NULL,
  "snr_count" integer DEFAULT 0 NOT NULL,
  "source_passage_count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "traffic_daily_accepted_count_check" CHECK ((accepted_count >= 0)),
  CONSTRAINT "traffic_daily_approach_volume_check" CHECK ((approach_volume >= 0)),
  CONSTRAINT "traffic_daily_away_volume_check" CHECK ((away_volume >= 0)),
  CONSTRAINT "traffic_daily_histogram_bin_size_kmh_check" CHECK ((histogram_bin_size_kmh = 5)),
  CONSTRAINT "traffic_daily_histogram_shape_check" CHECK (((cardinality(speed_histogram) = 25) AND (0 <= ALL (speed_histogram)))),
  CONSTRAINT "traffic_daily_histogram_version_check" CHECK ((histogram_version = 1)),
  CONSTRAINT "traffic_daily_max_speed_kmh_check" CHECK ((max_speed_kmh >= 0)),
  CONSTRAINT "traffic_daily_micromobility_volume_check" CHECK ((micromobility_volume >= 0)),
  CONSTRAINT "traffic_daily_motor_vehicle_volume_check" CHECK ((motor_vehicle_volume >= 0)),
  CONSTRAINT "traffic_daily_pkey" PRIMARY KEY (sensor_id, day),
  CONSTRAINT "traffic_daily_rejected_count_check" CHECK ((rejected_count >= 0)),
  CONSTRAINT "traffic_daily_review_count_check" CHECK ((review_count >= 0)),
  CONSTRAINT "traffic_daily_sensor_id_fkey" FOREIGN KEY (sensor_id) REFERENCES sensors(sensor_id),
  CONSTRAINT "traffic_daily_snr_count_check" CHECK ((snr_count >= 0)),
  CONSTRAINT "traffic_daily_source_passage_count_check" CHECK ((source_passage_count >= 0)),
  CONSTRAINT "traffic_daily_speed_count_check" CHECK ((speed_count >= 0)),
  CONSTRAINT "traffic_daily_speed_sum_kmh_check" CHECK ((speed_sum_kmh >= 0)),
  CONSTRAINT "traffic_daily_speeding_count_check" CHECK ((speeding_count >= 0)),
  CONSTRAINT "traffic_daily_unknown_volume_check" CHECK ((unknown_volume >= 0)),
  CONSTRAINT "traffic_daily_volume_check" CHECK ((volume >= 0)),
  CONSTRAINT "traffic_daily_volume_components_check" CHECK ((((motor_vehicle_volume + micromobility_volume) + unknown_volume) = volume))
);

ALTER TABLE public.traffic_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY test_sensor_scope ON public.traffic_daily FOR SELECT TO PUBLIC USING (sensor_id = 'fixture');

GRANT SELECT ON public.traffic_daily TO PUBLIC;
