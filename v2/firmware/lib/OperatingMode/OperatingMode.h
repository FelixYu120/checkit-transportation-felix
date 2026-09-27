#pragma once

#include <stdint.h>

namespace CheckIt {

enum class OperatingMode : uint8_t {
  ROADSIDE_OBSERVATION = 0,
  RADAR_WARNING = 1,
  FLASHING_WARNING = 2,
  LEGACY_DISTANCE_ROUTED_WARNING = 3,
};

const char *operatingModeName(OperatingMode mode);
bool parseOperatingMode(const char *value, OperatingMode &mode);
bool operatingModeHasWarnings(OperatingMode mode);
bool operatingModeUsesEspNow(OperatingMode mode);
bool operatingModeUsesLocalOutput(OperatingMode mode);
bool operatingModeIsPersistable(OperatingMode mode);

}  // namespace CheckIt
