#pragma once

#include <stdint.h>

#include "TrafficTracker.h"

namespace CheckIt {

// A boot ID plus track ID is the stable idempotency key for one passage.
// Retried HTTPS upserts therefore cannot create duplicate traffic counts.
struct CloudPassage {
  uint32_t bootId;
  TrafficPassage passage;
};

}  // namespace CheckIt
