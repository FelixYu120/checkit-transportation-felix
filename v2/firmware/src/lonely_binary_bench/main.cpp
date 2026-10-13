#include <Arduino.h>
#include "CheckItConfig.h"

namespace {
constexpr int kData = CHECKIT_SPEED_DISPLAY_DATA_PIN;
constexpr int kLatch = CHECKIT_SPEED_DISPLAY_LATCH_PIN;
constexpr int kClock = CHECKIT_SPEED_DISPLAY_CLOCK_PIN;

// Explicit slow MSB-first clocking, independent of the production display
// library. The first byte travels to #2; the second stays in #1.
void sendByte(uint8_t pattern) {
  for (int bit = 7; bit >= 0; --bit) {
    digitalWrite(kClock, LOW);
    digitalWrite(kData, (pattern & (1U << bit)) ? HIGH : LOW);
    delayMicroseconds(10);
    digitalWrite(kClock, HIGH);
    delayMicroseconds(10);
  }
  digitalWrite(kClock, LOW);
}

void writeChain(uint8_t farPattern, uint8_t nearPattern) {
  digitalWrite(kLatch, LOW);
  sendByte(farPattern);
  sendByte(nearPattern);
  digitalWrite(kLatch, HIGH);
  delayMicroseconds(10);
  digitalWrite(kLatch, LOW);
}

void holdPattern(const char *label, uint8_t farPattern, uint8_t nearPattern,
                 uint32_t durationMs = 3000) {
  Serial.printf("[DISPLAY BENCH] %s; #2=0x%02X #1=0x%02X\n",
                label, farPattern, nearPattern);
  const uint32_t started = millis();
  do {
    writeChain(farPattern, nearPattern);
    delay(100);
  } while (static_cast<uint32_t>(millis() - started) < durationMs);
}
}

void setup() {
  Serial.begin(115200);
  pinMode(kData, OUTPUT);
  pinMode(kLatch, OUTPUT);
  pinMode(kClock, OUTPUT);
  digitalWrite(kData, LOW);
  digitalWrite(kLatch, LOW);
  digitalWrite(kClock, LOW);
  writeChain(0, 0);
  delay(1000);
  Serial.printf("[DISPLAY BENCH] H606 DATA=%d LATCH=%d CLOCK=%d\n",
                kData, kLatch, kClock);
  Serial.println("[DISPLAY BENCH] no radar/Wi-Fi; sequence repeats intentionally");
}

void loop() {
  holdPattern("BOTH BLANK", 0x00, 0x00);
  holdPattern("#1 ONLY: 8; #2 blank", 0x00, 0x7F);
  holdPattern("BOTH BLANK", 0x00, 0x00, 1000);
  holdPattern("#2 ONLY: 8; #1 blank", 0x7F, 0x00);
  holdPattern("BOTH: 88; decimal points OFF", 0x7F, 0x7F);
  for (int flash = 0; flash < 5; ++flash) {
    holdPattern("BOTH: 66", 0x7D, 0x7D, 300);
    holdPattern("BOTH BLANK", 0x00, 0x00, 300);
  }
  holdPattern("BOTH BLANK (end of cycle)", 0x00, 0x00);
}
