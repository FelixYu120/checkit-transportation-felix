#pragma once

#include <Arduino.h>
#include <stdint.h>

#include "CheckItCore.h"

namespace CheckIt {

class Max7219Display {
 public:
  Max7219Display(
      int8_t dataPin,
      int8_t chipSelectPin,
      int8_t clockPin,
      uint8_t moduleCount,
      bool reverseModuleOrder);

  void begin(uint8_t intensity);
  void clear();
  void setIntensity(uint8_t intensity);
  void showSpeed(uint8_t speedKmh, Direction direction);
  void showTooFast(bool fastPage);
  void showIdle();

 private:
  static constexpr uint8_t kMaxModules = 8;

  int8_t dataPin_;
  int8_t chipSelectPin_;
  int8_t clockPin_;
  uint8_t moduleCount_;
  bool reverseModuleOrder_;
  uint8_t rows_[kMaxModules][8];

  void sendCommandAll(uint8_t address, uint8_t value);
  void flushRows();
  void setGlyph(uint8_t module, const uint8_t glyph[8]);
  uint8_t physicalModule(uint8_t logicalModule) const;
};

}  // namespace CheckIt
