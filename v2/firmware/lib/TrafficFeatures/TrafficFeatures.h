#pragma once

#include <stdint.h>

#include "TrafficTracker.h"

namespace CheckIt {

struct TrafficPointKinematics {
  float xM;
  float yM;
  float vxMps;
  float vyMps;
  float axMps2;
  float ayMps2;
  bool velocityValid;
  bool accelerationValid;
};

// Derived, non-destructive features for analysis and later model training.
// The original angle, distance, speed, SNR, direction, and cluster size remain
// authoritative and are never replaced by these calculated values.
struct TrafficPathFeatures {
  float pathLengthM;
  float displacementM;
  float straightness;
  float lateralSpanM;
  float forwardSpanM;
  float meanVxMps;
  float meanVyMps;
  float meanAccelerationMps2;
  float maxAccelerationMps2;
  float speedStdDevKmh;
  float snrStdDev;
  float meanDistanceM;
  float meanAbsAngleDeg;
  float meanClusterSize;
  uint16_t maxSampleGapMs;
  uint8_t largeGapCount;
  uint8_t minSnr;
  uint8_t pointCount;
};

TrafficPointKinematics deriveTrafficPointKinematics(
    const TrafficPassage &passage,
    uint8_t pointIndex);

TrafficPathFeatures extractTrafficPathFeatures(
    const TrafficPassage &passage,
    uint16_t largeGapThresholdMs);

}  // namespace CheckIt
