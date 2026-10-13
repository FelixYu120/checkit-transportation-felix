#include "RadarDisplayAddon.h"
#include <Arduino.h>
#include <string.h>
#include <stdarg.h>
#include <stdio.h>
#include "Ld2451Protocol.h"
#include "LonelyBinaryDisplay.h"
#include "SpeedDisplayPolicy.h"


namespace CheckIt {
namespace RadarDisplayAddon {
namespace {
// Only display GPIOs are driven here. No UART object, sensor commands, or radio.
// 500 us LOW + 500 us HIGH: approximately 1 kHz, 16.5 ms per two-digit write.
LonelyBinaryDisplay display(21, 47, 48, false, 500);
Ld2451Parser observer;
SpeedDisplayState flash(2000, 300);
// Every target in a valid report can trigger; hold the fastest speed per window.
constexpr uint8_t kLimitMph = 8;
uint8_t configuredLimitKmh = 0;
bool (*serialHandler)(char) = nullptr;
void (*liveReportHandler)(const Ld2451Frame &, uint32_t) = nullptr;
constexpr uint8_t kEasyLimitKmh = 3;
bool rawOutput = false, logEmptyReports = true;
enum class DisplayMode { NORMAL, EASY_TEST, MANUAL, SIMULATION };
// Battery operation needs no USB command. Easy mode is opt-in and not persisted.
DisplayMode mode = DisplayMode::NORMAL;
int manualLeft = -1, manualRight = -1, lastLeft = -1, lastRight = -1;
uint32_t lastRefreshMs = 0, displayWrites = 0;
bool enteringNumber = false, invalidNumber = false, enteringSimulation = false;
uint8_t numberDigits = 0;
uint16_t enteredNumber = 0;
uint32_t simulatedReports = 0;
uint32_t liveFlashes = 0, lastFlashMs = 0;
uint8_t lastFlashMph = 0;
uint32_t lastByteMs = 0, lastReportMs = 0, lastDetectionMs = 0;
bool hasBytes = false, hasReport = false, hasDetection = false;
Ld2451Frame latestReport{}, lastDetection{};
uint8_t rawBytes[64]{}, rawHead = 0, rawCount = 0;
DiagnosticEvent events[kPhoneEventCount]{};
uint8_t eventHead = 0, eventCount = 0;
uint32_t eventSequence = 0;
DiagnosticEvent overLimitEvents[kOverLimitEventCount]{};
uint8_t overLimitHead = 0, overLimitCount = 0;
uint32_t overLimitTotal = 0;
void recordEvent(const char *format, ...) {
  DiagnosticEvent &event = events[eventHead];
  event.sequence = ++eventSequence;
  event.atMs = millis();
  va_list args; va_start(args, format);
  vsnprintf(event.text, sizeof(event.text), format, args);
  va_end(args);
  eventHead = (eventHead + 1) % kPhoneEventCount;
  if (eventCount < kPhoneEventCount) ++eventCount;
}

void handleFrame(const Ld2451Frame &frame, uint32_t nowMs);

bool automatic() { return mode != DisplayMode::MANUAL; }
const char *modeName() {
  return mode == DisplayMode::NORMAL ? "normal"
      : mode == DisplayMode::EASY_TEST ? "easy_test"
      : mode == DisplayMode::SIMULATION ? "simulation" : "manual";
}
bool meetsCurrentLimit(uint8_t speedKmh) {
  return mode == DisplayMode::EASY_TEST ? speedKmh > kEasyLimitKmh
      : configuredLimitKmh ? speedKmh >= configuredLimitKmh
      : uint32_t(speedKmh) * 1000000UL >= uint32_t(kLimitMph) * 1609344UL;
}

// Dedicated live-only history: empty reports and manual tests cannot evict it.
void recordOverLimit(const Ld2451Frame &frame, uint32_t nowMs) {
  for (uint8_t i = 0; i < frame.targetCount; ++i) {
    const auto &target = frame.targets[i];
    if (!meetsCurrentLimit(target.speedKmh)) continue;
    auto &event = overLimitEvents[overLimitHead];
    event.sequence = ++overLimitTotal; event.atMs = nowMs;
    char limit[24];
    if (mode == DisplayMode::EASY_TEST) snprintf(limit,sizeof(limit),">3 km/h");
    else if (configuredLimitKmh) snprintf(limit,sizeof(limit),">=%u km/h",configuredLimitKmh);
    else snprintf(limit,sizeof(limit),">=8 mph");
    const char *decision = mode == DisplayMode::MANUAL ? "SKIPPED manual hold"
        : mode == DisplayMode::SIMULATION ? "SKIPPED simulation"
        : flash.active() ? "FLASH requested" : "ERROR no flash requested";
    snprintf(event.text,sizeof(event.text),"%.1f mph (%u km/h), %s, %u m | %s %s | %s; peak %u mph",
        target.speedKmh/1.609344,target.speedKmh,directionName(target.direction),target.distanceM,
        modeName(),limit,decision,flash.speedMph());
    overLimitHead = (overLimitHead + 1) % kOverLimitEventCount;
    if (overLimitCount < kOverLimitEventCount) ++overLimitCount;
  }
}

void writeRequestedDigits(int left, int right) {
  display.showDigits(left, right);
  lastLeft = left;
  lastRight = right;
  ++displayWrites;
  lastRefreshMs = millis();  // Avoid an immediate duplicate periodic write.
}

void printHelp() {
  if (!Serial) return;
  Serial.println("\n[CONTROL] b=blank/pause radar alerts; 8=hold 88; 6=hold 66; 1=near #1 only; 2=far #2 only");
  Serial.println("[CONTROL] n42 then Enter=hold any number 00-99; a=toggle easy test/normal; c=resume normal; s=status");
  if (configuredLimitKmh) Serial.printf("[SIGN] app limit >=%u km/h (%.1f mph); single report; peak mph; 2-second flash\n", configuredLimitKmh, configuredLimitKmh / 1.609344);
  else Serial.printf("[SIGN] normal >=%u mph starts automatically at boot; easy test >%u km/h only after a; single report; peak mph; 2-second flash; no rearm wait\n", kLimitMph, kEasyLimitKmh);
  Serial.println("[SIM] t18 then Enter=simulate 18 km/h (11 mph); range 0-120 km/h; live radar alerts paused until c");
  Serial.println("[LOG] r=toggle raw; e=toggle empty reports; h=help. No startup animation.");
}

void printStatus() {
  if (!Serial) return;
  const Ld2451ParserStats &stats = observer.stats();
  Serial.printf("\n[STATUS] mode=%s requested_left=%d requested_right=%d radar_alert=%s valid_reports=%lu empty_reports=%lu bad_length=%lu bad_payload=%lu bad_trailer=%lu display_writes=%lu raw=%s empty_logging=%s peak_mph=%u simulated_reports=%lu\n",
      modeName(), lastLeft, lastRight,
      automatic() && flash.active() ? "flashing" : "off",
      static_cast<unsigned long>(stats.validFrames),
      static_cast<unsigned long>(stats.emptyFrames),
      static_cast<unsigned long>(stats.invalidLengths),
      static_cast<unsigned long>(stats.invalidPayloads),
      static_cast<unsigned long>(stats.invalidTrailers),
      static_cast<unsigned long>(displayWrites), rawOutput ? "on" : "off",
      logEmptyReports ? "on" : "off", flash.speedMph(),
      static_cast<unsigned long>(simulatedReports));
  Serial.printf("[FLASH HISTORY] live_flashes=%lu last_peak_mph=%u (commands sent, not LED feedback)\n",
      static_cast<unsigned long>(liveFlashes), lastFlashMph);
}

void setManual(int left, int right) {
  enteringNumber = false;
  mode = DisplayMode::MANUAL;
  flash = SpeedDisplayState(2000, 300);  // Cancel any alert immediately.
  manualLeft = left;
  manualRight = right;
  writeRequestedDigits(left, right);  // Force a fresh write even if already blank.
  recordEvent("Manual: left=%d right=%d; live alerts paused", left, right);
  if (Serial) Serial.printf("\n[CONTROL] manual hold: left=%d right=%d (-1=blank); radar alerts paused\n", left, right);
}

void setAutomaticMode(DisplayMode next) {
  enteringNumber = false;
  mode = next;
  flash = SpeedDisplayState(2000, 300);
  manualLeft = manualRight = -1;
  writeRequestedDigits(-1, -1);
  recordEvent("Mode: %s; live alerts enabled", modeName());
  if (!Serial) return;
  if (mode == DisplayMode::NORMAL && configuredLimitKmh) {
    Serial.printf("[CONTROL] normal automatic: app limit >=%u km/h (%.1f mph); peak mph; 2-second flash\n", configuredLimitKmh, configuredLimitKmh / 1.609344);
    return;
  }
  if (mode == DisplayMode::EASY_TEST)
    Serial.printf("\n[CONTROL] easy test enabled: single report speed >%u km/h; peak mph; flash 2 seconds; a returns to normal\n", kEasyLimitKmh);
  else
    Serial.printf("\n[CONTROL] normal automatic enabled: single report speed >=%u mph; peak mph; flash 2 seconds; a=easy test, b=pause\n", kLimitMph);
}

void simulateSpeed(uint8_t speedKmh, uint32_t nowMs) {
  // Separate parser state prevents a test from corrupting a partially received
  // real UART frame. Both decoded frames use handleFrame below.
  Ld2451Parser simulationParser;
  Ld2451Frame frame{};
  const uint8_t target[] = {0xF4, 0xF3, 0xF2, 0xF1, 7, 0, 1, 1,
      0x80, 10, 1, speedKmh, 100, 0xF8, 0xF7, 0xF6, 0xF5};
  const uint8_t empty[] = {0xF4, 0xF3, 0xF2, 0xF1, 0, 0, 0xF8, 0xF7, 0xF6, 0xF5};
  const uint8_t *bytes = speedKmh ? target : empty;
  const size_t length = speedKmh ? sizeof(target) : sizeof(empty);
  Ld2451ParseResult result = LD2451_IN_PROGRESS;
  for (size_t i = 0; i < length; ++i) result = simulationParser.push(bytes[i], frame);
  if (result != LD2451_FRAME_READY) {
    if (Serial) Serial.println("[SIM] frame rejected; display stays blank");
    return;
  }
  ++simulatedReports;
  recordEvent("SIM: %u km/h -> %u mph; expected %s", speedKmh, SpeedDisplayState::mph(speedKmh), meetsCurrentLimit(speedKmh) ? "FLASH" : "BLANK");
  if (Serial) Serial.printf("[SIM] parsed synthetic report: %u km/h (%.1f mph); expected=%s; rounded display=%u; live radar alerts paused, c=normal\n",
      speedKmh, speedKmh / 1.609344, meetsCurrentLimit(speedKmh) ? "FLASH" : "BLANK",
      SpeedDisplayState::mph(speedKmh));
  handleFrame(frame, nowMs);
}

void handleCommand(int command, uint32_t nowMs) {
  if (enteringNumber) {
    if (command >= '0' && command <= '9') {
      if (numberDigits < (enteringSimulation ? 3 : 2)) {
        enteredNumber = enteredNumber * 10 + command - '0';
        ++numberDigits;
      } else invalidNumber = true;
      return;
    }
    if (command == ' ') return;
    if (command == '\r' || command == '\n') {
      enteringNumber = false;
      if (!invalidNumber && numberDigits > 0 && enteredNumber <= (enteringSimulation ? 120 : 99)) {
        if (enteringSimulation) simulateSpeed(static_cast<uint8_t>(enteredNumber), nowMs);
        else setManual(enteredNumber / 10, enteredNumber % 10);
      } else if (Serial) Serial.println("\n[CONTROL] invalid number; use t0-t120 for km/h or n0-n99 for digits; staying blank");
      return;
    }
    // Control letters cancel entry; punctuation such as a minus or decimal
    // invalidates the whole number instead of executing its digits as commands.
    if (command == 0 || strchr("bBcCaAnNtTrReEhHsS?", command) == nullptr) {
      invalidNumber = true;
      return;
    }
    enteringNumber = false;
  }
  if (command == 'b' || command == 'B') {
    setManual(-1, -1);
  } else if (command == '8') {
    setManual(8, 8);
  } else if (command == '6') {
    setManual(6, 6);
  } else if (command == '1') {
    setManual(-1, 8);  // Near #1, normally the physical right digit.
  } else if (command == '2') {
    setManual(8, -1);  // Far #2, normally the physical left digit.
  } else if (command == 'n' || command == 'N' || command == 't' || command == 'T') {
    setManual(-1, -1);
    enteringNumber = true;
    enteringSimulation = command == 't' || command == 'T';
    if (enteringSimulation) mode = DisplayMode::SIMULATION;
    invalidNumber = false;
    numberDigits = 0;
    enteredNumber = 0;
    if (Serial) Serial.println(enteringSimulation
        ? "[SIM] enter 0-120 km/h, then Enter; normal configured threshold; c resumes live alerts"
        : "[CONTROL] enter 0-99, then Enter; b cancels");
  } else if (command == 'a' || command == 'A') {
    setAutomaticMode(mode == DisplayMode::EASY_TEST
        ? DisplayMode::NORMAL : DisplayMode::EASY_TEST);
  } else if (command == 'c' || command == 'C') {
    setAutomaticMode(DisplayMode::NORMAL);
  } else if (command == 's' || command == 'S') {
    printStatus();
  } else if (command == 'r' || command == 'R') {
    rawOutput = !rawOutput;
    if (Serial) Serial.printf("\n[LOG] raw=%s; radar decoding continues\n", rawOutput ? "on" : "off");
  } else if (command == 'e' || command == 'E') {
    logEmptyReports = !logEmptyReports;
    if (Serial) Serial.printf("\n[LOG] decoded empty reports=%s\n", logEmptyReports ? "on" : "off");
  } else if (command == 'h' || command == 'H' || command == '?') {
    printHelp();
  } else if (command == 'd' || command == 'D' || command == 'p' || command == 'P') {
    if (Serial) Serial.println("\n[CONTROL] startup/pin tests disabled; use b, 8, 1, 2, or n42 instead");
  }
}

void handleFrame(const Ld2451Frame &frame, uint32_t nowMs) {
  if (!automatic()) {
    if (Serial && !rawOutput) {
      for (uint8_t i = 0; i < frame.targetCount; ++i) {
        if (meetsCurrentLimit(frame.targets[i].speedKmh)) {
          Serial.println("[SIGN SKIP] manual hold; send c to resume automatic flashes");
          break;
        }
      }
    }
    return;
  }
  flash.value(nowMs);  // Expire the old window before selecting a new target.
  RadarTarget candidate{};
  bool found = false;
  for (uint8_t i = 0; i < frame.targetCount; ++i) {
    const RadarTarget &reported = frame.targets[i];
    if (meetsCurrentLimit(reported.speedKmh) &&
        (!found || reported.speedKmh > candidate.speedKmh ||
         (reported.speedKmh == candidate.speedKmh && reported.distanceM < candidate.distanceM))) {
      // No history, association, median or minimum observation time is required.
      candidate = reported;
      found = true;
    }
  }
  if (found) {
    flash.qualifiedTarget(nowMs);
    // Keep the current window's timing. Once it ends, any new above-limit
    // report starts a fresh window immediately, even amid continuous traffic.
    const bool started = !flash.active() && flash.start(candidate.speedKmh, nowMs, true);
    const bool changed = !started && flash.updatePeakSpeed(candidate.speedKmh, nowMs);
    // Commit the first ON phase before logging/cloud work or returning to the
    // main loop. Peak updates preserve the existing ON/OFF phase and deadline.
    if (started || changed) {
      const int value = flash.value(nowMs);
      writeRequestedDigits(value < 0 ? -1 : value / 10,
                           value < 0 ? -1 : value % 10);
      if (mode != DisplayMode::SIMULATION) {
        if (started) { ++liveFlashes; lastFlashMs = millis(); }
        lastFlashMph = flash.speedMph();
      }
    }
    if (started || changed) recordEvent("%s: %u km/h -> %u mph (%s)",
        mode == DisplayMode::SIMULATION ? "SIM sign" : "Radar sign",
        candidate.speedKmh, flash.speedMph(), started ? "first digits sent" : "peak updated");
    if (Serial && !rawOutput) {
      if (started)
        Serial.printf("[SIGN] %u km/h -> %u mph; peak speed; flash for 2 seconds, then blank\n",
            candidate.speedKmh, flash.speedMph());
      else if (changed)
        Serial.printf("[SIGN] peak updated: %u km/h -> %u mph; original flash deadline unchanged\n",
            candidate.speedKmh, flash.speedMph());
    }
  }
}

void printReport(const Ld2451Frame &frame) {
  if (!Serial || rawOutput) return;
  if (frame.reportedTargetCount == 0) {
    if (logEmptyReports) Serial.println("[RADAR] EMPTY: valid report, no target");
    return;
  }
  // These are decoded sensor measurements, before the display speed threshold.
  for (uint8_t i = 0; i < frame.targetCount; ++i) {
    const RadarTarget &target = frame.targets[i];
    Serial.printf("[RADAR] target=%u speed=%u km/h (%.1f mph) direction=%s distance=%u m angle=%d deg SNR=%u\n",
        i + 1, target.speedKmh, target.speedKmh / 1.609344,
        directionName(target.direction), target.distanceM, target.angleDeg, target.snr);
  }
  if (frame.truncated) Serial.printf("[RADAR] %u targets reported; showing first %u\n",
      frame.reportedTargetCount, frame.targetCount);
}
}  // namespace

void begin() {
  mode = DisplayMode::NORMAL;
  enteringNumber = false;
  manualLeft = manualRight = lastLeft = lastRight = -1;
  flash = SpeedDisplayState(2000, 300);
  liveFlashes = lastFlashMs = lastFlashMph = 0;
  display.begin();  // Blank at boot; normal radar alerts are already enabled.
  ++displayWrites;
}

void onSerialCommand(bool (*handler)(char)) { serialHandler = handler; }
void configureLimit(uint8_t kmh) { configuredLimitKmh = kmh; }
void onLiveReport(void (*handler)(const Ld2451Frame &, uint32_t)) { liveReportHandler = handler; }

void snapshot(Snapshot &out, uint32_t nowMs) {
  out.limitKmh = configuredLimitKmh;
  out.mode = modeName(); out.uptimeMs = nowMs;
  out.hasBytes = hasBytes; out.hasReport = hasReport; out.hasDetection = hasDetection;
  out.byteAgeMs = nowMs - lastByteMs; out.reportAgeMs = nowMs - lastReportMs;
  out.detectionAgeMs = nowMs - lastDetectionMs;
  out.link = classifyLd2451Link(hasReport, out.reportAgeMs, latestReport.reportedTargetCount,
      hasBytes, out.byteAgeMs, 3000);
  out.flashing = automatic() && flash.active(); out.left = lastLeft; out.right = lastRight;
  out.peakMph = flash.speedMph(); out.displayWrites = displayWrites;
  out.simulatedReports = simulatedReports; out.stats = observer.stats();
  out.liveFlashes = liveFlashes; out.lastFlashAgeMs = nowMs - lastFlashMs;
  out.lastFlashMph = lastFlashMph;
  out.latestReport = latestReport; out.lastDetection = lastDetection;
  out.rawCount = rawCount;
  for (uint8_t i = 0; i < rawCount; ++i)
    out.raw[i] = rawBytes[(rawHead + sizeof(rawBytes) - rawCount + i) % sizeof(rawBytes)];
  out.overLimitCount = overLimitCount; out.overLimitTotal = overLimitTotal;
  for (uint8_t i = 0; i < overLimitCount; ++i)
    out.overLimit[i] = overLimitEvents[(overLimitHead + kOverLimitEventCount - overLimitCount + i) % kOverLimitEventCount];
  out.eventCount = eventCount;
  for (uint8_t i = 0; i < eventCount; ++i)
    out.events[i] = events[(eventHead + kPhoneEventCount - eventCount + i) % kPhoneEventCount];
}

bool executeCommand(const char *command, uint32_t nowMs) {
  if (!command) return false;
  const size_t length = strlen(command);
  if (length == 1 && strchr("cbaer8612", command[0])) {
    enteringNumber = false;
    handleCommand(command[0], nowMs);
    return true;
  }
  if (length < 2 || length > 4 || (command[0] != 't' && command[0] != 'n')) return false;
  unsigned value = 0;
  for (size_t i = 1; i < length; ++i) {
    if (command[i] < '0' || command[i] > '9') return false;
    value = value * 10 + command[i] - '0';
  }
  if ((command[0] == 't' && value > 120) ||
      (command[0] == 'n' && (value > 99 || length > 3))) return false;
  enteringNumber = false;
  for (size_t i = 0; i < length; ++i) handleCommand(command[i], nowMs);
  handleCommand('\n', nowMs);
  return true;
}

bool rawOutputEnabled() { return rawOutput; }

void observeByte(uint8_t byte, uint32_t nowMs) {
  hasBytes = true; lastByteMs = nowMs;
  rawBytes[rawHead] = byte; rawHead = (rawHead + 1) % sizeof(rawBytes);
  if (rawCount < sizeof(rawBytes)) ++rawCount;
  Ld2451Frame frame{};
  if (observer.push(byte, frame) != LD2451_FRAME_READY) return;
  hasReport = true; lastReportMs = nowMs; latestReport = frame;
  if (frame.targetCount) {
    hasDetection = true; lastDetectionMs = nowMs; lastDetection = frame;
    uint8_t fastest = 0;
    for (uint8_t i = 1; i < frame.targetCount; ++i)
      if (frame.targets[i].speedKmh > frame.targets[fastest].speedKmh) fastest = i;
    const RadarTarget &target = frame.targets[fastest];
    recordEvent("RADAR: %u target(s); fastest %u km/h (%.1f mph), %s, %u m%s",
        frame.reportedTargetCount, target.speedKmh, target.speedKmh / 1.609344,
        directionName(target.direction), target.distanceM,
        mode == DisplayMode::SIMULATION || mode == DisplayMode::MANUAL ? "; alerts paused" : "");
  } else if (logEmptyReports) recordEvent("RADAR: EMPTY; valid report, no target");
  // Live traffic remains decoded/logged, but cannot disturb the display test.
  if (mode != DisplayMode::SIMULATION) handleFrame(frame, nowMs);
  recordOverLimit(frame, nowMs);
  if (liveReportHandler) liveReportHandler(frame, nowMs);
  printReport(frame);
}

void update(uint32_t nowMs) {
  if (Serial.available() > 0) {
    const char c = Serial.read();
    if (!serialHandler || !serialHandler(c)) handleCommand(c, nowMs);
  }
  nowMs = millis();  // Commands can write digits or run other handlers.
  const bool wasActive = flash.active();
  const int value = automatic() ? flash.value(nowMs) : -1;
  const int left = automatic() ? (value < 0 ? -1 : value / 10) : manualLeft;
  const int right = automatic() ? (value < 0 ? -1 : value % 10) : manualRight;
  if (left != lastLeft || right != lastRight) {
    writeRequestedDigits(left, right);
    if (Serial && !rawOutput)
      Serial.printf("[SIGN TX] mode=%s left=%d right=%d (-1=blank)\n",
          modeName(), left, right);
  }
  if (automatic() && wasActive && !flash.active() && Serial && !rawOutput)
    Serial.println("[SIGN] alert finished; blank");
  if (static_cast<uint32_t>(millis() - lastRefreshMs) >= 100) {
    display.refresh();
    lastRefreshMs = millis();
    ++displayWrites;
  }
}
}  // namespace RadarDisplayAddon
}  // namespace CheckIt
