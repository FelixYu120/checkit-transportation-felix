#include <Arduino.h>
#include <WebServer.h>
#include <WiFi.h>
#include <esp_arduino_version.h>
#include <esp_now.h>
#include <esp_sntp.h>
#include <esp_system.h>
#include <esp_wifi.h>
#include <math.h>
#include <time.h>

#include "CheckItConfig.h"
#include "CheckItProtocol.h"
#include "CloudTelemetry.h"
#include "DecisionEngine.h"
#include "FlashRouter.h"
#include "Ld2415hProtocol.h"
#include "Ld2451Protocol.h"
#include "OperatingMode.h"
#include "ProvisioningManager.h"
#include "RadarDashboardPage.h"
#include "ReferenceTelemetry.h"
#include "TargetQuality.h"
#include "TrafficFeatures.h"
#include "TrafficTracker.h"
#include "WarningOutputs.h"

#if __has_include("CheckItSecrets.h")
#include "CheckItSecrets.h"
#else
#define CHECKIT_WIFI_SSID ""
#define CHECKIT_WIFI_PASSWORD ""
#define CHECKIT_SUPABASE_URL ""
#define CHECKIT_SUPABASE_PUBLISHABLE_KEY ""
#define CHECKIT_SENSOR_ID ""
#endif

#ifndef CHECKIT_BLE_SETUP_PIN
#error "Copy include/CheckItSecrets.example.h to include/CheckItSecrets.h and set CHECKIT_BLE_SETUP_PIN before building radar firmware."
#endif
#ifndef CHECKIT_ADMIN_RESET_TOKEN
#error "Set CHECKIT_ADMIN_RESET_TOKEN in include/CheckItSecrets.h before building radar firmware."
#endif
#ifndef CHECKIT_DEVICE_NAME
#define CHECKIT_DEVICE_NAME "Check-It Radar"
#endif
#ifndef CHECKIT_REFERENCE_SENSOR_ID
#define CHECKIT_REFERENCE_SENSOR_ID "radar-001-ld2415h"
#endif
#ifndef CHECKIT_REFERENCE_TEST_RUN_ID
#define CHECKIT_REFERENCE_TEST_RUN_ID ""
#endif

using namespace CheckIt;

namespace {

HardwareSerial radarSerial(2);
#if CHECKIT_ENABLE_REFERENCE_RADAR
// USB diagnostics use native USB CDC. UART0 is therefore available for the
// independent LD2415H reference channel on GPIO10/GPIO12.
HardwareSerial referenceRadarSerial(0);
Ld2415hParser referenceRadarParser;
#endif

Ld2451Parser radarParser(
    CHECKIT_LD2451_ZERO_DIRECTION_IS_APPROACH != 0,
    CHECKIT_LD2451_ANGLE_SIGN);
AlertGate alertGate(
    CHECKIT_REQUIRED_CONSECUTIVE_FRAMES,
    CHECKIT_ALERT_COOLDOWN_MS);

WarningOutputs localOutputs(
    CHECKIT_RADAR_MATRIX_DIN_PIN,
    CHECKIT_RADAR_MATRIX_CS_PIN,
    CHECKIT_RADAR_MATRIX_CLK_PIN,
    CHECKIT_MATRIX_MODULE_COUNT,
    CHECKIT_MATRIX_REVERSE_MODULE_ORDER != 0,
    CHECKIT_RADAR_SPEAKER_PIN,
    CHECKIT_RADAR_STATUS_LED_PIN,
    CHECKIT_ENABLE_RADAR_MATRIX != 0,
    CHECKIT_ENABLE_RADAR_SPEAKER != 0);

DecisionConfig decisionConfig{
    CHECKIT_SPEED_LIMIT_KMH,
    CHECKIT_DANGER_SPEED_KMH,
    CHECKIT_EMERGENCY_SPEED_KMH,
    CHECKIT_MIN_WARNING_DISTANCE_M,
    CHECKIT_MAX_WARNING_DISTANCE_M,
    CHECKIT_MIN_WARNING_SNR,
    CHECKIT_MAX_WARNING_ABS_ANGLE_DEG,
    CHECKIT_WARN_APPROACH != 0,
    CHECKIT_WARN_AWAY != 0};

const FlashRouteConfig flashRouteConfig{
    CHECKIT_REMOTE_FLASH_DISTANCE_M};

const TargetQualityConfig targetQualityConfig{
    CHECKIT_TELEMETRY_MIN_DISTANCE_M,
    CHECKIT_TELEMETRY_MAX_DISTANCE_M,
    CHECKIT_TELEMETRY_MIN_SNR,
    CHECKIT_TELEMETRY_MAX_ABS_ANGLE_DEG,
    CHECKIT_TELEMETRY_MIN_SPEED_KMH,
    CHECKIT_IMPLAUSIBLE_SPEED_KMH,
    CHECKIT_IMPLAUSIBLE_SPEED_MIN_SNR,
    CHECKIT_TARGET_CONFIRMATION_MAX_DISTANCE_DELTA_M,
    CHECKIT_TARGET_CONFIRMATION_MAX_ANGLE_DELTA_DEG,
    CHECKIT_TARGET_CONFIRMATION_MAX_SPEED_DELTA_KMH,
    CHECKIT_TARGET_CONFIRMATION_MAX_FRAME_GAP_MS};
TargetConfirmationFilter targetConfirmationFilter(targetQualityConfig);

const TrafficTrackerConfig trafficTrackerConfig{
    CHECKIT_TRACKER_MAX_ASSOCIATION_GAP_MS,
    CHECKIT_TRACKER_FINALIZE_GAP_MS,
    CHECKIT_TRACKER_PATH_SAMPLE_INTERVAL_MS,
    CHECKIT_TRACKER_MIN_DURATION_MS,
    CHECKIT_TRACKER_MIN_HITS,
    CHECKIT_TRACKER_MIN_TRAVEL_M,
    CHECKIT_TRACKER_MAX_DISTANCE_DELTA_M,
    CHECKIT_TRACKER_MAX_ANGLE_DELTA_DEG,
    CHECKIT_TRACKER_MAX_SPEED_DELTA_KMH,
    CHECKIT_TRACKER_CLUSTER_DISTANCE_M,
    CHECKIT_TRACKER_CLUSTER_ANGLE_DEG,
    CHECKIT_TRACKER_CLUSTER_SPEED_KMH,
    CHECKIT_TRACKER_MIN_ASSOCIATION_CONFIDENCE,
    CHECKIT_TRACKER_MIN_DIRECTION_CONSISTENCY,
    CHECKIT_TRACKER_ACCEPTED_QUALITY_SCORE,
    CHECKIT_TRACKER_REVIEW_QUALITY_SCORE,
    CHECKIT_TRAFFIC_MICROMOBILITY_MIN_SPEED_KMH,
    CHECKIT_TRAFFIC_MOTOR_VEHICLE_MIN_SPEED_KMH,
    CHECKIT_TRAFFIC_CLASS_CONFIDENCE_THRESHOLD};
TrafficTracker trafficTracker(trafficTrackerConfig);

const uint8_t broadcastAddress[] = {
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

QueueHandle_t receiveQueue = nullptr;
uint16_t nextSequence = 0;
uint32_t lastHeartbeatMs = 0;
uint32_t lastMockMs = 0;
uint32_t radarFrameNumber = 0;
uint32_t lastRadarDiagnosticMs = 0;
uint32_t lastValidRadarFrameMs = 0;
uint32_t lastHealthSnapshotMs = 0;
uint32_t trafficBootId = 0;
#if CHECKIT_ENABLE_REFERENCE_RADAR
uint32_t nextReferenceSequence = 1;
uint32_t referenceRadarBytes = 0;
uint32_t lastReferenceDiagnosticMs = 0;
#endif
uint32_t lowSnrTargetsFiltered = 0;
uint32_t slowReturnsExcluded = 0;
uint32_t weakExtremeSpeedReturnsFiltered = 0;
uint32_t targetCapacityFrames = 0;
uint32_t truncatedTargetFrames = 0;
uint8_t maximumReportedTargets = 0;
uint32_t lastPassageStoredEpoch = 0;
volatile uint32_t espNowSendSuccesses = 0;
volatile uint32_t espNowSendFailures = 0;
bool espNowReady = false;
bool internetWiFiWasConnected = false;
bool hasValidRadarFrame = false;
uint32_t lastWiFiReconnectAttemptMs = 0;
uint32_t wifiDisconnectedSinceMs = 0;
uint8_t wifiReconnectFailures = 0;
bool wifiDisconnectTimerActive = false;
volatile bool networkTimeSynchronized = false;

struct PendingRemoteFallback {
  bool active;
  uint16_t sequence;
  RadarTarget target;
  WarningDecision decision;
  uint32_t deadlineMs;
};

PendingRemoteFallback pendingRemoteFallback{};

bool sendMessage(const CheckItMessage &message);

ProvisioningManager provisioningManager;

ProvisioningSettings makeCompiledProvisioningDefaults() {
  ProvisioningSettings defaults{};
  snprintf(defaults.deviceName, sizeof(defaults.deviceName), "%s", CHECKIT_DEVICE_NAME);
  snprintf(defaults.sensorId, sizeof(defaults.sensorId), "%s", CHECKIT_SENSOR_ID);
  snprintf(defaults.wifiSsid, sizeof(defaults.wifiSsid), "%s", CHECKIT_WIFI_SSID);
  snprintf(
      defaults.wifiPassword,
      sizeof(defaults.wifiPassword),
      "%s",
      CHECKIT_WIFI_PASSWORD);
  snprintf(
      defaults.supabaseUrl,
      sizeof(defaults.supabaseUrl),
      "%s",
      CHECKIT_SUPABASE_URL);
  snprintf(
      defaults.supabaseKey,
      sizeof(defaults.supabaseKey),
      "%s",
      CHECKIT_SUPABASE_PUBLISHABLE_KEY);
  snprintf(
      defaults.adminResetToken,
      sizeof(defaults.adminResetToken),
      "%s",
      CHECKIT_ADMIN_RESET_TOKEN);
  defaults.speedLimitKmh = CHECKIT_SPEED_LIMIT_KMH;
  defaults.dangerSpeedKmh = CHECKIT_DANGER_SPEED_KMH;
  defaults.emergencySpeedKmh = CHECKIT_EMERGENCY_SPEED_KMH;
  defaults.latitude = CHECKIT_RADAR_LATITUDE;
  defaults.longitude = CHECKIT_RADAR_LONGITUDE;
  defaults.radarHeadingDeg = CHECKIT_RADAR_HEADING_DEG;
  return defaults;
}

const ProvisioningSettings &runtimeSettings() {
  return provisioningManager.settings();
}

bool roadsideObservationMode() {
  return provisioningManager.operatingMode() ==
      OperatingMode::ROADSIDE_OBSERVATION;
}

bool warningOutputsEnabled() {
  return operatingModeHasWarnings(provisioningManager.operatingMode());
}

bool espNowWarningsEnabled() {
  return operatingModeUsesEspNow(provisioningManager.operatingMode());
}

bool radarWarningsEnabled() {
  return provisioningManager.operatingMode() ==
      OperatingMode::RADAR_WARNING;
}

void applyProvisionedSettings() {
  const ProvisioningSettings &settings = runtimeSettings();
  decisionConfig.speedLimitKmh = settings.speedLimitKmh == 0
      ? CHECKIT_SPEED_LIMIT_KMH
      : settings.speedLimitKmh;
  decisionConfig.dangerSpeedKmh = settings.dangerSpeedKmh == 0
      ? CHECKIT_DANGER_SPEED_KMH
      : settings.dangerSpeedKmh;
  decisionConfig.emergencySpeedKmh = settings.emergencySpeedKmh == 0
      ? CHECKIT_EMERGENCY_SPEED_KMH
      : settings.emergencySpeedKmh;
}

bool isNetworkTimeSynchronized() {
  return networkTimeSynchronized;
}

const CloudTelemetryConfig cloudTelemetryConfig{
    provisioningManager.settings().supabaseUrl,
    provisioningManager.settings().supabaseKey,
    CHECKIT_SUPABASE_TABLE,
    CHECKIT_SUPABASE_PASSAGE_TABLE,
    CHECKIT_SUPABASE_HEALTH_TABLE,
    provisioningManager.settings().sensorId,
    isNetworkTimeSynchronized};
CloudTelemetry cloudTelemetry(cloudTelemetryConfig);

#if CHECKIT_ENABLE_REFERENCE_RADAR
const ReferenceTelemetryConfig referenceTelemetryConfig{
    provisioningManager.settings().supabaseUrl,
    provisioningManager.settings().supabaseKey,
    CHECKIT_REFERENCE_TABLE,
    provisioningManager.settings().sensorId,
    CHECKIT_REFERENCE_SENSOR_ID,
    CHECKIT_REFERENCE_TEST_RUN_ID,
    true};
ReferenceTelemetry referenceTelemetry(referenceTelemetryConfig);
#endif

void onNetworkTimeSynchronized(struct timeval *timeValue) {
  if (timeValue == nullptr) {
    return;
  }
  networkTimeSynchronized = true;
  const time_t synchronizedAt = timeValue->tv_sec;
  struct tm utcTime {};
  char utcTimestamp[25]{};
  gmtime_r(&synchronizedAt, &utcTime);
  strftime(
      utcTimestamp,
      sizeof(utcTimestamp),
      "%Y-%m-%dT%H:%M:%SZ",
      &utcTime);
  Serial.printf("[CLOUD] network UTC synchronized: %s\n", utcTimestamp);
}

void onInternetWiFiEvent(
    WiFiEvent_t event,
    WiFiEventInfo_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
    Serial.printf(
        "[CLOUD] Wi-Fi event connected IP=%s channel=%u RSSI=%d dBm\n",
        WiFi.localIP().toString().c_str(),
        WiFi.channel(),
        WiFi.RSSI());
    return;
  }
  if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    Serial.printf(
        "[CLOUD] Wi-Fi event disconnected reason=%u status=%d\n",
        static_cast<unsigned int>(info.wifi_sta_disconnected.reason),
        static_cast<int>(WiFi.status()));
  }
}

#if CHECKIT_ENABLE_RADAR_WEB
WebServer radarWebServer(CHECKIT_RADAR_WEB_PORT);
Ld2451Frame latestRadarFrame{};
uint32_t latestRadarFrameMs = 0;
bool hasRadarFrame = false;
bool radarAccessPointReady = false;
#endif

struct ReceivedMessage {
  CheckItMessage message;
};

uint16_t allocateSequence() {
  ++nextSequence;
  if (nextSequence == 0) {
    ++nextSequence;
  }
  return nextSequence;
}

void queueReceivedMessage(const uint8_t *data, int length) {
  if (receiveQueue == nullptr ||
      length != static_cast<int>(sizeof(CheckItMessage))) {
    return;
  }
  ReceivedMessage envelope{};
  memcpy(&envelope.message, data, sizeof(envelope.message));
  xQueueSend(receiveQueue, &envelope, 0);
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onEspNowSent(
    const wifi_tx_info_t *,
    esp_now_send_status_t status) {
  if (status == ESP_NOW_SEND_SUCCESS) {
    ++espNowSendSuccesses;
  } else {
    ++espNowSendFailures;
  }
}

void onEspNowReceive(
    const esp_now_recv_info_t *,
    const uint8_t *data,
    int length) {
  queueReceivedMessage(data, length);
}
#else
void onEspNowSent(
    const uint8_t *,
    esp_now_send_status_t status) {
  if (status == ESP_NOW_SEND_SUCCESS) {
    ++espNowSendSuccesses;
  } else {
    ++espNowSendFailures;
  }
}

void onEspNowReceive(
    const uint8_t *,
    const uint8_t *data,
    int length) {
  queueReceivedMessage(data, length);
}
#endif

bool hasConfiguredValue(const char *value) {
  return value != nullptr && value[0] != '\0' &&
      strstr(value, "YOUR_") == nullptr;
}

void resetInternetWiFiRecoveryState() {
  wifiDisconnectedSinceMs = 0;
  wifiReconnectFailures = 0;
  wifiDisconnectTimerActive = false;
}

void trackInternetWiFiDisconnection(uint32_t nowMs) {
  if (!wifiDisconnectTimerActive) {
    wifiDisconnectedSinceMs = nowMs;
    wifiDisconnectTimerActive = true;
  }
}

bool connectInternetWiFi() {
#if !CHECKIT_ENABLE_CLOUD_UPLOAD
  Serial.println("[CLOUD] Wi-Fi upload disabled at compile time");
  return false;
#else
  if (!provisioningManager.provisioned() ||
      !hasConfiguredValue(runtimeSettings().wifiSsid)) {
    Serial.println(
        "[CLOUD] Internet Wi-Fi not configured; local AP remains available");
    return false;
  }

  if (!espNowWarningsEnabled()) {
    Serial.printf(
        "[CLOUD] connecting to 2.4 GHz Wi-Fi '%s'; mode=%s accepts any "
        "channel\n",
        runtimeSettings().wifiSsid,
        operatingModeName(provisioningManager.operatingMode()));
  } else {
    Serial.printf(
        "[CLOUD] connecting to 2.4 GHz Wi-Fi '%s' on channel %u\n",
        runtimeSettings().wifiSsid,
        CHECKIT_ESPNOW_CHANNEL);
  }
  WiFi.begin(
      runtimeSettings().wifiSsid,
      runtimeSettings().wifiPassword);

  const uint32_t startedMs = millis();
  while (WiFi.status() != WL_CONNECTED &&
         static_cast<uint32_t>(millis() - startedMs) <
             CHECKIT_CLOUD_WIFI_STARTUP_TIMEOUT_MS) {
    delay(100);
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf(
        "[CLOUD] Wi-Fi connection failed status=%d; verify the exact SSID, "
        "password, and 2.4 GHz hotspot mode\n",
        static_cast<int>(WiFi.status()));
    return false;
  }

  const uint8_t connectedChannel = WiFi.channel();
  if (espNowWarningsEnabled() &&
      connectedChannel != CHECKIT_ESPNOW_CHANNEL) {
    Serial.printf(
        "[CLOUD] refusing Wi-Fi channel %u because ESP-NOW is configured "
        "for channel %u\n",
        connectedChannel,
        CHECKIT_ESPNOW_CHANNEL);
    WiFi.disconnect(false, false);
    return false;
  }

  Serial.printf(
      "[CLOUD] Internet Wi-Fi connected IP=%s RSSI=%d dBm\n",
      WiFi.localIP().toString().c_str(),
      WiFi.RSSI());
  internetWiFiWasConnected = true;
  resetInternetWiFiRecoveryState();
  configTime(
      0,
      0,
      CHECKIT_NTP_PRIMARY,
      CHECKIT_NTP_SECONDARY);
  return true;
#endif
}

void maintainInternetWiFi(uint32_t nowMs) {
#if CHECKIT_ENABLE_CLOUD_UPLOAD
  if (!provisioningManager.provisioned() ||
      !hasConfiguredValue(runtimeSettings().wifiSsid)) {
    resetInternetWiFiRecoveryState();
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    const uint8_t connectedChannel = WiFi.channel();
    if (espNowWarningsEnabled() &&
        connectedChannel != CHECKIT_ESPNOW_CHANNEL) {
      Serial.printf(
          "[CLOUD] hotspot moved to channel %u; expected channel %u, "
          "disconnecting to protect ESP-NOW\n",
          connectedChannel,
          CHECKIT_ESPNOW_CHANNEL);
      WiFi.disconnect(false, false);
      internetWiFiWasConnected = false;
      trackInternetWiFiDisconnection(nowMs);
      return;
    }
    if (!internetWiFiWasConnected) {
      internetWiFiWasConnected = true;
      Serial.printf(
          "[CLOUD] Internet Wi-Fi reconnected IP=%s channel=%u "
          "RSSI=%d dBm\n",
          WiFi.localIP().toString().c_str(),
          connectedChannel,
          WiFi.RSSI());
      resetInternetWiFiRecoveryState();
      configTime(
          0,
          0,
          CHECKIT_NTP_PRIMARY,
          CHECKIT_NTP_SECONDARY);
    }
    return;
  }

  if (internetWiFiWasConnected) {
    internetWiFiWasConnected = false;
    Serial.printf(
        "[CLOUD] Internet Wi-Fi lost status=%d; summaries remain queued\n",
        static_cast<int>(WiFi.status()));
  }

  trackInternetWiFiDisconnection(nowMs);
  const uint32_t disconnectedDurationMs =
      static_cast<uint32_t>(nowMs - wifiDisconnectedSinceMs);
  if (disconnectedDurationMs >= CHECKIT_CLOUD_WIFI_OFFLINE_RESTART_MS) {
    Serial.printf(
        "[CLOUD] Wi-Fi offline for 15 minutes (%lu ms); restarting device\n",
        static_cast<unsigned long>(disconnectedDurationMs));
    delay(250);
    ESP.restart();
    return;
  }

  if (static_cast<uint32_t>(nowMs - lastWiFiReconnectAttemptMs) <
      CHECKIT_CLOUD_WIFI_RECONNECT_INTERVAL_MS) {
    return;
  }
  lastWiFiReconnectAttemptMs = nowMs;
  ++wifiReconnectFailures;
  Serial.printf(
      "[CLOUD] Wi-Fi reconnect attempt %u to '%s'\n",
      static_cast<unsigned int>(wifiReconnectFailures),
      runtimeSettings().wifiSsid);

  if (wifiReconnectFailures % CHECKIT_CLOUD_WIFI_RADIO_RESET_ATTEMPTS == 0) {
    Serial.printf(
        "[CLOUD] resetting Wi-Fi radio after %u failed reconnect attempts\n",
        static_cast<unsigned int>(wifiReconnectFailures));
    WiFi.disconnect(true, false);
    WiFi.mode(WIFI_OFF);
    delay(500);
#if CHECKIT_ENABLE_RADAR_WEB
    WiFi.mode(WIFI_AP_STA);
#else
    WiFi.mode(WIFI_STA);
#endif
    delay(250);
  }

  WiFi.begin(runtimeSettings().wifiSsid, runtimeSettings().wifiPassword);
#else
  (void)nowMs;
#endif
}

bool setupEspNow() {
  espNowReady = false;
  sntp_set_time_sync_notification_cb(onNetworkTimeSynchronized);
  WiFi.onEvent(onInternetWiFiEvent);
#if CHECKIT_ENABLE_RADAR_WEB
  WiFi.mode(WIFI_AP_STA);
#else
  WiFi.mode(WIFI_STA);
#endif
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.disconnect(false, true);
  delay(100);

  connectInternetWiFi();

#if CHECKIT_ENABLE_RADAR_WEB
  radarAccessPointReady = WiFi.softAP(
      CHECKIT_RADAR_AP_SSID,
      CHECKIT_RADAR_AP_PASSWORD,
      CHECKIT_ESPNOW_CHANNEL);
  if (radarAccessPointReady) {
    const IPAddress address = WiFi.softAPIP();
    Serial.printf(
        "[WEB] Wi-Fi: %s password: %s\n",
        CHECKIT_RADAR_AP_SSID,
        CHECKIT_RADAR_AP_PASSWORD);
    Serial.printf("[WEB] dashboard: http://%s/\n", address.toString().c_str());
  } else {
    Serial.println("[WEB] failed to start radar access point");
  }
#endif

  if (!espNowWarningsEnabled()) {
    if (roadsideObservationMode()) {
      Serial.printf(
          "[MODE] roadside observation; warning outputs and ESP-NOW "
          "disabled, cloud Wi-Fi channel %u accepted\n",
          WiFi.channel());
    } else {
      Serial.printf(
          "[MODE] radar warning; local output enabled, ESP-NOW disabled, "
          "cloud Wi-Fi channel %u accepted\n",
          WiFi.channel());
    }
    return true;
  }

  uint8_t activeChannel = 0;
  wifi_second_chan_t secondaryChannel = WIFI_SECOND_CHAN_NONE;
  if (esp_wifi_get_channel(&activeChannel, &secondaryChannel) != ESP_OK) {
    Serial.println("[ESPNOW] failed to read active radio channel");
    return false;
  }
  if (activeChannel != CHECKIT_ESPNOW_CHANNEL) {
    Serial.printf(
        "[ESPNOW] active radio channel %u does not match configured channel "
        "%u\n",
        activeChannel,
        CHECKIT_ESPNOW_CHANNEL);
    return false;
  }

  Serial.print("[WIFI] MAC: ");
  Serial.println(WiFi.macAddress());
  Serial.printf("[ESPNOW] channel: %u\n", CHECKIT_ESPNOW_CHANNEL);

  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESPNOW] initialization failed");
    return false;
  }

  esp_now_register_send_cb(onEspNowSent);
  esp_now_register_recv_cb(onEspNowReceive);

  esp_now_peer_info_t peer{};
  memcpy(peer.peer_addr, broadcastAddress, sizeof(broadcastAddress));
  peer.channel = CHECKIT_ESPNOW_CHANNEL;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;

  if (esp_now_add_peer(&peer) != ESP_OK) {
    Serial.println("[ESPNOW] failed to add broadcast peer");
    return false;
  }

  espNowReady = true;
  Serial.println("[ESPNOW] ready");
  return true;
}

#if CHECKIT_ENABLE_RADAR_WEB
void appendJsonStringValue(String &json, const char *value) {
  json += '"';
  if (value != nullptr) {
    for (const char *cursor = value; *cursor != '\0'; ++cursor) {
      if (*cursor == '"' || *cursor == '\\') {
        json += '\\';
      }
      if (static_cast<uint8_t>(*cursor) >= 0x20) {
        json += *cursor;
      }
    }
  }
  json += '"';
}

void appendTargetJson(String &json, const RadarTarget &target) {
  json += F("{\"index\":");
  json += static_cast<unsigned int>(target.targetIndex);
  json += F(",\"angle_deg\":");
  json += static_cast<int>(target.angleDeg);
  json += F(",\"distance_m\":");
  json += static_cast<unsigned int>(target.distanceM);
  json += F(",\"direction\":\"");
  json += directionName(target.direction);
  json += F("\",\"speed_kmh\":");
  json += static_cast<unsigned int>(target.speedKmh);
  json += F(",\"snr\":");
  json += static_cast<unsigned int>(target.snr);
  json += '}';
}

void sendRadarStatusJson() {
  const uint32_t nowMs = millis();
  const uint32_t frameAgeMs =
      hasRadarFrame ? static_cast<uint32_t>(nowMs - latestRadarFrameMs) : 0;
  const bool radarActive =
      hasRadarFrame && frameAgeMs <= CHECKIT_RADAR_ACTIVE_TIMEOUT_MS;
  const Ld2451ParserStats &stats = radarParser.stats();

  String json;
  json.reserve(4600);
  json += F("{\"firmware_version\":\"");
  json += CHECKIT_FIRMWARE_VERSION;
  json += F("\",\"operating_mode\":\"");
  json += operatingModeName(provisioningManager.operatingMode());
  json += F("\",\"device_name\":");
  appendJsonStringValue(json, runtimeSettings().deviceName);
  json += F(",\"node_id\":");
  json += CHECKIT_RADAR_NODE_ID;
  json += F(",\"uptime_ms\":");
  json += nowMs;
  json += F(",\"radar_active\":");
  json += radarActive ? F("true") : F("false");
  json += F(",\"has_frame\":");
  json += hasRadarFrame ? F("true") : F("false");
  json += F(",\"last_frame_age_ms\":");
  json += frameAgeMs;
  json += F(",\"frame_count\":");
  json += radarFrameNumber;
  json += F(",\"alarm\":");
  json += hasRadarFrame && latestRadarFrame.alarm ? F("true") : F("false");
  json += F(",\"reported_target_count\":");
  json += hasRadarFrame ? latestRadarFrame.reportedTargetCount : 0;
  json += F(",\"target_count\":");
  json += hasRadarFrame ? latestRadarFrame.targetCount : 0;
  json += F(",\"frame_truncated\":");
  json += hasRadarFrame && latestRadarFrame.truncated ? F("true") : F("false");
  json += F(",\"local_warning_active\":");
  json += localOutputs.active(nowMs) ? F("true") : F("false");
  json += F(",\"ap_ssid\":\"");
  json += CHECKIT_RADAR_AP_SSID;
  json += F("\",\"ap_ip\":\"");
  json += WiFi.softAPIP().toString();
  json += F("\",\"connected_clients\":");
  json += static_cast<unsigned int>(WiFi.softAPgetStationNum());
  json += F(",\"radio_channel\":");
  json += static_cast<unsigned int>(CHECKIT_ESPNOW_CHANNEL);
  json += F(",\"provisioning\":{\"provisioned\":");
  json += provisioningManager.provisioned() ? F("true") : F("false");
  json += F(",\"ble_active\":");
  json += provisioningManager.bleActive() ? F("true") : F("false");
  json += F(",\"restart_pending\":");
  json += provisioningManager.state().restartPending
      ? F("true")
      : F("false");
  json += F(",\"speed_limit_kmh\":");
  json += decisionConfig.speedLimitKmh;
  json += F(",\"danger_speed_kmh\":");
  json += decisionConfig.dangerSpeedKmh;
  json += F(",\"emergency_speed_kmh\":");
  json += decisionConfig.emergencySpeedKmh;
  json += F("}");
  json += F(",\"internet_wifi_connected\":");
  json += WiFi.status() == WL_CONNECTED ? F("true") : F("false");
  json += F(",\"internet_ip\":\"");
  json += WiFi.status() == WL_CONNECTED
      ? WiFi.localIP().toString()
      : String(F("0.0.0.0"));
  json += F("\"");

  const CloudTelemetryStats cloudStats = cloudTelemetry.stats();
  const TrafficTrackerStats &trackerStats = trafficTracker.stats();
  json += F(",\"cloud\":{\"enabled\":");
  json += cloudTelemetry.enabled() ? F("true") : F("false");
  json += F(",\"queue_depth\":");
  json += static_cast<unsigned int>(cloudTelemetry.queueDepth());
  json += F(",\"enqueued_passages\":");
  json += cloudStats.enqueuedPassages;
  json += F(",\"dropped_passages\":");
  json += cloudStats.droppedPassages;
  json += F(",\"uploaded_passages\":");
  json += cloudStats.uploadedPassages;
  json += F(",\"uploaded_summaries\":");
  json += cloudStats.uploadedSummaries;
  json += F(",\"dropped_summaries\":");
  json += cloudStats.droppedSummaries;
  json += F(",\"pending_passages\":");
  json += cloudStats.pendingPassages;
  json += F(",\"pending_summaries\":");
  json += cloudStats.pendingSummaries;
  json += F(",\"storage_ready\":");
  json += cloudStats.storageReady ? F("true") : F("false");
  json += F(",\"storage_used_bytes\":");
  json += cloudStats.storageUsedBytes;
  json += F(",\"storage_free_bytes\":");
  json += cloudStats.storageFreeBytes;
  json += F(",\"corrupt_passages\":");
  json += cloudStats.corruptPassages;
  json += F(",\"persist_failures\":");
  json += cloudStats.persistFailures;
  json += F(",\"uploaded_health_reports\":");
  json += cloudStats.uploadedHealthReports;
  json += F(",\"health_upload_failures\":");
  json += cloudStats.healthUploadFailures;
  json += F(",\"last_health_success_age_ms\":");
  json += cloudStats.lastHealthSuccessMs == 0
      ? 0
      : static_cast<uint32_t>(nowMs - cloudStats.lastHealthSuccessMs);
  json += F(",\"upload_attempts\":");
  json += cloudStats.uploadAttempts;
  json += F(",\"upload_failures\":");
  json += cloudStats.uploadFailures;
  json += F(",\"upload_cycles\":");
  json += cloudStats.uploadCycles;
  json += F(",\"manual_upload_requests\":");
  json += cloudStats.manualUploadRequests;
  json += F(",\"retry_attempts\":");
  json += static_cast<unsigned int>(cloudStats.retryAttempts);
  json += F(",\"retry_pending\":");
  json += cloudStats.retryPending ? F("true") : F("false");
  json += F(",\"next_automatic_upload_ms\":");
  json += cloudStats.nextAutomaticUploadMs;
  json += F(",\"last_http_status\":");
  json += cloudStats.lastHttpStatus;
  json += F(",\"last_success_age_ms\":");
  json += cloudStats.lastSuccessMs == 0
      ? 0
      : static_cast<uint32_t>(nowMs - cloudStats.lastSuccessMs);
  json += F("}");
  json += F(",\"tracking\":{\"active\":");
  json += static_cast<unsigned int>(trackerStats.activeTracks);
  json += F(",\"completed\":");
  json += trackerStats.tracksCompleted;
  json += F(",\"accepted\":");
  json += trackerStats.acceptedTracks;
  json += F(",\"review\":");
  json += trackerStats.reviewTracks;
  json += F(",\"rejected\":");
  json += trackerStats.rejectedTracks;
  json += F(",\"motor_vehicle\":");
  json += trackerStats.motorVehicleTracks;
  json += F(",\"micromobility\":");
  json += trackerStats.micromobilityTracks;
  json += F(",\"unknown\":");
  json += trackerStats.unknownTracks;
  json += F(",\"dropped_completed\":");
  json += trackerStats.droppedCompletedTracks;
  json += F(",\"low_snr_filtered\":");
  json += lowSnrTargetsFiltered;
  json += F(",\"slow_returns_excluded\":");
  json += slowReturnsExcluded;
  json += F(",\"weak_extreme_speed_filtered\":");
  json += weakExtremeSpeedReturnsFiltered;
  json += F(",\"target_capacity_frames\":");
  json += targetCapacityFrames;
  json += F(",\"truncated_target_frames\":");
  json += truncatedTargetFrames;
  json += F(",\"maximum_reported_targets\":");
  json += static_cast<unsigned int>(maximumReportedTargets);
  json += F("}");
  json += F(",\"parser\":{\"bytes_seen\":");
  json += stats.bytesSeen;
  json += F(",\"valid_frames\":");
  json += stats.validFrames;
  json += F(",\"empty_frames\":");
  json += stats.emptyFrames;
  json += F(",\"invalid_lengths\":");
  json += stats.invalidLengths;
  json += F(",\"invalid_payloads\":");
  json += stats.invalidPayloads;
  json += F(",\"invalid_trailers\":");
  json += stats.invalidTrailers;
  json += F("},\"targets\":[");

  if (hasRadarFrame) {
    for (uint8_t i = 0; i < latestRadarFrame.targetCount; ++i) {
      if (i > 0) {
        json += ',';
      }
      appendTargetJson(json, latestRadarFrame.targets[i]);
    }
  }
  json += F("]}");

  radarWebServer.sendHeader("Cache-Control", "no-store");
  radarWebServer.send(200, "application/json", json);
}

void startRadarOutputTest() {
  if (!warningOutputsEnabled()) {
    radarWebServer.send(
        409,
        "application/json",
        "{\"ok\":false,\"message\":\"warning outputs are disabled in roadside observation mode\"}");
    return;
  }
  const uint32_t nowMs = millis();
  localOutputs.start(
      CHECKIT_OUTPUT_TEST_SPEED_KMH,
      DIR_APPROACH,
      WARN_INFO,
      CHECKIT_OUTPUT_TEST_DURATION_MS,
      nowMs);
  Serial.println("[OUTPUT] local matrix flash test started");
  radarWebServer.send(
      200,
      "application/json",
      "{\"ok\":true,\"message\":\"local matrix flash test started\"}");
}

void startRemoteOutputTest() {
  if (!espNowWarningsEnabled()) {
    radarWebServer.send(
        409,
        "application/json",
        "{\"ok\":false,\"message\":\"remote output is disabled in this operating mode\"}");
    return;
  }
  const uint32_t nowMs = millis();
  const uint16_t sequence = allocateSequence();
  const RadarTarget testTarget{
      0,
      0,
      CHECKIT_REMOTE_FLASH_DISTANCE_M,
      DIR_APPROACH,
      CHECKIT_OUTPUT_TEST_SPEED_KMH,
      255};
  const CheckItMessage message = makeMessage(
      MSG_ALERT,
      sequence,
      CHECKIT_RADAR_NODE_ID,
      CHECKIT_TARGET_FLASH_NODE_ID,
      nowMs,
      &testTarget,
      WARN_INFO,
      CHECKIT_OUTPUT_TEST_DURATION_MS,
      FLAG_REMOTE_OUTPUT);

  if (!sendMessage(message)) {
    Serial.println("[OUTPUT] remote flashing-node test could not be queued");
    radarWebServer.send(
        503,
        "application/json",
        "{\"ok\":false,\"message\":\"ESP-NOW is not ready\"}");
    return;
  }

  Serial.printf(
      "[OUTPUT] remote flashing-node test sent sequence=%u node=%u\n",
      sequence,
      CHECKIT_TARGET_FLASH_NODE_ID);
  radarWebServer.send(
      202,
      "application/json",
      "{\"ok\":true,\"message\":\"remote flashing-node test sent\"}");
}

void requestCloudUpload() {
  const bool primaryRequested = cloudTelemetry.requestUploadNow();
#if CHECKIT_ENABLE_REFERENCE_RADAR
  const bool referenceRequested = referenceTelemetry.requestUploadNow();
#else
  const bool referenceRequested = true;
#endif
  if (!primaryRequested || !referenceRequested) {
    radarWebServer.send(
        409,
        "application/json",
        "{\"ok\":false,\"message\":\"one or more cloud uploaders are not configured\"}");
    return;
  }
  Serial.println(
      "[CLOUD] manual primary and LD2415H upload requested from dashboard");
  radarWebServer.send(
      202,
      "application/json",
      "{\"ok\":true,\"message\":\"upload cycle requested\"}");
}

void requestProvisioningReset() {
  String token = radarWebServer.header("X-CheckIt-Admin-Token");
  if (token.length() == 0 && radarWebServer.hasArg("token")) {
    token = radarWebServer.arg("token");
  }
  if (!provisioningManager.adminTokenMatches(token)) {
    Serial.println("[SETUP] rejected unauthorized provisioning reset");
    radarWebServer.send(
        403,
        "application/json",
        "{\"ok\":false,\"message\":\"invalid administrative token\"}");
    return;
  }
  if (!provisioningManager.requestSetupReset(millis())) {
    radarWebServer.send(
        500,
        "application/json",
        "{\"ok\":false,\"message\":\"could not schedule setup reset\"}");
    return;
  }
  radarWebServer.send(
      202,
      "application/json",
      "{\"ok\":true,\"message\":\"restarting into BLE setup mode\"}");
}

void setupRadarWeb() {
  if (!radarAccessPointReady) {
    return;
  }

  const char *collectedHeaders[] = {"X-CheckIt-Admin-Token"};
  radarWebServer.collectHeaders(collectedHeaders, 1);
  radarWebServer.on("/", HTTP_GET, []() {
    radarWebServer.sendHeader("Cache-Control", "no-store");
    radarWebServer.send_P(200, "text/html", kRadarDashboardHtml);
  });
  radarWebServer.on("/api/status", HTTP_GET, sendRadarStatusJson);
  radarWebServer.on("/api/test-output", HTTP_POST, startRadarOutputTest);
  radarWebServer.on(
      "/api/test-remote-output",
      HTTP_POST,
      startRemoteOutputTest);
  radarWebServer.on("/api/upload-now", HTTP_POST, requestCloudUpload);
  radarWebServer.on(
      "/api/admin/reset-provisioning",
      HTTP_POST,
      requestProvisioningReset);
  radarWebServer.on("/health", HTTP_GET, []() {
    radarWebServer.send(200, "text/plain", "ok\n");
  });
  radarWebServer.onNotFound([]() {
    radarWebServer.send(404, "application/json", "{\"error\":\"not found\"}");
  });
  radarWebServer.begin();
  Serial.println("[WEB] HTTP server ready");
}

void updateRadarWeb() {
  if (radarAccessPointReady) {
    radarWebServer.handleClient();
  }
}
#else
void setupRadarWeb() {}
void updateRadarWeb() {}
#endif

bool sendMessage(const CheckItMessage &message) {
  if (!espNowWarningsEnabled() || !espNowReady) {
    return false;
  }
  const esp_err_t result = esp_now_send(
      broadcastAddress,
      reinterpret_cast<const uint8_t *>(&message),
      sizeof(message));
  if (result != ESP_OK) {
    Serial.printf("[ESPNOW] enqueue failed: %d\n", result);
    return false;
  }
  return true;
}

void processReceivedMessages() {
  if (receiveQueue == nullptr) {
    return;
  }

  ReceivedMessage envelope{};
  while (xQueueReceive(receiveQueue, &envelope, 0) == pdTRUE) {
    const CheckItMessage &message = envelope.message;
    if (!isValidMessage(message) ||
        message.targetNodeId != CHECKIT_RADAR_NODE_ID ||
        message.sourceNodeId != CHECKIT_TARGET_FLASH_NODE_ID ||
        message.type != MSG_ACK) {
      continue;
    }
    Serial.printf(
        "[ESPNOW] ACK source=%u sequence=%u\n",
        message.sourceNodeId,
        message.relatedSequence);
    if (pendingRemoteFallback.active &&
        message.relatedSequence == pendingRemoteFallback.sequence) {
      pendingRemoteFallback.active = false;
    }
  }
}

void maintainRemoteAlertFallback(uint32_t nowMs) {
  if (!pendingRemoteFallback.active ||
      static_cast<int32_t>(nowMs - pendingRemoteFallback.deadlineMs) < 0) {
    return;
  }
  pendingRemoteFallback.active = false;
  localOutputs.start(
      pendingRemoteFallback.target.speedKmh,
      pendingRemoteFallback.target.direction,
      pendingRemoteFallback.decision.level,
      pendingRemoteFallback.decision.durationMs,
      nowMs);
  Serial.printf(
      "[ROUTE] no remote ACK for sequence=%u; local output used as fallback\n",
      pendingRemoteFallback.sequence);
}

bool waitForRadarAck(
    uint16_t command,
    uint32_t timeoutMs,
    Ld2451Ack *result = nullptr) {
  Ld2451AckParser parser;
  const uint32_t startedMs = millis();
  while (static_cast<uint32_t>(millis() - startedMs) < timeoutMs) {
    while (radarSerial.available() > 0) {
      Ld2451Ack ack{};
      const Ld2451ParseResult parseResult =
          parser.push(static_cast<uint8_t>(radarSerial.read()), ack);
      if (parseResult != LD2451_FRAME_READY) {
        continue;
      }

      const uint16_t expectedAckCommand =
          static_cast<uint16_t>(command | 0x0100);
      if (ack.command != expectedAckCommand) {
        continue;
      }
      if (result != nullptr) {
        *result = ack;
      }
      return ack.status == 0;
    }
    delay(1);
  }
  return false;
}

bool runRadarCommand(const Ld2451CommandFrame &command) {
  if (command.length == 0) {
    return false;
  }
  for (uint8_t attempt = 1;
       attempt <= CHECKIT_RADAR_COMMAND_ATTEMPTS;
       ++attempt) {
    while (radarSerial.available() > 0) {
      radarSerial.read();
    }
    radarSerial.write(command.bytes, command.length);
    radarSerial.flush();
    const bool success = waitForRadarAck(
        command.command,
        CHECKIT_RADAR_COMMAND_TIMEOUT_MS);
    Serial.printf(
        "[RADAR CONFIG] command=0x%04X attempt=%u/%u %s\n",
        command.command,
        attempt,
        CHECKIT_RADAR_COMMAND_ATTEMPTS,
        success ? "ok" : "failed");
    if (success) {
      return true;
    }
    delay(50);
  }
  return false;
}

bool configureRadar() {
#if !CHECKIT_CONFIGURE_RADAR_ON_BOOT
  Serial.println("[RADAR CONFIG] startup configuration disabled");
  return true;
#else
  while (radarSerial.available() > 0) {
    radarSerial.read();
  }

  if (!runRadarCommand(Ld2451Commands::enableConfiguration())) {
    return false;
  }

  bool success = runRadarCommand(Ld2451Commands::setTargetParameters(
      CHECKIT_RADAR_MAX_DISTANCE_M,
      static_cast<Ld2451DirectionFilter>(CHECKIT_RADAR_DIRECTION_BOTH),
      CHECKIT_RADAR_MIN_SPEED_KMH,
      CHECKIT_RADAR_NO_TARGET_DELAY_SEC));

  success = runRadarCommand(Ld2451Commands::setSensitivity(
                CHECKIT_RADAR_TRIGGER_COUNT,
                CHECKIT_RADAR_SNR_THRESHOLD_LEVEL)) &&
      success;

  success = runRadarCommand(Ld2451Commands::endConfiguration()) &&
      success;
  return success;
#endif
}

void logTargetJson(
    const Ld2451Frame &frame,
    const RadarTarget &target,
    uint32_t nowMs) {
  const ProvisioningSettings &settings = runtimeSettings();
  const bool locationConfigured =
      settings.latitude != 0.0 || settings.longitude != 0.0;
  const float targetBearingDeg =
      settings.radarHeadingDeg + static_cast<float>(target.angleDeg);
  const float targetBearingRad = targetBearingDeg * PI / 180.0f;

  Serial.printf(
      "{\"type\":\"radar_target\",\"node_id\":%u,"
      "\"uptime_ms\":%lu,\"frame\":%lu,\"alarm\":%s,"
      "\"reported_target_count\":%u,\"parsed_target_count\":%u,"
      "\"frame_truncated\":%s,"
      "\"target_index\":%u,\"angle_deg\":%d,\"distance_m\":%u,"
      "\"direction\":\"%s\",\"speed_kmh\":%u,\"snr\":%u,"
      "\"firmware_version\":\"%s\","
      "\"direction_zero_means_approach\":%s,"
      "\"angle_sign\":%d,"
      "\"location_configured\":%s,\"latitude\":%.7f,"
      "\"longitude\":%.7f,\"radar_heading_deg\":%.2f,",
      CHECKIT_RADAR_NODE_ID,
      static_cast<unsigned long>(nowMs),
      static_cast<unsigned long>(radarFrameNumber),
      frame.alarm ? "true" : "false",
      frame.reportedTargetCount,
      frame.targetCount,
      frame.truncated ? "true" : "false",
      target.targetIndex,
      static_cast<int>(target.angleDeg),
      target.distanceM,
      directionName(target.direction),
      target.speedKmh,
      target.snr,
      CHECKIT_FIRMWARE_VERSION,
      CHECKIT_LD2451_ZERO_DIRECTION_IS_APPROACH ? "true" : "false",
      CHECKIT_LD2451_ANGLE_SIGN,
      locationConfigured ? "true" : "false",
      settings.latitude,
      settings.longitude,
      static_cast<double>(settings.radarHeadingDeg));

  if (target.direction == DIR_UNKNOWN) {
    Serial.println(
        "\"radial_east_mps\":null,\"radial_north_mps\":null}");
    return;
  }

  const float directionSign =
      target.direction == DIR_APPROACH ? -1.0f : 1.0f;
  const float signedRadialMps =
      directionSign * static_cast<float>(target.speedKmh) / 3.6f;
  const float eastMps = signedRadialMps * sinf(targetBearingRad);
  const float northMps = signedRadialMps * cosf(targetBearingRad);
  Serial.printf(
      "\"radial_east_mps\":%.3f,\"radial_north_mps\":%.3f}\n",
      static_cast<double>(eastMps),
      static_cast<double>(northMps));
}

uint32_t currentEpoch() {
  const time_t observedAt = time(nullptr);
  if (observedAt < 0 ||
      static_cast<uint32_t>(observedAt) < CHECKIT_MIN_VALID_UNIX_TIME) {
    return 0;
  }
  return static_cast<uint32_t>(observedAt);
}

#if CHECKIT_ENABLE_REFERENCE_RADAR
void sendReferenceRadarCommand(
    const uint8_t *command,
    size_t length,
    const char *label) {
  referenceRadarSerial.write(command, length);
  referenceRadarSerial.flush();
  Serial.printf("[LD2415H CONFIG] sent %s\n", label);
  delay(100);
}

void configureReferenceRadar() {
#if CHECKIT_REFERENCE_CONFIGURE_ON_BOOT
  uint8_t command[kLd2415hCommandBytes]{};
  if (buildLd2415hMeasurementConfig(
          CHECKIT_REFERENCE_MIN_SPEED_KMH,
          CHECKIT_REFERENCE_ANGLE_COMPENSATION_DEG,
          CHECKIT_REFERENCE_SENSITIVITY,
          command)) {
    sendReferenceRadarCommand(
        command,
        sizeof(command),
        "speed/angle/sensitivity");
  }
  if (buildLd2415hOutputConfig(
          LD2415H_DETECT_BOTH,
          CHECKIT_REFERENCE_SAMPLE_RATE_DIVISOR,
          LD2415H_KMH,
          command)) {
    sendReferenceRadarCommand(
        command,
        sizeof(command),
        "both-directions/kmh/output-rate");
  }
  if (buildLd2415hAntiVibrationConfig(
          CHECKIT_REFERENCE_ANTI_VIBRATION,
          command)) {
    sendReferenceRadarCommand(command, sizeof(command), "anti-vibration");
  }
#else
  Serial.println("[LD2415H CONFIG] startup configuration disabled");
#endif
}
#endif

void updateCloudHealth(uint32_t nowMs) {
  if (static_cast<uint32_t>(nowMs - lastHealthSnapshotMs) <
      CHECKIT_HEALTH_SNAPSHOT_INTERVAL_MS) {
    return;
  }
  lastHealthSnapshotMs = nowMs;

  const Ld2451ParserStats &parserStats = radarParser.stats();
  const uint32_t frameErrors = parserStats.invalidLengths +
      parserStats.invalidPayloads + parserStats.invalidTrailers;
  const uint32_t frameAgeMs = hasValidRadarFrame
      ? static_cast<uint32_t>(nowMs - lastValidRadarFrameMs)
      : UINT32_MAX;

  CloudHealthSnapshot snapshot{};
  snprintf(
      snapshot.deviceName,
      sizeof(snapshot.deviceName),
      "%s",
      runtimeSettings().deviceName);
  snapshot.bootId = trafficBootId;
  snapshot.uptimeMs = nowMs;
  snapshot.radarFrameCount = radarFrameNumber;
  snapshot.radarFrameErrors = frameErrors;
  snapshot.lowSnrReturnsFiltered = lowSnrTargetsFiltered;
  snapshot.slowReturnsExcluded = slowReturnsExcluded;
  snapshot.weakExtremeSpeedReturnsFiltered =
      weakExtremeSpeedReturnsFiltered;
  snapshot.targetCapacityFrames = targetCapacityFrames;
  snapshot.truncatedTargetFrames = truncatedTargetFrames;
  snapshot.lastRadarFrameAgeMs = frameAgeMs;
  snapshot.lastPassageEpoch = lastPassageStoredEpoch;
  snapshot.wifiRssiDbm = WiFi.status() == WL_CONNECTED
      ? static_cast<int16_t>(WiFi.RSSI())
      : 0;
  snapshot.speedLimitKmh = decisionConfig.speedLimitKmh;
  snapshot.maximumReportedTargets = maximumReportedTargets;
  snapshot.resetReason = static_cast<uint8_t>(esp_reset_reason());
  snapshot.radarActive = hasValidRadarFrame &&
      frameAgeMs <= CHECKIT_RADAR_ACTIVE_TIMEOUT_MS;
  snapshot.provisioned = provisioningManager.provisioned();
  snapshot.bleActive = provisioningManager.bleActive();
  cloudTelemetry.updateHealth(snapshot);
}

void logTrafficPassage(const TrafficPassage &passage) {
  const TrafficPathFeatures features = extractTrafficPathFeatures(
      passage,
      CHECKIT_TRAFFIC_LARGE_SAMPLE_GAP_MS);
  Serial.printf(
      "{\"type\":\"traffic_passage\",\"boot_id\":%lu,"
      "\"track_id\":%lu,\"quality_status\":\"%s\","
      "\"quality_score\":%u,\"class\":\"%s\","
      "\"class_confidence\":%u,\"direction\":\"%s\","
      "\"hits\":%u,\"duration_ms\":%lu,"
      "\"association_confidence\":%u,"
      "\"direction_consistency\":%u,\"travel_distance_m\":%.2f,"
      "\"median_speed_kmh\":%u,\"p85_speed_kmh\":%u,"
      "\"max_speed_kmh\":%u,\"mean_snr\":%u,"
      "\"peak_cluster_size\":%u,\"path_points\":%u,"
      "\"feature_version\":\"%s\",\"path_length_m\":%.2f,"
      "\"displacement_m\":%.2f,\"straightness\":%.3f,"
      "\"lateral_span_m\":%.2f,\"forward_span_m\":%.2f,"
      "\"mean_vx_mps\":%.3f,\"mean_vy_mps\":%.3f,"
      "\"mean_acceleration_mps2\":%.3f,"
      "\"max_acceleration_mps2\":%.3f,"
      "\"speed_stddev_kmh\":%.3f,\"snr_stddev\":%.3f,"
      "\"min_snr\":%u,\"max_sample_gap_ms\":%u,"
      "\"large_gap_count\":%u}\n",
      static_cast<unsigned long>(trafficBootId),
      static_cast<unsigned long>(passage.trackId),
      trackQualityName(passage.qualityStatus),
      passage.qualityScore,
      trafficClassName(passage.trafficClass),
      passage.classConfidence,
      directionName(passage.direction),
      passage.hitCount,
      static_cast<unsigned long>(passage.durationMs),
      passage.associationConfidence,
      passage.directionConsistency,
      static_cast<double>(passage.travelDistanceM),
      passage.medianSpeedKmh,
      passage.p85SpeedKmh,
      passage.maxSpeedKmh,
      passage.meanSnr,
      passage.peakClusterSize,
      passage.pathPointCount,
      CHECKIT_TRAFFIC_FEATURE_VERSION,
      static_cast<double>(features.pathLengthM),
      static_cast<double>(features.displacementM),
      static_cast<double>(features.straightness),
      static_cast<double>(features.lateralSpanM),
      static_cast<double>(features.forwardSpanM),
      static_cast<double>(features.meanVxMps),
      static_cast<double>(features.meanVyMps),
      static_cast<double>(features.meanAccelerationMps2),
      static_cast<double>(features.maxAccelerationMps2),
      static_cast<double>(features.speedStdDevKmh),
      static_cast<double>(features.snrStdDev),
      features.minSnr,
      features.maxSampleGapMs,
      features.largeGapCount);
}

void drainCompletedTrafficPassages() {
  TrafficPassage passage{};
  while (trafficTracker.peekCompleted(passage)) {
    if (!cloudTelemetry.storageReady()) {
      // Do not pop the completed track. It will be retried on the next loop,
      // rather than disappearing merely because storage failed to mount.
      return;
    }
    const CloudPassage cloudPassage{trafficBootId, passage};
    if (!cloudTelemetry.enqueue(cloudPassage)) {
      Serial.printf(
          "[STORAGE] retaining traffic track %lu in RAM for retry\n",
          static_cast<unsigned long>(passage.trackId));
      return;
    }
    logTrafficPassage(passage);
    if (passage.endedEpoch >= CHECKIT_MIN_VALID_UNIX_TIME) {
      lastPassageStoredEpoch = passage.endedEpoch;
    }
    trafficTracker.discardCompleted();
  }
}

void emitAlert(
    const RadarTarget &target,
    const WarningDecision &decision,
    bool radarAlarm,
    uint32_t nowMs) {
  const OperatingMode mode = provisioningManager.operatingMode();
  if (!operatingModeHasWarnings(mode)) {
    return;
  }

  bool flashLocal = mode == OperatingMode::RADAR_WARNING;
  bool flashRemote = mode == OperatingMode::FLASHING_WARNING;
  FlashDestination destination = flashLocal
      ? FLASH_DESTINATION_LOCAL
      : FLASH_DESTINATION_REMOTE;
  if (mode == OperatingMode::LEGACY_DISTANCE_ROUTED_WARNING) {
    const FlashRoute legacyRoute =
        routeFlashByDistance(target.distanceM, flashRouteConfig);
    flashLocal = legacyRoute.flashLocal;
    flashRemote = legacyRoute.flashRemote;
    destination = legacyRoute.destination;
  }

  const uint16_t sequence = allocateSequence();
  uint8_t flags = FLAG_NONE;
  if (flashLocal) {
    flags |= FLAG_LOCAL_OUTPUT;
  }
  if (flashRemote) {
    flags |= FLAG_REMOTE_OUTPUT;
  }
  if (radarAlarm) {
    flags |= FLAG_RADAR_ALARM;
  }

  if (flashLocal) {
    localOutputs.start(
        target.speedKmh,
        target.direction,
        decision.level,
        decision.durationMs,
        nowMs);
  }

  bool remoteQueued = true;
  bool localFallbackUsed = false;
  if (flashRemote) {
    const CheckItMessage message = makeMessage(
        MSG_ALERT,
        sequence,
        CHECKIT_RADAR_NODE_ID,
        CHECKIT_TARGET_FLASH_NODE_ID,
        nowMs,
        &target,
        decision.level,
        decision.durationMs,
        flags);
    remoteQueued = sendMessage(message);
    if (remoteQueued) {
      pendingRemoteFallback.active = true;
      pendingRemoteFallback.sequence = sequence;
      pendingRemoteFallback.target = target;
      pendingRemoteFallback.decision = decision;
      pendingRemoteFallback.deadlineMs =
          nowMs + CHECKIT_ESPNOW_ALERT_ACK_TIMEOUT_MS;
    } else {
      // A radio initialization/enqueue failure must not leave the site with no
      // warning at all. Use the local output as an immediate fallback.
      localOutputs.start(
          target.speedKmh,
          target.direction,
          decision.level,
          decision.durationMs,
          nowMs);
      localFallbackUsed = true;
      Serial.println(
          "[ROUTE] remote alert unavailable; local output used as fallback");
    }
  }

  Serial.printf(
      "[ALERT] sequence=%u target=%u speed=%u distance=%u "
      "direction=%s level=%u duration=%u output=%s remote_queued=%s "
      "local_fallback=%s\n",
      sequence,
      target.targetIndex,
      target.speedKmh,
      target.distanceM,
      directionName(target.direction),
      static_cast<unsigned>(decision.level),
      decision.durationMs,
      flashDestinationName(destination),
      flashRemote ? (remoteQueued ? "yes" : "no") : "n/a",
      localFallbackUsed ? "yes" : "no");
}

void handleRadarFrame(const Ld2451Frame &frame, uint32_t nowMs) {
  ++radarFrameNumber;
  hasValidRadarFrame = true;
  lastValidRadarFrameMs = nowMs;

  if (frame.reportedTargetCount >= CHECKIT_RADAR_REPORTED_TARGET_CAPACITY) {
    ++targetCapacityFrames;
  }
  if (frame.truncated) {
    ++truncatedTargetFrames;
  }
  if (frame.reportedTargetCount > maximumReportedTargets) {
    maximumReportedTargets = frame.reportedTargetCount;
  }

  if (frame.truncated) {
    Serial.printf(
        "[RADAR] report contained %u targets; processing first %u\n",
        frame.reportedTargetCount,
        frame.targetCount);
  }

  bool foundCandidate = false;
  RadarTarget bestTarget{};
  WarningDecision bestDecision{};
  Ld2451Frame reliableFrame{};
  reliableFrame.alarm = frame.alarm;
  reliableFrame.reportedTargetCount = frame.reportedTargetCount;
  reliableFrame.truncated = frame.truncated;
  RadarTarget trackableTargets[kLd2451MaxTargets]{};
  uint8_t trackableTargetCount = 0;

  targetConfirmationFilter.beginFrame(nowMs);
  const bool diagnosticDue =
      static_cast<uint32_t>(nowMs - lastRadarDiagnosticMs) >=
          CHECKIT_RADAR_DIAGNOSTIC_INTERVAL_MS;

  for (uint8_t i = 0; i < frame.targetCount; ++i) {
    const RadarTarget &target = frame.targets[i];
    if (target.speedKmh < CHECKIT_TRAFFIC_MICROMOBILITY_MIN_SPEED_KMH) {
      ++slowReturnsExcluded;
      continue;
    }
    if (isWeakExtremeSpeedReading(target, targetQualityConfig)) {
      ++weakExtremeSpeedReturnsFiltered;
      continue;
    }
    if (target.snr < CHECKIT_TELEMETRY_MIN_SNR) {
      ++lowSnrTargetsFiltered;
    }
    if (passesTargetQualityGate(target, targetQualityConfig) &&
        trackableTargetCount < kLd2451MaxTargets) {
      // Track every physically plausible dot. Short/noisy paths are retained
      // as review/rejected passage records but never affect official counts.
      trackableTargets[trackableTargetCount++] = target;
    }

    const bool confirmed = targetConfirmationFilter.observe(target);
    if (!confirmed) {
      continue;
    }

    if (reliableFrame.targetCount < kLd2451MaxTargets) {
      reliableFrame.targets[reliableFrame.targetCount++] = target;
    }
    if (diagnosticDue) {
      logTargetJson(frame, target, nowMs);
    }

    if (!warningOutputsEnabled()) {
      continue;
    }

    const WarningDecision decision =
        evaluateTarget(target, decisionConfig);
    if (!decision.shouldFlashLocal && !decision.shouldFlashRemote) {
      continue;
    }

    if (!foundCandidate ||
        decision.level > bestDecision.level ||
        (decision.level == bestDecision.level &&
         target.speedKmh > bestTarget.speedKmh)) {
      foundCandidate = true;
      bestTarget = target;
      bestDecision = decision;
    }
  }
  targetConfirmationFilter.endFrame();
  trafficTracker.update(
      trackableTargets,
      trackableTargetCount,
      nowMs,
      currentEpoch());
  drainCompletedTrafficPassages();
  if (diagnosticDue) {
    lastRadarDiagnosticMs = nowMs;
    if (reliableFrame.targetCount == 0 && frame.targetCount > 0) {
      Serial.printf(
          "[RADAR] filtered %u unconfirmed/low-quality target(s)\n",
          frame.targetCount);
    }
  }

  reliableFrame.alarm = frame.alarm && reliableFrame.targetCount > 0;
#if CHECKIT_ENABLE_RADAR_WEB
  latestRadarFrame = reliableFrame;
  latestRadarFrameMs = nowMs;
  hasRadarFrame = true;
#endif

  const bool emit = alertGate.observe(
      foundCandidate,
      foundCandidate ? bestTarget.direction : DIR_UNKNOWN,
      foundCandidate ? bestDecision.level : WARN_NONE,
      nowMs);
  if (emit) {
    emitAlert(bestTarget, bestDecision, frame.alarm, nowMs);
  }
}

void readRadar(uint32_t nowMs) {
  while (radarSerial.available() > 0) {
    Ld2451Frame frame{};
    const Ld2451ParseResult result =
        radarParser.push(static_cast<uint8_t>(radarSerial.read()), frame);
    if (result == LD2451_FRAME_READY) {
      handleRadarFrame(frame, nowMs);
    }
  }
}

#if CHECKIT_ENABLE_REFERENCE_RADAR
void readReferenceRadar(uint32_t nowMs) {
  while (referenceRadarSerial.available() > 0) {
    const uint8_t byte = static_cast<uint8_t>(referenceRadarSerial.read());
    ++referenceRadarBytes;
    Ld2415hMeasurement measurement{};
    const Ld2415hParseResult result =
        referenceRadarParser.push(byte, measurement);
    if (result != LD2415H_MEASUREMENT_READY) {
      continue;
    }

    ReferenceSample sample{};
    sample.bootId = trafficBootId;
    sample.sequence = nextReferenceSequence++;
    if (nextReferenceSequence == 0) {
      nextReferenceSequence = 1;
    }
    sample.uptimeMs = nowMs;
    sample.observedEpoch = currentEpoch();
    sample.signedSpeedTenthsKmh = measurement.signedSpeedTenthsKmh;
    sample.direction = measurement.direction;
    memcpy(sample.raw, measurement.raw, sizeof(sample.raw));
    const bool stored = referenceTelemetry.enqueue(sample);

    if (static_cast<uint32_t>(nowMs - lastReferenceDiagnosticMs) >= 1000UL) {
      lastReferenceDiagnosticMs = nowMs;
      Serial.printf(
          "[LD2415H] seq=%lu direction=%s speed=%.1f km/h stored=%s "
          "bytes=%lu\n",
          static_cast<unsigned long>(sample.sequence),
          sample.direction == LD2415H_APPROACH ? "approach" : "away",
          static_cast<double>(sample.signedSpeedTenthsKmh) / 10.0,
          stored ? "true" : "false",
          static_cast<unsigned long>(referenceRadarBytes));
    }
  }
}
#endif

void runMockRadar(uint32_t nowMs) {
#if CHECKIT_MOCK_RADAR
  if (static_cast<uint32_t>(nowMs - lastMockMs) < 1000UL) {
    return;
  }
  lastMockMs = nowMs;

  Ld2451Frame frame{};
  frame.alarm = true;
  frame.reportedTargetCount = 1;
  frame.targetCount = 1;
  frame.targets[0] = RadarTarget{
      0,
      5,
      30,
      DIR_APPROACH,
      28,
      40};
  handleRadarFrame(frame, nowMs);
#else
  (void)nowMs;
#endif
}

void sendHeartbeat(uint32_t nowMs) {
  if (!espNowWarningsEnabled()) {
    return;
  }
  if (static_cast<uint32_t>(nowMs - lastHeartbeatMs) <
      CHECKIT_ESPNOW_HEARTBEAT_MS) {
    return;
  }
  lastHeartbeatMs = nowMs;

  const CheckItMessage heartbeat = makeMessage(
      MSG_HEARTBEAT,
      allocateSequence(),
      CHECKIT_RADAR_NODE_ID,
      CHECKIT_TARGET_FLASH_NODE_ID,
      nowMs,
      nullptr,
      WARN_NONE,
      0,
      FLAG_NONE);
  sendMessage(heartbeat);
}

}  // namespace

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(1000);

  const ProvisioningSettings compiledDefaults =
      makeCompiledProvisioningDefaults();
  provisioningManager.begin(compiledDefaults, CHECKIT_BLE_SETUP_PIN);
  applyProvisionedSettings();

  Serial.println();
  Serial.println("CHECKIT TRANSPORT V2 - DUAL RADAR NODE");
  Serial.printf(
      "[RADAR] direction byte 0 means %s\n",
      CHECKIT_LD2451_ZERO_DIRECTION_IS_APPROACH
          ? "approach"
          : "away");
  Serial.printf(
      "[RADAR] reliable targets require SNR >= %u, distance %u-%u m, "
      "angle +/- %u deg, and two consistent frames\n",
      CHECKIT_MIN_WARNING_SNR,
      CHECKIT_MIN_WARNING_DISTANCE_M,
      CHECKIT_MAX_WARNING_DISTANCE_M,
      CHECKIT_MAX_WARNING_ABS_ANGLE_DEG);
  Serial.println(
      "[RADAR] confirmed target diagnostics are limited to once per second");
  Serial.printf(
      "[STORAGE] training capture keeps speed >=%u km/h and SNR >=%u "
      "including micromobility, motor-vehicle, review, and rejected paths\n",
      CHECKIT_TELEMETRY_MIN_SPEED_KMH,
      CHECKIT_TELEMETRY_MIN_SNR);
  Serial.printf(
      "[TRACKER] accepted paths require >=%u hits, >=%lu ms, >=%u m "
      "travel, and quality >=%u; classifier=%s\n",
      CHECKIT_TRACKER_MIN_HITS,
      static_cast<unsigned long>(CHECKIT_TRACKER_MIN_DURATION_MS),
      CHECKIT_TRACKER_MIN_TRAVEL_M,
      CHECKIT_TRACKER_ACCEPTED_QUALITY_SCORE,
      CHECKIT_TRAFFIC_MODEL_VERSION);
  Serial.printf(
      "[FEATURES] %s adds XY, velocity, acceleration, path geometry, "
      "variation, and gap evidence without changing official counts\n",
      CHECKIT_TRAFFIC_FEATURE_VERSION);
  Serial.printf(
      "[QUALITY] discard speed >=%u km/h only when SNR <%u; "
      "capacity diagnostic=%u reported targets\n",
      CHECKIT_IMPLAUSIBLE_SPEED_KMH,
      CHECKIT_IMPLAUSIBLE_SPEED_MIN_SNR,
      CHECKIT_RADAR_REPORTED_TARGET_CAPACITY);
  if (roadsideObservationMode()) {
    Serial.println(
        "[ROUTE] roadside observation; warning outputs and ESP-NOW disabled");
  } else if (radarWarningsEnabled()) {
    Serial.println(
        "[ROUTE] radar warning; all alerts use the local matrix/speaker");
  } else if (provisioningManager.operatingMode() ==
             OperatingMode::FLASHING_WARNING) {
    Serial.println(
        "[ROUTE] flashing warning; alerts use ESP-NOW with local fallback");
  } else {
    Serial.printf(
        "[ROUTE] legacy mode; local below %u m, flashing node %u at or "
        "beyond %u m\n",
        CHECKIT_REMOTE_FLASH_DISTANCE_M,
        CHECKIT_TARGET_FLASH_NODE_ID,
        CHECKIT_REMOTE_FLASH_DISTANCE_M);
  }
  Serial.printf(
      "[SETUP] state=%s BLE=%s mode=%s name=%s sensor=%s "
      "speed=%u/%u/%u km/h\n",
      provisioningManager.provisioned() ? "locked" : "setup-required",
      provisioningManager.bleActive() ? "advertising" : "off",
      operatingModeName(provisioningManager.operatingMode()),
      runtimeSettings().deviceName,
      runtimeSettings().sensorId,
      decisionConfig.speedLimitKmh,
      decisionConfig.dangerSpeedKmh,
      decisionConfig.emergencySpeedKmh);

  if (warningOutputsEnabled()) {
    localOutputs.begin(CHECKIT_MATRIX_INTENSITY);
  }
  trafficBootId = esp_random();
  if (trafficBootId == 0) {
    trafficBootId = 1;
  }
  Serial.printf(
      "[TRACKER] boot_id=%lu\n",
      static_cast<unsigned long>(trafficBootId));
  if (espNowWarningsEnabled()) {
    receiveQueue = xQueueCreate(8, sizeof(ReceivedMessage));
  }

  radarSerial.begin(
      CHECKIT_RADAR_UART_BAUD,
      SERIAL_8N1,
      CHECKIT_RADAR_UART_RX_PIN,
      CHECKIT_RADAR_UART_TX_PIN);
#if CHECKIT_ENABLE_REFERENCE_RADAR
  referenceRadarSerial.begin(
      CHECKIT_REFERENCE_UART_BAUD,
      SERIAL_8N1,
      CHECKIT_REFERENCE_TSIM_UART_RX_PIN,
      CHECKIT_REFERENCE_TSIM_UART_TX_PIN);
  Serial.printf(
      "[LD2415H] reference UART0 ready baud=%u RX=GPIO%u TX=GPIO%u; "
      "reference data does not affect official counts\n",
      CHECKIT_REFERENCE_UART_BAUD,
      CHECKIT_REFERENCE_TSIM_UART_RX_PIN,
      CHECKIT_REFERENCE_TSIM_UART_TX_PIN);
#endif

  setupEspNow();
  setupRadarWeb();
  cloudTelemetry.begin();
#if CHECKIT_ENABLE_REFERENCE_RADAR
  referenceTelemetry.begin();
  configureReferenceRadar();
#endif
  if (!configureRadar()) {
    Serial.println(
        "[RADAR CONFIG] warning: configuration failed; "
        "continuing with stored radar settings");
  }

  Serial.println("[SYSTEM] radar node online");
#if CHECKIT_ENABLE_OUTPUT_SELF_TEST_ON_BOOT
  if (operatingModeUsesLocalOutput(provisioningManager.operatingMode())) {
    localOutputs.start(
        CHECKIT_OUTPUT_TEST_SPEED_KMH,
        DIR_APPROACH,
        WARN_INFO,
        CHECKIT_OUTPUT_TEST_DURATION_MS,
        millis());
    Serial.println("[OUTPUT] boot matrix flash test started");
  }
#endif
}

void loop() {
  const uint32_t nowMs = millis();
  readRadar(nowMs);
#if CHECKIT_ENABLE_REFERENCE_RADAR
  readReferenceRadar(nowMs);
#endif
  trafficTracker.expire(nowMs, currentEpoch());
  drainCompletedTrafficPassages();
  runMockRadar(nowMs);
  if (espNowWarningsEnabled()) {
    processReceivedMessages();
    maintainRemoteAlertFallback(nowMs);
  }
  sendHeartbeat(nowMs);
  if (warningOutputsEnabled()) {
    localOutputs.update(nowMs);
  }
  updateRadarWeb();
  maintainInternetWiFi(nowMs);
  updateCloudHealth(nowMs);
  provisioningManager.update(nowMs);
  delay(1);
}
