#include <Arduino.h>
#include <WebServer.h>
#include <WiFi.h>
#include <time.h>

#include "CheckItConfig.h"
#include "Ld2415hProtocol.h"
#include "ReferenceTelemetry.h"

#if __has_include("CheckItSecrets.h")
#include "CheckItSecrets.h"
#endif

#ifndef CHECKIT_WIFI_SSID
#define CHECKIT_WIFI_SSID "YOUR_2_4_GHZ_WIFI_NAME"
#endif
#ifndef CHECKIT_WIFI_PASSWORD
#define CHECKIT_WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#endif
#ifndef CHECKIT_SUPABASE_URL
#define CHECKIT_SUPABASE_URL "https://YOUR_PROJECT_REF.supabase.co"
#endif
#ifndef CHECKIT_SUPABASE_PUBLISHABLE_KEY
#define CHECKIT_SUPABASE_PUBLISHABLE_KEY "YOUR_SUPABASE_PUBLISHABLE_KEY"
#endif
#ifndef CHECKIT_SENSOR_ID
#define CHECKIT_SENSOR_ID "radar-001"
#endif
#ifndef CHECKIT_REFERENCE_SENSOR_ID
#define CHECKIT_REFERENCE_SENSOR_ID "radar-001-ld2415h"
#endif
#ifndef CHECKIT_REFERENCE_PRIMARY_SENSOR_ID
#define CHECKIT_REFERENCE_PRIMARY_SENSOR_ID CHECKIT_SENSOR_ID
#endif
#ifndef CHECKIT_REFERENCE_TEST_RUN_ID
#define CHECKIT_REFERENCE_TEST_RUN_ID ""
#endif

using namespace CheckIt;

namespace {

HardwareSerial referenceSerial(2);
Ld2415hParser parser;
WebServer server(CHECKIT_REFERENCE_WEB_PORT);
uint32_t bootId = 0U;
uint32_t nextSequence = 1U;
uint32_t receivedBytes = 0U;
uint32_t lastMeasurementMs = 0U;
uint32_t lastWifiAttemptMs = 0U;
Ld2415hMeasurement latestMeasurement{};
bool hasMeasurement = false;

const ReferenceTelemetryConfig telemetryConfig{
    CHECKIT_SUPABASE_URL,
    CHECKIT_SUPABASE_PUBLISHABLE_KEY,
    CHECKIT_REFERENCE_TABLE,
    CHECKIT_REFERENCE_PRIMARY_SENSOR_ID,
    CHECKIT_REFERENCE_SENSOR_ID,
    CHECKIT_REFERENCE_TEST_RUN_ID,
    false};
ReferenceTelemetry telemetry(telemetryConfig);

bool configuredValue(const char *value) {
  return value != nullptr && value[0] != '\0' &&
      strstr(value, "YOUR_") == nullptr;
}

uint32_t currentEpoch() {
  const time_t now = time(nullptr);
  return now >= static_cast<time_t>(CHECKIT_MIN_VALID_UNIX_TIME)
      ? static_cast<uint32_t>(now)
      : 0U;
}

void sendCommand(const uint8_t *command, size_t length, const char *label) {
  referenceSerial.write(command, length);
  referenceSerial.flush();
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
    sendCommand(command, sizeof(command), "speed/angle/sensitivity");
  }
  if (buildLd2415hOutputConfig(
          LD2415H_DETECT_BOTH,
          CHECKIT_REFERENCE_SAMPLE_RATE_DIVISOR,
          LD2415H_KMH,
          command)) {
    sendCommand(command, sizeof(command), "both-directions/kmh/output-rate");
  }
  if (buildLd2415hAntiVibrationConfig(
          CHECKIT_REFERENCE_ANTI_VIBRATION,
          command)) {
    sendCommand(command, sizeof(command), "anti-vibration");
  }
#endif
}

void beginWifi() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(CHECKIT_REFERENCE_AP_SSID, CHECKIT_REFERENCE_AP_PASSWORD);
  Serial.printf(
      "[WEB] Wi-Fi: %s password: %s\n[WEB] dashboard: http://%s/\n",
      CHECKIT_REFERENCE_AP_SSID,
      CHECKIT_REFERENCE_AP_PASSWORD,
      WiFi.softAPIP().toString().c_str());
  if (configuredValue(CHECKIT_WIFI_SSID)) {
    WiFi.begin(CHECKIT_WIFI_SSID, CHECKIT_WIFI_PASSWORD);
    lastWifiAttemptMs = millis();
    Serial.printf("[CLOUD] connecting to '%s'\n", CHECKIT_WIFI_SSID);
  } else {
    Serial.println("[CLOUD] Internet Wi-Fi not configured; samples remain local");
  }
}

void maintainWifi(uint32_t nowMs) {
  if (!configuredValue(CHECKIT_WIFI_SSID) || WiFi.status() == WL_CONNECTED ||
      static_cast<uint32_t>(nowMs - lastWifiAttemptMs) <
          CHECKIT_CLOUD_WIFI_RECONNECT_INTERVAL_MS) {
    return;
  }
  lastWifiAttemptMs = nowMs;
  WiFi.disconnect(false, false);
  WiFi.begin(CHECKIT_WIFI_SSID, CHECKIT_WIFI_PASSWORD);
  Serial.printf("[CLOUD] retrying Wi-Fi '%s'\n", CHECKIT_WIFI_SSID);
}

String statusJson() {
  const ReferenceTelemetryStats cloud = telemetry.stats();
  String json;
  json.reserve(600);
  json += F("{\"firmware_version\":\"");
  json += CHECKIT_FIRMWARE_VERSION;
  json += F("\",\"reference_sensor_id\":\"");
  json += CHECKIT_REFERENCE_SENSOR_ID;
  json += F("\",\"primary_sensor_id\":\"");
  json += CHECKIT_REFERENCE_PRIMARY_SENSOR_ID;
  json += F("\",\"uart_bytes\":");
  json += receivedBytes;
  json += F(",\"valid_frames\":");
  json += parser.validFrames();
  json += F(",\"frame_errors\":");
  json += parser.frameErrors();
  json += F(",\"last_frame_age_ms\":");
  json += hasMeasurement ? millis() - lastMeasurementMs : UINT32_MAX;
  json += F(",\"wifi_online\":");
  json += WiFi.status() == WL_CONNECTED ? F("true") : F("false");
  json += F(",\"pending_samples\":");
  json += cloud.pendingSamples;
  json += F(",\"uploaded_samples\":");
  json += cloud.uploadedSamples;
  json += F(",\"dropped_samples\":");
  json += cloud.droppedSamples;
  json += F(",\"last_http_status\":");
  json += cloud.lastHttpStatus;
  json += F(",\"latest\":");
  if (!hasMeasurement) {
    json += F("null");
  } else {
    json += F("{\"direction\":\"");
    json += latestMeasurement.direction == LD2415H_APPROACH
        ? "approach"
        : "away";
    json += F("\",\"signed_speed_kmh\":");
    json += String(latestMeasurement.signedSpeedTenthsKmh / 10.0f, 1);
    json += '}';
  }
  json += '}';
  return json;
}

void beginWeb() {
  server.on("/", HTTP_GET, []() {
    server.send(
        200,
        "text/html",
        F("<!doctype html><meta name=viewport content='width=device-width'>"
          "<title>Check-It LD2415H Reference</title><style>body{font:18px "
          "system-ui;max-width:760px;margin:40px auto;padding:0 18px}pre{white-"
          "space:pre-wrap;background:#111;color:#8f8;padding:18px;border-radius:"
          "10px}button{font:inherit;padding:10px 16px}</style><h1>LD2415H "
          "Reference Radar</h1><p>This sensor validates signed speed. It never "
          "creates official traffic volume.</p><button onclick=send()>Send stored "
          "samples now</button><pre id=o>Loading...</pre><script>async function "
          "load(){try{o.textContent=JSON.stringify(await (await fetch('/api/"
          "status')).json(),null,2)}catch(e){o.textContent=e}setTimeout(load,1000)}"
          "async function send(){await fetch('/api/upload',{method:'POST'})}load()"
          "</script>"));
  });
  server.on("/api/status", HTTP_GET, []() {
    server.send(200, "application/json", statusJson());
  });
  server.on("/api/upload", HTTP_POST, []() {
    telemetry.requestUploadNow();
    server.send(202, "application/json", "{\"queued\":true}");
  });
  server.onNotFound([]() { server.send(404, "text/plain", "Not found"); });
  server.begin();
}

void handleMeasurement(
    const Ld2415hMeasurement &measurement,
    uint32_t nowMs) {
  latestMeasurement = measurement;
  lastMeasurementMs = nowMs;
  hasMeasurement = true;
  ReferenceSample sample{};
  sample.bootId = bootId;
  sample.sequence = nextSequence++;
  if (nextSequence == 0U) nextSequence = 1U;
  sample.uptimeMs = nowMs;
  sample.observedEpoch = currentEpoch();
  sample.signedSpeedTenthsKmh = measurement.signedSpeedTenthsKmh;
  sample.direction = measurement.direction;
  memcpy(sample.raw, measurement.raw, sizeof(sample.raw));
  const bool queued = telemetry.enqueue(sample);
  Serial.printf(
      "{\"type\":\"reference_speed\",\"sensor\":\"LD2415H\","
      "\"sequence\":%lu,\"direction\":\"%s\",\"signed_speed_kmh\":%.1f,"
      "\"stored\":%s}\n",
      static_cast<unsigned long>(sample.sequence),
      measurement.direction == LD2415H_APPROACH ? "approach" : "away",
      measurement.signedSpeedTenthsKmh / 10.0f,
      queued ? "true" : "false");
}

void readReferenceRadar(uint32_t nowMs) {
  while (referenceSerial.available() > 0) {
    const uint8_t byte = static_cast<uint8_t>(referenceSerial.read());
    ++receivedBytes;
    Ld2415hMeasurement measurement{};
    const Ld2415hParseResult result = parser.push(byte, measurement);
    if (result == LD2415H_MEASUREMENT_READY) {
      handleMeasurement(measurement, nowMs);
    } else if (result == LD2415H_FRAME_ERROR) {
      Serial.println("[LD2415H] rejected malformed standard-protocol frame");
    }
  }
}

}  // namespace

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(750);
  bootId = esp_random();
  if (bootId == 0U) bootId = 1U;
  Serial.println();
  Serial.println("CHECK-IT TRANSPORT V2 - LD2415H REFERENCE LOGGER");
  Serial.printf(
      "[LD2415H] UART2 9600 8N1 RX=%u TX=%u; + is approach, - is away\n",
      CHECKIT_REFERENCE_STANDALONE_UART_RX_PIN,
      CHECKIT_REFERENCE_STANDALONE_UART_TX_PIN);
  Serial.printf(
      "[REFERENCE] id=%s checks primary=%s; never increments official volume\n",
      CHECKIT_REFERENCE_SENSOR_ID,
      CHECKIT_REFERENCE_PRIMARY_SENSOR_ID);
  referenceSerial.begin(
      CHECKIT_REFERENCE_UART_BAUD,
      SERIAL_8N1,
      CHECKIT_REFERENCE_STANDALONE_UART_RX_PIN,
      CHECKIT_REFERENCE_STANDALONE_UART_TX_PIN);
  configureReferenceRadar();
  beginWifi();
  configTime(0, 0, CHECKIT_NTP_PRIMARY, CHECKIT_NTP_SECONDARY);
  telemetry.begin();
  beginWeb();
  Serial.println("[SYSTEM] LD2415H reference logger online");
}

void loop() {
  const uint32_t nowMs = millis();
  readReferenceRadar(nowMs);
  server.handleClient();
  maintainWifi(nowMs);
  delay(1);
}
