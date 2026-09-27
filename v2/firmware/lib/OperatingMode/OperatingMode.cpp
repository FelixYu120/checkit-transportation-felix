#include "OperatingMode.h"

#include <string.h>

namespace CheckIt {

const char *operatingModeName(OperatingMode mode) {
  switch (mode) {
    case OperatingMode::ROADSIDE_OBSERVATION:
      return "roadside_observation";
    case OperatingMode::RADAR_WARNING:
      return "radar_warning";
    case OperatingMode::FLASHING_WARNING:
      return "flashing_warning";
    case OperatingMode::LEGACY_DISTANCE_ROUTED_WARNING:
      return "legacy_distance_routed_warning";
    default:
      return "unknown";
  }
}

bool parseOperatingMode(const char *value, OperatingMode &mode) {
  if (value == nullptr) {
    return false;
  }
  if (strcmp(value, "roadside_observation") == 0) {
    mode = OperatingMode::ROADSIDE_OBSERVATION;
    return true;
  }
  if (strcmp(value, "radar_warning") == 0) {
    mode = OperatingMode::RADAR_WARNING;
    return true;
  }
  if (strcmp(value, "flashing_warning") == 0) {
    mode = OperatingMode::FLASHING_WARNING;
    return true;
  }
  return false;
}

bool operatingModeHasWarnings(OperatingMode mode) {
  return mode != OperatingMode::ROADSIDE_OBSERVATION;
}

bool operatingModeUsesEspNow(OperatingMode mode) {
  return mode == OperatingMode::FLASHING_WARNING ||
      mode == OperatingMode::LEGACY_DISTANCE_ROUTED_WARNING;
}

bool operatingModeUsesLocalOutput(OperatingMode mode) {
  return mode == OperatingMode::RADAR_WARNING ||
      mode == OperatingMode::LEGACY_DISTANCE_ROUTED_WARNING;
}

bool operatingModeIsPersistable(OperatingMode mode) {
  return mode == OperatingMode::ROADSIDE_OBSERVATION ||
      mode == OperatingMode::RADAR_WARNING ||
      mode == OperatingMode::FLASHING_WARNING ||
      mode == OperatingMode::LEGACY_DISTANCE_ROUTED_WARNING;
}

}  // namespace CheckIt
