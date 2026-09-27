#pragma once

#include <stdint.h>

namespace CheckIt {

enum FlashDestination : uint8_t {
  FLASH_DESTINATION_LOCAL = 0,
  FLASH_DESTINATION_REMOTE = 1
};

struct FlashRouteConfig {
  // Targets nearer than this use the radar-node output. Targets at or beyond
  // this distance use the separate flashing node.
  uint8_t remoteFromDistanceM;
};

struct FlashRoute {
  bool flashLocal;
  bool flashRemote;
  FlashDestination destination;
};

FlashRoute routeFlashByDistance(
    uint8_t distanceM,
    const FlashRouteConfig &config);

const char *flashDestinationName(FlashDestination destination);

}  // namespace CheckIt
