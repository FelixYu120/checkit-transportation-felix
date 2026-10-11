#include <Arduino.h>
#include <WebServer.h>
#include <WiFi.h>
#include <esp_arduino_version.h>
#include <esp_now.h>
#include <esp_wifi.h>

#include "CheckItConfig.h"
#include "CheckItProtocol.h"
#include "FlashDashboardPage.h"
#include "WarningOutputs.h"

using namespace CheckIt;

namespace {

WarningOutputs warningOutputs(
    CHECKIT_FLASH_MATRIX_DIN_PIN,
    CHECKIT_FLASH_MATRIX_CS_PIN,
    CHECKIT_FLASH_MATRIX_CLK_PIN,
    CHECKIT_MATRIX_MODULE_COUNT,
    CHECKIT_MATRIX_REVERSE_MODULE_ORDER != 0,
    CHECKIT_FLASH_SPEAKER_PIN,
    CHECKIT_FLASH_STATUS_LED_PIN,
    CHECKIT_ENABLE_FLASH_MATRIX != 0,
    CHECKIT_ENABLE_FLASH_SPEAKER != 0);

SequenceTracker sequenceTracker;
QueueHandle_t receiveQueue = nullptr;
uint16_t nextSequence = 0;
uint32_t lastRadarMessageMs = 0;
bool hasSeenRadar = false;
bool espNowReady = false;

#if CHECKIT_ENABLE_FLASH_WEB
WebServer flashWebServer(CHECKIT_FLASH_WEB_PORT);
bool flashAccessPointReady = false;
#endif

struct ReceivedMessage {
  uint8_t sourceMac[6];
  CheckItMessage message;
};

uint16_t allocateSequence() {
  ++nextSequence;
  if (nextSequence == 0) {
    ++nextSequence;
  }
  return nextSequence;
}

void queueReceivedMessage(
    const uint8_t *sourceMac,
    const uint8_t *data,
    int length) {
  if (receiveQueue == nullptr ||
      sourceMac == nullptr ||
      length != static_cast<int>(sizeof(CheckItMessage))) {
    return;
  }

  ReceivedMessage envelope{};
  memcpy(envelope.sourceMac, sourceMac, sizeof(envelope.sourceMac));
  memcpy(&envelope.message, data, sizeof(envelope.message));
  xQueueSend(receiveQueue, &envelope, 0);
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onEspNowReceive(
    const esp_now_recv_info_t *info,
    const uint8_t *data,
    int length) {
  queueReceivedMessage(info == nullptr ? nullptr : info->src_addr, data, length);
}
#else
void onEspNowReceive(
    const uint8_t *sourceMac,
    const uint8_t *data,
    int length) {
  queueReceivedMessage(sourceMac, data, length);
}
#endif

bool setupEspNow() {
#if CHECKIT_ENABLE_FLASH_WEB
  WiFi.mode(WIFI_AP_STA);
#else
  WiFi.mode(WIFI_STA);
#endif
  WiFi.persistent(false);
  WiFi.disconnect(false, true);

#if CHECKIT_ENABLE_FLASH_WEB
  const IPAddress flashIp(192, 168, 5, 1);
  const IPAddress flashGateway(192, 168, 5, 1);
  const IPAddress flashSubnet(255, 255, 255, 0);
  flashAccessPointReady =
      WiFi.softAPConfig(flashIp, flashGateway, flashSubnet) &&
      WiFi.softAP(
          CHECKIT_FLASH_AP_SSID,
          CHECKIT_FLASH_AP_PASSWORD,
          CHECKIT_ESPNOW_CHANNEL);
  if (flashAccessPointReady) {
    Serial.printf(
        "[WEB] Wi-Fi: %s password: %s\n",
        CHECKIT_FLASH_AP_SSID,
        CHECKIT_FLASH_AP_PASSWORD);
    Serial.printf(
        "[WEB] dashboard: http://%s/\n",
        WiFi.softAPIP().toString().c_str());
  } else {
    Serial.println("[WEB] failed to start flashing-node access point");
  }
#endif

  if (esp_wifi_set_channel(
          CHECKIT_ESPNOW_CHANNEL,
          WIFI_SECOND_CHAN_NONE) != ESP_OK) {
    Serial.println("[ESPNOW] failed to set channel");
    return false;
  }

  Serial.print("[WIFI] MAC: ");
  Serial.println(WiFi.macAddress());
  Serial.printf("[ESPNOW] channel: %u\n", CHECKIT_ESPNOW_CHANNEL);

  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESPNOW] initialization failed");
    return false;
  }

  esp_now_register_recv_cb(onEspNowReceive);
  espNowReady = true;
  Serial.println("[ESPNOW] ready");
  return true;
}

#if CHECKIT_ENABLE_FLASH_WEB
void sendFlashStatusJson() {
  const uint32_t nowMs = millis();
  const uint32_t radarAgeMs = hasSeenRadar
      ? static_cast<uint32_t>(nowMs - lastRadarMessageMs)
      : 0;
  const bool radarLinkActive =
      hasSeenRadar && radarAgeMs <= CHECKIT_RADAR_STALE_MS;

  String json;
  json.reserve(240);
  json += F("{\"node_id\":");
  json += CHECKIT_FLASH_NODE_ID;
  json += F(",\"espnow_ready\":");
  json += espNowReady ? F("true") : F("false");
  json += F(",\"radar_link_active\":");
  json += radarLinkActive ? F("true") : F("false");
  json += F(",\"last_radar_age_ms\":");
  json += radarAgeMs;
  json += F(",\"output_active\":");
  json += warningOutputs.active(nowMs) ? F("true") : F("false");
  json += F(",\"channel\":");
  json += CHECKIT_ESPNOW_CHANNEL;
  json += F("}");

  flashWebServer.sendHeader("Cache-Control", "no-store");
  flashWebServer.send(200, "application/json", json);
}

void startFlashOutputTest() {
  warningOutputs.start(
      CHECKIT_OUTPUT_TEST_SPEED_KMH,
      DIR_APPROACH,
      WARN_INFO,
      CHECKIT_OUTPUT_TEST_DURATION_MS,
      millis());
  Serial.println("[OUTPUT] standalone flashing-node matrix test started");
  flashWebServer.send(
      200,
      "application/json",
      "{\"ok\":true,\"message\":\"flashing-node matrix test started\"}");
}

void setupFlashWeb() {
  if (!flashAccessPointReady) {
    return;
  }
  flashWebServer.on("/", HTTP_GET, []() {
    flashWebServer.sendHeader("Cache-Control", "no-store");
    flashWebServer.send_P(200, "text/html", kFlashDashboardHtml);
  });
  flashWebServer.on("/api/status", HTTP_GET, sendFlashStatusJson);
  flashWebServer.on("/api/test-output", HTTP_POST, startFlashOutputTest);
  flashWebServer.on("/health", HTTP_GET, []() {
    flashWebServer.send(200, "text/plain", "ok\n");
  });
  flashWebServer.onNotFound([]() {
    flashWebServer.send(404, "application/json", "{\"error\":\"not found\"}");
  });
  flashWebServer.begin();
  Serial.println("[WEB] flashing-node HTTP server ready");
}

void updateFlashWeb() {
  if (flashAccessPointReady) {
    flashWebServer.handleClient();
  }
}
#else
void setupFlashWeb() {}
void updateFlashWeb() {}
#endif

bool ensurePeer(const uint8_t sourceMac[6]) {
  if (esp_now_is_peer_exist(sourceMac)) {
    return true;
  }

  esp_now_peer_info_t peer{};
  memcpy(peer.peer_addr, sourceMac, 6);
  peer.channel = CHECKIT_ESPNOW_CHANNEL;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  return esp_now_add_peer(&peer) == ESP_OK;
}

void sendAck(
    const uint8_t sourceMac[6],
    const CheckItMessage &received,
    uint32_t nowMs) {
  if (!ensurePeer(sourceMac)) {
    Serial.println("[ESPNOW] unable to add ACK peer");
    return;
  }

  const CheckItMessage ack = makeAck(
      allocateSequence(),
      CHECKIT_FLASH_NODE_ID,
      received.sourceNodeId,
      nowMs,
      received.sequence);
  esp_now_send(
      sourceMac,
      reinterpret_cast<const uint8_t *>(&ack),
      sizeof(ack));
}

bool validAlertPayload(const CheckItMessage &message) {
  return message.direction >= DIR_APPROACH &&
      message.direction <= DIR_AWAY &&
      message.warningLevel >= WARN_INFO &&
      message.warningLevel <= WARN_EMERGENCY &&
      message.durationMs > 0 &&
      message.durationMs <= 30000;
}

void processMessage(
    const uint8_t sourceMac[6],
    const CheckItMessage &message,
    uint32_t nowMs) {
  if (!isValidMessage(message)) {
    Serial.println("[ESPNOW] rejected invalid CRC/protocol packet");
    return;
  }
  if (message.targetNodeId != CHECKIT_BROADCAST_NODE_ID &&
      message.targetNodeId != CHECKIT_FLASH_NODE_ID) {
    return;
  }
  if (message.type != MSG_ALERT &&
      message.type != MSG_CLEAR &&
      message.type != MSG_HEARTBEAT) {
    Serial.println("[ESPNOW] rejected unsupported inbound message type");
    return;
  }
  if (message.type == MSG_ALERT && !validAlertPayload(message)) {
    Serial.println("[ESPNOW] rejected invalid alert payload");
    return;
  }
  if (!sequenceTracker.accept(message.sourceNodeId, message.sequence)) {
    Serial.printf(
        "[ESPNOW] duplicate/stale source=%u sequence=%u\n",
        message.sourceNodeId,
        message.sequence);
    return;
  }

  hasSeenRadar = true;
  lastRadarMessageMs = nowMs;

  if (message.type == MSG_HEARTBEAT) {
    return;
  }

  if (message.type == MSG_CLEAR) {
    warningOutputs.stop();
    sendAck(sourceMac, message, nowMs);
    return;
  }

  if ((message.flags & FLAG_REMOTE_OUTPUT) == 0) {
    Serial.printf(
        "[ROUTE] ignored alert sequence=%u without remote-output flag\n",
        message.sequence);
    sendAck(sourceMac, message, nowMs);
    return;
  }

  const Direction direction =
      static_cast<Direction>(message.direction);
  const WarningLevel level =
      static_cast<WarningLevel>(message.warningLevel);
  warningOutputs.start(
      message.speedKmh,
      direction,
      level,
      message.durationMs,
      nowMs);

  Serial.printf(
      "[ALERT] radar=%u sequence=%u speed=%u distance=%u "
      "angle=%d direction=%s level=%u duration=%u\n",
      message.sourceNodeId,
      message.sequence,
      message.speedKmh,
      message.distanceM,
      static_cast<int>(message.angleDeg),
      directionName(direction),
      static_cast<unsigned>(level),
      message.durationMs);
  sendAck(sourceMac, message, nowMs);
}

void processReceiveQueue(uint32_t nowMs) {
  if (receiveQueue == nullptr) {
    return;
  }

  ReceivedMessage envelope{};
  while (xQueueReceive(receiveQueue, &envelope, 0) == pdTRUE) {
    processMessage(envelope.sourceMac, envelope.message, nowMs);
  }
}

void applyRadarFailsafe(uint32_t nowMs) {
  if (!hasSeenRadar) {
    return;
  }
  if (static_cast<uint32_t>(nowMs - lastRadarMessageMs) <=
      CHECKIT_RADAR_STALE_MS) {
    return;
  }

  if (warningOutputs.active(nowMs)) {
    Serial.println("[FAILSAFE] radar heartbeat stale; outputs stopped");
  }
  warningOutputs.stop();
  hasSeenRadar = false;
}

}  // namespace

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(1000);

  Serial.println();
  Serial.println("CHECKIT TRANSPORT V2 - FLASHING NODE");

  warningOutputs.begin(CHECKIT_MATRIX_INTENSITY);
  receiveQueue = xQueueCreate(12, sizeof(ReceivedMessage));
  setupEspNow();
  setupFlashWeb();

  Serial.println("[SYSTEM] flashing node online");
#if CHECKIT_ENABLE_OUTPUT_SELF_TEST_ON_BOOT
  warningOutputs.start(
      CHECKIT_OUTPUT_TEST_SPEED_KMH,
      DIR_APPROACH,
      WARN_INFO,
      CHECKIT_OUTPUT_TEST_DURATION_MS,
      millis());
  Serial.println("[OUTPUT] boot flashing-node matrix test started");
#endif
}

void loop() {
  const uint32_t nowMs = millis();
  processReceiveQueue(nowMs);
  applyRadarFailsafe(nowMs);
  warningOutputs.update(nowMs);
  updateFlashWeb();
  delay(1);
}
