#pragma once

#ifndef CHECKIT_FIRMWARE_VERSION
#define CHECKIT_FIRMWARE_VERSION "2.7.0"
#endif

// ---------------------------------------------------------------------------
// Node identity and radio
// ---------------------------------------------------------------------------

#ifndef CHECKIT_RADAR_NODE_ID
#define CHECKIT_RADAR_NODE_ID 1
#endif

#ifndef CHECKIT_FLASH_NODE_ID
#define CHECKIT_FLASH_NODE_ID 101
#endif

#define CHECKIT_BROADCAST_NODE_ID 0

#ifndef CHECKIT_TARGET_FLASH_NODE_ID
#define CHECKIT_TARGET_FLASH_NODE_ID CHECKIT_FLASH_NODE_ID
#endif

// All Check-It nodes at one installation must use the same Wi-Fi channel.
#ifndef CHECKIT_ESPNOW_CHANNEL
#define CHECKIT_ESPNOW_CHANNEL 6
#endif

#define CHECKIT_ESPNOW_HEARTBEAT_MS 2000UL
#define CHECKIT_RADAR_STALE_MS 12000UL
#define CHECKIT_ESPNOW_ALERT_ACK_TIMEOUT_MS 1000UL

// ---------------------------------------------------------------------------
// Self-contained radar web dashboard
// ---------------------------------------------------------------------------

#ifndef CHECKIT_ENABLE_RADAR_WEB
#define CHECKIT_ENABLE_RADAR_WEB 1
#endif

// The radar node creates this private Wi-Fi network. Change the password
// before public deployment; WPA2 requires at least eight characters.
#define CHECKIT_RADAR_AP_SSID "CheckIt-Radar-1"
#define CHECKIT_RADAR_AP_PASSWORD "CheckItV2"
#define CHECKIT_RADAR_WEB_PORT 80
#define CHECKIT_RADAR_ACTIVE_TIMEOUT_MS 3000UL

// The flashing node creates a separate service network for commissioning.
// This is not Internet Wi-Fi and does not need the hotspot credentials from
// CheckItSecrets.h. ESP-NOW remains responsible for radar alerts.
#ifndef CHECKIT_ENABLE_FLASH_WEB
#define CHECKIT_ENABLE_FLASH_WEB 1
#endif

#define CHECKIT_FLASH_AP_SSID "CheckIt-Flash-101"
#define CHECKIT_FLASH_AP_PASSWORD "CheckItV2"
#define CHECKIT_FLASH_WEB_PORT 80

// ---------------------------------------------------------------------------
// Optional Wi-Fi/Supabase telemetry
// ---------------------------------------------------------------------------

#ifndef CHECKIT_ENABLE_CLOUD_UPLOAD
#define CHECKIT_ENABLE_CLOUD_UPLOAD 1
#endif

#define CHECKIT_SUPABASE_TABLE "ten_minute_summaries"
#define CHECKIT_SUPABASE_HEALTH_TABLE "sensor_health"

// Completed anonymous tracks are queued to a separate FreeRTOS uploader. The
// warning path never waits for cloud work.
#define CHECKIT_SUPABASE_PASSAGE_TABLE "traffic_passages"
#define CHECKIT_CLOUD_QUEUE_DEPTH 16
#define CHECKIT_CLOUD_QUEUE_WAIT_MS 250UL
#define CHECKIT_CLOUD_UPLOAD_INTERVAL_MS 3600000UL
#define CHECKIT_CLOUD_RETRY_BASE_MS 15000UL
#define CHECKIT_CLOUD_RETRY_MAX_MS 120000UL
#define CHECKIT_CLOUD_MAX_ATTEMPTS 5U
#define CHECKIT_CLOUD_PENDING_SUMMARY_DEPTH 72U
#define CHECKIT_CLOUD_PASSAGE_UPLOAD_BATCH_SIZE 8U
#define CHECKIT_PASSAGE_JOURNAL_COMPACT_BYTES 1048576UL
#define CHECKIT_CLOUD_HTTP_CONNECT_TIMEOUT_MS 5000UL
#define CHECKIT_CLOUD_HTTP_TIMEOUT_MS 10000UL
#define CHECKIT_CLOUD_WIFI_STARTUP_TIMEOUT_MS 15000UL
#define CHECKIT_CLOUD_WIFI_RECONNECT_INTERVAL_MS 15000UL
#define CHECKIT_CLOUD_WIFI_RADIO_RESET_ATTEMPTS 5U
#define CHECKIT_CLOUD_WIFI_OFFLINE_RESTART_MS 900000UL
#define CHECKIT_CLOUD_HEALTH_INTERVAL_MS 600000UL
#define CHECKIT_CLOUD_HEALTH_RETRY_MS 60000UL
#define CHECKIT_CLOUD_HEALTH_STARTUP_DELAY_MS 30000UL
#define CHECKIT_HEALTH_SNAPSHOT_INTERVAL_MS 5000UL
#define CHECKIT_CLOUD_TASK_STACK_BYTES 20480

#define CHECKIT_SUMMARY_BUCKET_SECONDS 600UL

// The deployed count intentionally prioritizes micromobility and motor
// vehicles. Walking-speed returns are excluded before tracking and storage.
#define CHECKIT_TELEMETRY_MIN_DISTANCE_M 1U
#define CHECKIT_TELEMETRY_MAX_DISTANCE_M 100U
#define CHECKIT_TELEMETRY_MIN_SNR 4U
#define CHECKIT_TELEMETRY_MAX_ABS_ANGLE_DEG 60U
#define CHECKIT_TELEMETRY_MIN_SPEED_KMH 7U

// ---------------------------------------------------------------------------
// Anonymous multi-frame tracking and conservative traffic classification
// ---------------------------------------------------------------------------

// Nearby returns in one frame are collapsed before association because one
// large vehicle can produce more than one radar dot.
#define CHECKIT_TRACKER_CLUSTER_DISTANCE_M 2U
#define CHECKIT_TRACKER_CLUSTER_ANGLE_DEG 7U
#define CHECKIT_TRACKER_CLUSTER_SPEED_KMH 7U

// Association is deliberately stricter than the warning path. Tracks are
// closed after a short absence and counted once, rather than once per dot.
#define CHECKIT_TRACKER_MAX_ASSOCIATION_GAP_MS 750UL
#define CHECKIT_TRACKER_FINALIZE_GAP_MS 1200UL
#define CHECKIT_TRACKER_PATH_SAMPLE_INTERVAL_MS 250UL
#define CHECKIT_TRACKER_MAX_DISTANCE_DELTA_M 4U
#define CHECKIT_TRACKER_MAX_ANGLE_DELTA_DEG 16U
#define CHECKIT_TRACKER_MAX_SPEED_DELTA_KMH 15U

// Official counts require a sustained, spatially moving path. Borderline and
// rejected paths are still uploaded with their quality status for calibration.
#define CHECKIT_TRACKER_MIN_HITS 4U
#define CHECKIT_TRACKER_MIN_DURATION_MS 600UL
#define CHECKIT_TRACKER_MIN_TRAVEL_M 2U
#define CHECKIT_TRACKER_MIN_ASSOCIATION_CONFIDENCE 70U
#define CHECKIT_TRACKER_MIN_DIRECTION_CONSISTENCY 70U
#define CHECKIT_TRACKER_ACCEPTED_QUALITY_SCORE 75U
#define CHECKIT_TRACKER_REVIEW_QUALITY_SCORE 50U

// This first classifier is a transparent calibration baseline, not a trained
// ML model. Ambiguous tracks remain unknown instead of being forced into a
// class. Replace/tune it only after labeled field runs.
#define CHECKIT_TRAFFIC_MICROMOBILITY_MIN_SPEED_KMH 7U
#define CHECKIT_TRAFFIC_MOTOR_VEHICLE_MIN_SPEED_KMH 18U
#define CHECKIT_TRAFFIC_CLASS_CONFIDENCE_THRESHOLD 75U
#define CHECKIT_TRAFFIC_MODEL_VERSION "vehicle-kinematic-rules-v2"
#define CHECKIT_TRAFFIC_FEATURE_VERSION "trajectory-xy-v1"
#define CHECKIT_TRAFFIC_LARGE_SAMPLE_GAP_MS 500U

// 100 mph is 160.934 km/h. A reading at or above that speed is discarded only
// when its SNR is also weak, so a strong high-speed return is not silently
// removed. These are site-policy defaults and remain visible in diagnostics.
#define CHECKIT_IMPLAUSIBLE_SPEED_KMH 161U
#define CHECKIT_IMPLAUSIBLE_SPEED_MIN_SNR 20U

// Used only to report frames in which the radar may have exhausted its limited
// target budget. It does not change parsing or filtering behavior.
#define CHECKIT_RADAR_REPORTED_TARGET_CAPACITY 6U

// A target must pass the static warning-quality checks and resemble a target
// in the immediately preceding frame before it is shown or used by the warning
// decision. The tracker may retain plausible unconfirmed dots as rejected or
// review paths, but those never affect official counts.
#define CHECKIT_TARGET_CONFIRMATION_MAX_FRAME_GAP_MS 500UL
#define CHECKIT_TARGET_CONFIRMATION_MAX_DISTANCE_DELTA_M 3U
#define CHECKIT_TARGET_CONFIRMATION_MAX_ANGLE_DELTA_DEG 12U
#define CHECKIT_TARGET_CONFIRMATION_MAX_SPEED_DELTA_KMH 12U
#define CHECKIT_RADAR_DIAGNOSTIC_INTERVAL_MS 1000UL

#define CHECKIT_NTP_PRIMARY "pool.ntp.org"
#define CHECKIT_NTP_SECONDARY "time.google.com"
#define CHECKIT_MIN_VALID_UNIX_TIME 1704067200UL

// ---------------------------------------------------------------------------
// LD2451 UART and startup configuration
// ---------------------------------------------------------------------------

#define CHECKIT_RADAR_UART_BAUD 115200
#define CHECKIT_RADAR_UART_RX_PIN 16
#define CHECKIT_RADAR_UART_TX_PIN 17

// The official V1.03 table says 0=away and 1=approach, while its worked
// example labels those values in reverse. Leave this at 0 to follow the table,
// then verify with controlled approach/away passes. Set it to 1 only if the
// physical module proves that byte 0 means approach.
#ifndef CHECKIT_LD2451_ZERO_DIRECTION_IS_APPROACH
#define CHECKIT_LD2451_ZERO_DIRECTION_IS_APPROACH 0
#endif

// Keep +1 if positive LD2451 angles are clockwise/right from the installed
// boresight. Use -1 only if a controlled left/right calibration proves the
// physical orientation needs to be mirrored.
#ifndef CHECKIT_LD2451_ANGLE_SIGN
#define CHECKIT_LD2451_ANGLE_SIGN 1
#endif

#ifndef CHECKIT_CONFIGURE_RADAR_ON_BOOT
#define CHECKIT_CONFIGURE_RADAR_ON_BOOT 1
#endif

#define CHECKIT_RADAR_MAX_DISTANCE_M 100
#define CHECKIT_RADAR_DIRECTION_BOTH 2
#define CHECKIT_RADAR_MIN_SPEED_KMH 7
#define CHECKIT_RADAR_COMMAND_ATTEMPTS 3U
#define CHECKIT_RADAR_NO_TARGET_DELAY_SEC 1
#define CHECKIT_RADAR_TRIGGER_COUNT 1
#define CHECKIT_RADAR_SNR_THRESHOLD_LEVEL 4
#define CHECKIT_RADAR_COMMAND_TIMEOUT_MS 1200UL

// ---------------------------------------------------------------------------
// Independent HLK-LD2415H reference channel
// ---------------------------------------------------------------------------

// The reference radar is intentionally not part of official counting. Its
// signed speed samples are stored separately for later comparison against an
// unambiguous completed LD2451 passage.
#ifndef CHECKIT_ENABLE_REFERENCE_RADAR
#define CHECKIT_ENABLE_REFERENCE_RADAR 1
#endif
#define CHECKIT_REFERENCE_UART_BAUD 9600
// On the T-SIM, USB CDC remains the diagnostic console while hardware UART0
// is remapped to two otherwise-unused camera pins. No camera may be attached.
#define CHECKIT_REFERENCE_TSIM_UART_RX_PIN 10
#define CHECKIT_REFERENCE_TSIM_UART_TX_PIN 12
// Optional separate generic-ESP32 target retained for isolated bench work.
#define CHECKIT_REFERENCE_STANDALONE_UART_RX_PIN 16
#define CHECKIT_REFERENCE_STANDALONE_UART_TX_PIN 17
#define CHECKIT_REFERENCE_MIN_SPEED_KMH 7U
#define CHECKIT_REFERENCE_ANGLE_COMPENSATION_DEG 0U
#define CHECKIT_REFERENCE_SENSITIVITY 5U
#define CHECKIT_REFERENCE_SAMPLE_RATE_DIVISOR 1U
#define CHECKIT_REFERENCE_ANTI_VIBRATION 5U
#define CHECKIT_REFERENCE_CONFIGURE_ON_BOOT 1
#define CHECKIT_REFERENCE_AP_SSID "CheckIt-Reference-1"
#define CHECKIT_REFERENCE_AP_PASSWORD "CheckItV2"
#define CHECKIT_REFERENCE_WEB_PORT 80
#define CHECKIT_REFERENCE_TABLE "reference_measurements"
#define CHECKIT_REFERENCE_QUEUE_DEPTH 128U
#define CHECKIT_REFERENCE_UPLOAD_BATCH_SIZE 16U
#define CHECKIT_REFERENCE_UPLOAD_STARTUP_DELAY_MS 30000UL
#define CHECKIT_REFERENCE_UPLOAD_INTERVAL_MS 3600000UL
#define CHECKIT_REFERENCE_RETRY_MS 30000UL
#define CHECKIT_REFERENCE_JOURNAL_COMPACT_BYTES 262144UL
#define CHECKIT_REFERENCE_TASK_STACK_BYTES 16384U

// Set to 1 only for a no-radar bench demonstration.
#ifndef CHECKIT_MOCK_RADAR
#define CHECKIT_MOCK_RADAR 0
#endif

// ---------------------------------------------------------------------------
// Warning policy
// ---------------------------------------------------------------------------

// Output threshold used by the current short-range commissioning setup. The
// separate 7 km/h radar/telemetry intake cutoff below still prevents ordinary
// walking-speed returns from reaching the warning or tracking paths.
#define CHECKIT_SPEED_LIMIT_KMH 3
#define CHECKIT_DANGER_SPEED_KMH 25
#define CHECKIT_EMERGENCY_SPEED_KMH 35
// Short-range bench threshold: allows testing in a room at 2 metres.
#define CHECKIT_MIN_WARNING_DISTANCE_M 2
#define CHECKIT_MAX_WARNING_DISTANCE_M 80
#define CHECKIT_MIN_WARNING_SNR 4
#define CHECKIT_MAX_WARNING_ABS_ANGLE_DEG 45
#define CHECKIT_WARN_APPROACH 1
#define CHECKIT_WARN_AWAY 1
#define CHECKIT_REQUIRED_CONSECUTIVE_FRAMES 2
#define CHECKIT_ALERT_COOLDOWN_MS 5000UL

// A qualifying target nearer than this uses the matrix attached to the radar
// node. At this distance or farther, only the separate flashing node is
// commanded. Measure the installed sign positions and commission this value
// before field deployment.
#ifndef CHECKIT_REMOTE_FLASH_DISTANCE_M
#define CHECKIT_REMOTE_FLASH_DISTANCE_M 15
#endif

// ---------------------------------------------------------------------------
// Output hardware
// ---------------------------------------------------------------------------

#define CHECKIT_MATRIX_MODULE_COUNT 4
#define CHECKIT_MATRIX_INTENSITY 2

// Commissioning aid: flash each node's attached matrix after boot and expose
// the same test from its web dashboard. Disable before field deployment.
#ifndef CHECKIT_ENABLE_OUTPUT_SELF_TEST_ON_BOOT
#define CHECKIT_ENABLE_OUTPUT_SELF_TEST_ON_BOOT 1
#endif

#define CHECKIT_OUTPUT_TEST_SPEED_KMH 8
#define CHECKIT_OUTPUT_TEST_DURATION_MS 6000UL

// T-SIM7080-S3 radar node. These are camera pins and are available only when
// no camera is fitted.
#define CHECKIT_RADAR_MATRIX_DIN_PIN 11
#define CHECKIT_RADAR_MATRIX_CS_PIN 13
#define CHECKIT_RADAR_MATRIX_CLK_PIN 14
#define CHECKIT_RADAR_SPEAKER_PIN 9
#define CHECKIT_RADAR_STATUS_LED_PIN -1

// Generic ESP32 flashing node.
#define CHECKIT_FLASH_MATRIX_DIN_PIN 23
#define CHECKIT_FLASH_MATRIX_CS_PIN 5
#define CHECKIT_FLASH_MATRIX_CLK_PIN 18
#define CHECKIT_FLASH_SPEAKER_PIN 25
#define CHECKIT_FLASH_STATUS_LED_PIN 2

#ifndef CHECKIT_ENABLE_RADAR_MATRIX
#define CHECKIT_ENABLE_RADAR_MATRIX 1
#endif

#ifndef CHECKIT_ENABLE_RADAR_SPEAKER
#define CHECKIT_ENABLE_RADAR_SPEAKER 1
#endif

#ifndef CHECKIT_ENABLE_FLASH_MATRIX
#define CHECKIT_ENABLE_FLASH_MATRIX 1
#endif

#ifndef CHECKIT_ENABLE_FLASH_SPEAKER
#define CHECKIT_ENABLE_FLASH_SPEAKER 1
#endif

// Most FC-16 chains need logical module 0 shifted last. Change this if the
// installed matrix appears in reverse order.
#ifndef CHECKIT_MATRIX_REVERSE_MODULE_ORDER
#define CHECKIT_MATRIX_REVERSE_MODULE_ORDER 0
#endif

// ---------------------------------------------------------------------------
// Survey metadata used by JSON telemetry and ML vectorization
// ---------------------------------------------------------------------------

#ifndef CHECKIT_LOCATION_CONFIGURED
#define CHECKIT_LOCATION_CONFIGURED 0
#endif

#ifndef CHECKIT_RADAR_LATITUDE
#define CHECKIT_RADAR_LATITUDE 0.0
#endif

#ifndef CHECKIT_RADAR_LONGITUDE
#define CHECKIT_RADAR_LONGITUDE 0.0
#endif

// Radar boresight heading, degrees clockwise from true north.
#ifndef CHECKIT_RADAR_HEADING_DEG
#define CHECKIT_RADAR_HEADING_DEG 0.0f
#endif
