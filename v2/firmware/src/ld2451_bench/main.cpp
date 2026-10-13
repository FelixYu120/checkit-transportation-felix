#include <Arduino.h>
#ifdef CHECKIT_RADAR_CLOUD_ADDON
#include "RadarCloudAddon.h"
#endif
#ifdef CHECKIT_RADAR_DISPLAY_ADDON
#include "RadarDisplayAddon.h"
#include "RadarPhoneDashboard.h"
#endif

namespace {

constexpr uint32_t kUsbBaud = 115200;
constexpr uint32_t kRadarBaud = 115200;
constexpr int8_t kRadarRxPin = 16;
constexpr int8_t kRadarTxPin = 17;
constexpr uint32_t kWaitingIntervalMs = 2000;
constexpr uint8_t kBytesPerLine = 16;

HardwareSerial radarSerial(2);

uint32_t totalRadarBytes = 0;
uint32_t lastRadarByteMs = 0;
uint32_t lastWaitingMessageMs = 0;
uint8_t bytesOnCurrentLine = 0;
bool bannerPrinted = false;

void printBanner() {
  Serial.println();
  Serial.println("============================================================");
  Serial.println("Check-It Transportation V2 - HLK-LD2451 UART bench");
  Serial.println("USB diagnostics: 115200 baud");
  Serial.println("Radar UART2: 115200 8N1, RX=GPIO16, TX=GPIO17");
  Serial.println("Expected empty frame: F4 F3 F2 F1 00 00 F8 F7 F6 F5");
#ifdef CHECKIT_RADAR_DISPLAY_ADDON
  Serial.println("[DISPLAY ADDON v19] DATA21 LATCH47 CLOCK48; display clock~1 kHz; normal >=8 mph automatic at boot; single report; no rearm wait; peak mph; no startup flash");
  Serial.println("[CONTROL] a=easy test >3 km/h / return to normal; c=normal; b=blank/pause; 8=hold 88; 6=hold 66; 1/2=one digit; n42 then Enter=hold 42");
  Serial.println("[SIM] t18 then Enter=simulate 18 km/h; t0=empty report; c=return to live radar");
  Serial.println("[RADAR LOG] decoded speed/EMPTY; r=raw, e=empty reports, s=status, h=help; phone dashboard on local Wi-Fi");
  CheckIt::RadarPhoneDashboard::printConnectionInfo();
#ifdef CHECKIT_RADAR_CLOUD_ADDON
  Serial.println("[CONNECTED v19] logistics BLE setup + cloud; app threshold after provisioning; diagnostic controls retained");
#endif
#else
  Serial.println("Listening for raw radar bytes (no frame parsing)...");
#endif
  Serial.println("============================================================");
}

void printRadarByte(uint8_t value) {
  if (bytesOnCurrentLine > 0) {
    Serial.print(' ');
  }

  Serial.printf("%02X", value);
  ++bytesOnCurrentLine;

  if (bytesOnCurrentLine == kBytesPerLine) {
    Serial.println();
    bytesOnCurrentLine = 0;
  }
}

void finishPartialHexLine() {
  if (bytesOnCurrentLine > 0) {
    Serial.println();
    bytesOnCurrentLine = 0;
  }
}

}  // namespace

void setup() {
  Serial.begin(kUsbBaud);
  radarSerial.begin(
      kRadarBaud,
      SERIAL_8N1,
      kRadarRxPin,
      kRadarTxPin);
#ifdef CHECKIT_RADAR_DISPLAY_ADDON
  CheckIt::RadarDisplayAddon::begin();
#ifdef CHECKIT_RADAR_CLOUD_ADDON
  CheckIt::RadarCloudAddon::begin();
  CheckIt::RadarPhoneDashboard::begin(true);
  CheckIt::RadarCloudAddon::connect();
#else
  CheckIt::RadarPhoneDashboard::begin();
#endif
#endif

  const uint32_t nowMs = millis();
  lastRadarByteMs = nowMs;
  lastWaitingMessageMs = nowMs;

  // Do not wait for the USB monitor. If it is already open, show the banner
  // now; otherwise loop() prints it as soon as the Mac opens the CDC port.
  if (Serial) {
    printBanner();
    bannerPrinted = true;
  }
}

void loop() {
  if (!bannerPrinted && Serial) {
    printBanner();
    bannerPrinted = true;
  }

  // Bound each batch so continuous input cannot starve display transitions.
  // Bytes left in the UART buffer are consumed on the next loop.
  const uint32_t batchStartedMs = millis();
  unsigned batchBytes = 0;
  while (radarSerial.available() > 0 && batchBytes < 128 &&
         static_cast<uint32_t>(millis() - batchStartedMs) < 5) {
    ++batchBytes;
    const int incoming = radarSerial.read();
    if (incoming < 0) {
      break;
    }

#ifdef CHECKIT_RADAR_DISPLAY_ADDON
    if (CheckIt::RadarDisplayAddon::rawOutputEnabled())
      printRadarByte(static_cast<uint8_t>(incoming));
    else
      finishPartialHexLine();
#else
    printRadarByte(static_cast<uint8_t>(incoming));
#endif
    ++totalRadarBytes;
    lastRadarByteMs = millis();
#ifdef CHECKIT_RADAR_DISPLAY_ADDON
    CheckIt::RadarDisplayAddon::observeByte(static_cast<uint8_t>(incoming), lastRadarByteMs);
#endif
  }

  const uint32_t nowMs = millis();
  const bool radarIsQuiet =
      static_cast<uint32_t>(nowMs - lastRadarByteMs) >= kWaitingIntervalMs;
  const bool waitingMessageIsDue =
      static_cast<uint32_t>(nowMs - lastWaitingMessageMs) >=
      kWaitingIntervalMs;

  if (radarIsQuiet && waitingMessageIsDue) {
    finishPartialHexLine();
    Serial.printf(
        "[WAIT] No radar bytes for 2 seconds; total received: %lu\n",
        static_cast<unsigned long>(totalRadarBytes));
    lastWaitingMessageMs = nowMs;
  }

#ifdef CHECKIT_RADAR_DISPLAY_ADDON
  CheckIt::RadarDisplayAddon::update(nowMs);
  CheckIt::RadarPhoneDashboard::update();
#endif
#ifdef CHECKIT_RADAR_CLOUD_ADDON
  CheckIt::RadarCloudAddon::update(millis());
#endif
#ifdef CHECKIT_RADAR_DISPLAY_ADDON
  CheckIt::RadarDisplayAddon::update(millis());
#endif
  delay(1);
}
