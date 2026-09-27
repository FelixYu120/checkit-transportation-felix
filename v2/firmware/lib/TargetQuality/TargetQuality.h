#pragma once

#include <stdint.h>

#include "CheckItCore.h"

namespace CheckIt {

constexpr uint8_t kTargetQualityMaxTargets = 16;

struct TargetQualityConfig {
  uint8_t minDistanceM;
  uint8_t maxDistanceM;
  uint8_t minSnr;
  uint8_t maxAbsAngleDeg;
  uint8_t minSpeedKmh;
  uint8_t implausibleSpeedKmh;
  uint8_t implausibleSpeedMinSnr;
  uint8_t maxDistanceDeltaM;
  uint8_t maxAngleDeltaDeg;
  uint8_t maxSpeedDeltaKmh;
  uint32_t maxFrameGapMs;
};

// Applies the per-reading checks that define usable traffic telemetry. It is
// deliberately independent of the speed-limit warning policy so legitimate
// slower traffic can still be counted.
bool passesTargetQualityGate(
    const RadarTarget &target,
    const TargetQualityConfig &config);

// A combined plausibility rule. Neither high speed nor weak SNR is sufficient
// alone; both must be present before the reading is discarded.
bool isWeakExtremeSpeedReading(
    const RadarTarget &target,
    const TargetQualityConfig &config);

// Confirms that a usable reading resembles a usable reading in the immediately
// preceding radar frame. This removes one-frame reflections without delaying a
// stable target for more than one frame.
class TargetConfirmationFilter {
 public:
  explicit TargetConfirmationFilter(const TargetQualityConfig &config);

  void beginFrame(uint32_t nowMs);
  bool observe(const RadarTarget &target);
  void endFrame();
  void reset();

 private:
  bool matchesPrevious(
      const RadarTarget &target,
      uint8_t previousIndex) const;

  TargetQualityConfig config_;
  RadarTarget previous_[kTargetQualityMaxTargets];
  RadarTarget current_[kTargetQualityMaxTargets];
  bool previousUsed_[kTargetQualityMaxTargets];
  uint8_t previousCount_;
  uint8_t currentCount_;
  uint32_t previousFrameMs_;
  uint32_t currentFrameMs_;
  bool hasPreviousFrame_;
  bool frameOpen_;
};

}  // namespace CheckIt
