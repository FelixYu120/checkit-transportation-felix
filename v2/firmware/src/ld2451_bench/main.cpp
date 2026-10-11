#include <Arduino.h>

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
  Serial.println("Listening for raw radar bytes (no frame parsing)...");
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

  while (radarSerial.available() > 0) {
    const int incoming = radarSerial.read();
    if (incoming < 0) {
      break;
    }

    printRadarByte(static_cast<uint8_t>(incoming));
    ++totalRadarBytes;
    lastRadarByteMs = millis();
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

  delay(1);
}
