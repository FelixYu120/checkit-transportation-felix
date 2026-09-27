#pragma once

#include <stdint.h>

namespace CheckIt {

enum Direction : uint8_t {
  DIR_UNKNOWN = 0,
  DIR_APPROACH = 1,
  DIR_AWAY = 2
};

enum WarningLevel : uint8_t {
  WARN_NONE = 0,
  WARN_INFO = 1,
  WARN_DANGER = 2,
  WARN_EMERGENCY = 3
};

struct RadarTarget {
  uint8_t targetIndex;
  int8_t angleDeg;
  uint8_t distanceM;
  Direction direction;
  uint8_t speedKmh;
  uint8_t snr;
};

inline const char *directionName(Direction direction) {
  switch (direction) {
    case DIR_APPROACH:
      return "approach";
    case DIR_AWAY:
      return "away";
    default:
      return "unknown";
  }
}

}  // namespace CheckIt
