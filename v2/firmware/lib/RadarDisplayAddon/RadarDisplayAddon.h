#pragma once
#include <stdint.h>
#include "Ld2451Protocol.h"

namespace CheckIt {
namespace RadarDisplayAddon {
constexpr uint8_t kPhoneEventCount = 32;
constexpr uint8_t kOverLimitEventCount = 128;
struct DiagnosticEvent { uint32_t sequence, atMs; char text[112]; };
struct Snapshot {
  const char *mode;
  Ld2451LinkState link;
  uint32_t uptimeMs, byteAgeMs, reportAgeMs, detectionAgeMs;
  bool hasBytes, hasReport, hasDetection, flashing;
  int left, right;
  uint8_t peakMph, limitKmh;
  uint32_t displayWrites, simulatedReports;
  uint32_t liveFlashes, lastFlashAgeMs;
  uint8_t lastFlashMph;
  Ld2451ParserStats stats;
  Ld2451Frame latestReport, lastDetection;
  uint8_t raw[64], rawCount, eventCount;
  DiagnosticEvent events[kPhoneEventCount];
  uint8_t overLimitCount;
  uint32_t overLimitTotal;
  DiagnosticEvent overLimit[kOverLimitEventCount];
};
void snapshot(Snapshot &out, uint32_t nowMs);
// Validated complete serial-style command; malformed input has no side effects.
bool executeCommand(const char *command, uint32_t nowMs);
void begin();
void configureLimit(uint8_t kmh);
void onSerialCommand(bool (*handler)(char));
void onLiveReport(void (*handler)(const Ld2451Frame &, uint32_t));
bool rawOutputEnabled();
// Observe a copy of a byte already read by the original bench.
void observeByte(uint8_t byte, uint32_t nowMs);
void update(uint32_t nowMs);
}  // namespace RadarDisplayAddon
}  // namespace CheckIt
