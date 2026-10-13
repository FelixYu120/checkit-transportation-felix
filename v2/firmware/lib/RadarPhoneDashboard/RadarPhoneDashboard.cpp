#include "RadarPhoneDashboard.h"
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include "RadarDisplayAddon.h"
#include "RadarPhonePage.h"
#ifdef CHECKIT_RADAR_CLOUD_ADDON
#include "RadarCloudAddon.h"
#endif

namespace CheckIt { namespace RadarPhoneDashboard {
namespace {
WebServer server(80);
bool ready = false;
char ssid[32];
constexpr char password[] = "CheckItV2";
RadarDisplayAddon::Snapshot state;
String quoted(const char *text) {
  String result = "\"";
  for (; *text; ++text) {
    const unsigned char c = *text;
    if (c == '"' || c == '\\') { result += '\\'; result += char(c); }
    else if (c >= 32) result += char(c);
  }
  return result + "\"";
}
String targets(const Ld2451Frame &frame) {
  String json = "[";
  for (uint8_t i = 0; i < frame.targetCount; ++i) {
    if (i) json += ',';
    const RadarTarget &t = frame.targets[i];
    json += "{\"kmh\":" + String(t.speedKmh) + ",\"mph\":" + String(t.speedKmh / 1.609344, 1);
    json += ",\"distance\":" + String(t.distanceM) + ",\"angle\":" + String(t.angleDeg);
    json += ",\"snr\":" + String(t.snr) + ",\"direction\":" + quoted(directionName(t.direction)) + "}";
  }
  return json + "]";
}
void noCache() { server.sendHeader("Cache-Control", "no-store"); }
void status() {
  RadarDisplayAddon::snapshot(state, millis());
  String json; json.reserve(24576);
  json = "{\"version\":19,\"ssid\":" + quoted(ssid) + ",\"uptime\":" + String(state.uptimeMs);
  json += ",\"limitKmh\":" + String(state.limitKmh);
#ifdef CHECKIT_RADAR_CLOUD_ADDON
  json += ",\"cloud\":" + RadarCloudAddon::statusJson();
#endif
  json += ",\"mode\":" + quoted(state.mode) + ",\"link\":" + quoted(ld2451LinkStateName(state.link));
  json += ",\"reportAge\":" + (state.hasReport ? String(state.reportAgeMs) : String("null"));
  json += ",\"detectionAge\":" + (state.hasDetection ? String(state.detectionAgeMs) : String("null"));
  json += ",\"flashing\":" + String(state.flashing ? "true" : "false");
  json += ",\"liveFlashes\":" + String(state.liveFlashes);
  json += ",\"lastFlashMph\":" + String(state.lastFlashMph);
  json += ",\"lastFlashAge\":" + (state.liveFlashes ? String(state.lastFlashAgeMs) : String("null"));
  json += ",\"left\":" + String(state.left) + ",\"right\":" + String(state.right);
  json += ",\"peakMph\":" + String(state.peakMph) + ",\"writes\":" + String(state.displayWrites);
  json += ",\"bytes\":" + String(state.stats.bytesSeen) + ",\"valid\":" + String(state.stats.validFrames);
  json += ",\"empty\":" + String(state.stats.emptyFrames);
  json += ",\"errors\":" + String(state.stats.invalidLengths + state.stats.invalidPayloads + state.stats.invalidTrailers);
  json += ",\"simulated\":" + String(state.simulatedReports);
  json += ",\"targets\":" + targets(state.latestReport) + ",\"lastDetection\":" + targets(state.lastDetection);
  json += ",\"raw\":\"";
  for (uint8_t i = 0; i < state.rawCount; ++i) {
    char hex[4]; snprintf(hex, sizeof(hex), "%02X", state.raw[i]);
    if (i) json += ' ';
    json += hex;
  }
  json += "\",\"events\":[";
  for (uint8_t i = 0; i < state.eventCount; ++i) {
    if (i) json += ',';
    const auto &event = state.events[i];
    json += "{\"id\":" + String(event.sequence) + ",\"at\":" + String(event.atMs) + ",\"text\":" + quoted(event.text) + "}";
  }
  json += "],\"overLimitTotal\":" + String(state.overLimitTotal) + ",\"overLimit\":[";
  for (uint8_t i = 0; i < state.overLimitCount; ++i) {
    if (i) json += ',';
    const auto &event = state.overLimit[i];
    json += "{\"id\":" + String(event.sequence) + ",\"at\":" + String(event.atMs) + ",\"text\":" + quoted(event.text) + "}";
  }
  json += "]}";
  noCache(); server.send(200, "application/json", json);
}
void control() {
  noCache();
  // A custom header plus POST prevents a cross-origin page/form issuing commands.
  // The local network itself is protected by the AP password; no CORS is enabled.
  if (server.header("X-CheckIt-Control") != "1") {
    server.send(403, "application/json", "{\"error\":\"Open the radar dashboard to use controls\"}"); return;
  }
  if (!server.hasArg("command") || server.arg("command").length() > 4 ||
      !RadarDisplayAddon::executeCommand(server.arg("command").c_str(), millis())) {
    server.send(400, "application/json", "{\"error\":\"Invalid command or speed\"}"); return;
  }
  server.send(200, "application/json", "{\"ok\":true}");
}
}
void begin(bool stationEnabled) {
  const uint64_t mac = ESP.getEfuseMac();
  snprintf(ssid, sizeof(ssid), "CheckIt-Radar-%02X%02X", unsigned((mac >> 32) & 255), unsigned((mac >> 40) & 255));
  WiFi.persistent(false);
  WiFi.mode(stationEnabled ? WIFI_AP_STA : WIFI_AP);
  // ESP32-S3 requires modem sleep for Wi-Fi/BLE coexistence during setup.
  WiFi.setSleep(stationEnabled);
  WiFi.softAPConfig(IPAddress(192,168,4,1), IPAddress(192,168,4,1), IPAddress(255,255,255,0));
  ready = WiFi.softAP(ssid, password, 6, false, 2);
  if (!ready) return;  // Radar and display still run if AP startup fails.
  const char *headers[] = {"X-CheckIt-Control"};
  server.collectHeaders(headers, 1);
  server.on("/", HTTP_GET, [] { noCache(); server.send_P(200, "text/html; charset=utf-8", kRadarPhonePage); });
  server.on("/api/status", HTTP_GET, status);
  server.on("/api/control", HTTP_POST, control);
#ifdef CHECKIT_RADAR_CLOUD_ADDON
  server.on("/api/upload-now", HTTP_POST, [] {
    if(server.header("X-CheckIt-Control")!="1"){server.send(403,"application/json","{}");return;}
    server.send(RadarCloudAddon::uploadNow()?200:409,"application/json","{}");
  });
  server.on("/api/admin/reset-provisioning", HTTP_POST, [] {
    if(server.header("X-CheckIt-Control")!="1" || !RadarCloudAddon::resetSetup(server.arg("token"))) {
      server.send(403,"application/json","{}");return;
    }
    server.send(200,"application/json","{}");
  });
#endif
  server.onNotFound([] { server.send(404, "text/plain", "Not found"); });
  server.begin();
}
void update() { if (ready) server.handleClient(); }
void printConnectionInfo() {
  if (!Serial) return;
  if (ready) Serial.printf("[PHONE] Wi-Fi=%s password=%s dashboard=http://192.168.4.1/ (local only; no internet required)\n", ssid, password);
  else Serial.println("[PHONE] AP startup failed; radar/display still running");
}
} }
