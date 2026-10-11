#include "FlashRouter.h"

namespace CheckIt {

FlashRoute routeFlashByDistance(
    uint8_t distanceM,
    const FlashRouteConfig &config) {
  if (distanceM >= config.remoteFromDistanceM) {
    return FlashRoute{false, true, FLASH_DESTINATION_REMOTE};
  }
  return FlashRoute{true, false, FLASH_DESTINATION_LOCAL};
}

const char *flashDestinationName(FlashDestination destination) {
  return destination == FLASH_DESTINATION_REMOTE ? "remote" : "local";
}

}  // namespace CheckIt
