#pragma once
#include "TargetQuality.h"

namespace CheckIt {

// Warning-only confirmation. Traffic classification/counting keeps its own gate.
// Associate each return once per frame, then use three speeds to remove spikes.
class StableSpeedFilter {
 public:
  explicit StableSpeedFilter(TargetQualityConfig config);
  void beginFrame(uint32_t nowMs);
  bool observe(const RadarTarget &target, RadarTarget &stableTarget);
  void endFrame();
 private:
  struct Track {
    RadarTarget target;
    uint8_t speeds[3];
    uint8_t hits;
    uint32_t startedMs;
  };
  TargetQualityConfig config_;
  Track previous_[kTargetQualityMaxTargets]{};
  Track current_[kTargetQualityMaxTargets]{};
  bool used_[kTargetQualityMaxTargets]{};
  uint8_t previousCount_ = 0, currentCount_ = 0;
  uint32_t previousMs_ = 0, nowMs_ = 0;
};

// Fixed, non-extending two-second flash. Rearm after a one-second target gap.
// The radar, network protocol, app configuration and stored data stay in km/h.
class SpeedDisplayState {
 public:
  explicit SpeedDisplayState(uint32_t durationMs = 2000, uint32_t halfPeriodMs = 300)
      : durationMs_(durationMs), halfPeriodMs_(halfPeriodMs ? halfPeriodMs : 300) {}
  static uint8_t mph(uint8_t speedKmh);
  // Compare measured speed before rounding/clamping the displayed mph.
  static bool exceedsMphLimit(uint8_t speedKmh, uint8_t limitMph);
  void qualifiedTarget(uint32_t nowMs);
  bool start(uint8_t speedKmh, uint32_t nowMs, bool force = false);
  // Opt-in live speed update; preserves the flash deadline and on/off phase.
  // Returns true only when an active alert's displayed mph changes.
  bool updateSpeed(uint8_t speedKmh, uint32_t nowMs);
  // Keep the highest qualified speed in the active window, without extending it.
  bool updatePeakSpeed(uint8_t speedKmh, uint32_t nowMs);
  int value(uint32_t nowMs);
  bool active() const { return active_; }
  uint8_t speedMph() const { return speedMph_; }
 private:
  uint32_t durationMs_, halfPeriodMs_;
  bool active_ = false, armed_ = true, seenTarget_ = false;
  uint8_t speedMph_ = 0;
  uint32_t startedMs_ = 0, lastTargetMs_ = 0;
};
// Same visible sequence at boot and on demand; no delays in the main loop.
class StartupDisplaySequence {
 public:
  static constexpr int kAllSegments = -2;
  StartupDisplaySequence(uint32_t allOnMs = 2000, uint32_t halfPeriodMs = 300,
                         uint8_t pulses = 5)
      : allOnMs_(allOnMs), halfPeriodMs_(halfPeriodMs ? halfPeriodMs : 300), pulses_(pulses) {}
  void start(uint32_t nowMs) { startedMs_ = nowMs; active_ = true; }
  int value(uint32_t nowMs);
  bool active() const { return active_; }
 private:
  uint32_t allOnMs_, halfPeriodMs_, startedMs_ = 0;
  uint8_t pulses_;
  bool active_ = false;
};
}  // namespace CheckIt
