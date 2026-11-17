#include <Arduino.h>
#include <math.h>
#include "Protocol.h"
#include "Dashboard.h"

HardwareSerial radar(2);
kmd7::Parser parser;
bool ack = false, version = false, application = false, done = false, targets = false;
uint8_t errorCode = 255;
uint32_t lastByte = 0;

void onPacket(const uint8_t* tag, const uint8_t* p, uint32_t n) {
  if (!memcmp(tag, "RESP", 4)) {
    ack = true;
    errorCode = p[0];
    if (errorCode) Serial.printf("[ERROR] Radar RESP=%u\n", errorCode);
  } else if (!memcmp(tag, "VERS", 4)) {
    version = true;
    application = !memcmp(p, "K-MD7_APP", 9);
    Serial.printf("[VERSION] %.*s\n", int(n), reinterpret_cast<const char*>(p));
  } else if (!memcmp(tag, "TDAT", 4)) {
    targets = true;
    pendingCount = n / 9;
    for (uint8_t i=0; i<pendingCount; ++i) pendingTargets[i]=kmd7::target(p+i*9);
    Serial.printf("[TARGETS] %lu\n", static_cast<unsigned long>(n / 9));
    for (uint32_t i = 0; i < n; i += 9) {
      const auto t = kmd7::target(p + i);
      Serial.printf("id=%u range=%.2fm speed=%.2fkm/h (%.2fmph) %s angle=%.2fdeg signal=%.2fdB\n",
                    t.id, t.distanceM, t.speedKmh, fabsf(t.speedKmh) * 0.621371f,
                    t.speedKmh < 0 ? "approaching" : t.speedKmh > 0 ? "receding" : "zero",
                    t.angleDeg, t.magnitudeDb);
    }
  } else if (!memcmp(tag, "DONE", 4)) {
    done = true;
    Serial.printf("[FRAME] %lu\n", static_cast<unsigned long>(kmd7::u32(p)));
  }
}

void pump() {
  if (millis() - lastByte > 250) parser.reset();
  while (radar.available()) {
    lastByte = millis();
    parser.feed(uint8_t(radar.read()), onPacket);
  }
}

void send(const char* tag, int payload = -1) {
  ack = false;
  errorCode = 255;
  radar.write(reinterpret_cast<const uint8_t*>(tag), 4);
  const uint8_t length[4] = {uint8_t(payload >= 0 ? 1 : 0), 0, 0, 0};
  radar.write(length, sizeof(length));
  if (payload >= 0) radar.write(uint8_t(payload));
}

bool waitFor(bool& flag) {
  uint32_t start = millis();
  while (!flag && millis() - start < 1500) {
    pump();
    web.handleClient();
    if (ack && errorCode != 0) return false;
    delay(1);
  }
  return flag;
}

bool connectRadar() {
  // End any prior application session after an ESP-only reset.
  send("GBYE");
  uint32_t start = millis();
  while (millis() - start < 300) {
    while (radar.available()) radar.read();
    web.handleClient();
    delay(1);
  }
  parser.reset();
  version = application = false;
  send("INIT", 0);  // Keep the sensor at 115200, 8E1.
  if (!waitFor(version) || !ack || errorCode != 0 || !application) {
    Serial.println("[WAIT] No K-MD7 application handshake. Check power, RX/TX and board model; power-cycle radar if needed.");
    return false;
  }
  Serial.println("[READY] Polling targets. 'w' lowers minimum speed filter for walking tests; 'r' reconnects.");
  return true;
}

void setup() {
  Serial.begin(115200);  // USB console: 8N1, unlike the radar UART.
  delay(1500);
  Serial.printf("K-MD7 standalone bench reader: T-SIM7080G-S3, RX%d TX%d\n",
                KMD7_RX_PIN, KMD7_TX_PIN);
  radar.setRxBufferSize(1024);
  radar.begin(115200, SERIAL_8E1, KMD7_RX_PIN, KMD7_TX_PIN);
  startDashboard();
}

void loop() {
  web.handleClient();
  if (!radarConnected) {
    radarConnected = connectRadar();
    if (!radarConnected) { serviceWait(2000); return; }
  }
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == 'r') { radarConnected = false; return; }
    if (c == 'w') {
      send("MISP", 0);
      if (!waitFor(ack) || errorCode) { radarConnected = false; return; }
      Serial.println("[CONFIG] Minimum speed filter set to 0%. This changes radar settings; other settings retained.");
    }
  }
  done = targets = false;
  send("GNFD", 0x28);  // TDAT bit 3 + DONE bit 5, one frame per request.
  if (!waitFor(done) || !ack || errorCode != 0 || !targets) {
    Serial.println("[ERROR] Incomplete target frame; reconnecting.");
    radarConnected = false;
  } else {
    liveCount = pendingCount;
    for (uint8_t i=0; i<liveCount; ++i) liveTargets[i]=pendingTargets[i];
    haveFrame = true;
    lastFrameMs = millis();
    ++frameCount;
    if (liveCount) ++detectionFrames;
  }
  serviceWait(200);  // Bench logging cadence, not a lossless traffic counter.
}
