#pragma once

#include <Arduino.h>
#include <stdint.h>

#include "CheckItCore.h"
#include "Max7219Display.h"

namespace CheckIt {

class WarningOutputs {
 public:
  WarningOutputs(
      int8_t matrixDataPin,
      int8_t matrixChipSelectPin,
      int8_t matrixClockPin,
      uint8_t matrixModuleCount,
      bool reverseModuleOrder,
      int8_t speakerPin,
      int8_t statusLedPin,
      bool matrixEnabled,
      bool speakerEnabled);

  void begin(uint8_t matrixIntensity);
  void start(
      uint8_t speedKmh,
      Direction direction,
      WarningLevel level,
      uint16_t durationMs,
      uint32_t nowMs);
  void stop();
  void update(uint32_t nowMs);
  bool active(uint32_t nowMs) const;

 private:
  Max7219Display display_;
  int8_t speakerPin_;
  int8_t statusLedPin_;
  bool matrixEnabled_;
  bool speakerEnabled_;
  bool outputOn_;
  bool tooFastSecondPage_;
  uint8_t speedKmh_;
  Direction direction_;
  WarningLevel level_;
  uint32_t untilMs_;
  uint32_t lastToggleMs_;

  uint16_t blinkIntervalMs() const;
  uint16_t speakerFrequencyHz() const;
  void setOutput(bool on);
};

}  // namespace CheckIt
