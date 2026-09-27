#pragma once

#include <stdint.h>

#include "CheckItCore.h"

namespace CheckIt {

struct DecisionConfig {
  uint8_t speedLimitKmh;
  uint8_t dangerSpeedKmh;
  uint8_t emergencySpeedKmh;
  uint8_t minWarningDistanceM;
  uint8_t maxWarningDistanceM;
  uint8_t minSnr;
  uint8_t maxAbsAngleDeg;
  bool warnApproach;
  bool warnAway;
};

struct WarningDecision {
  bool shouldFlashLocal;
  bool shouldFlashRemote;
  WarningLevel level;
  uint16_t durationMs;
};

WarningDecision evaluateTarget(
    const RadarTarget &target,
    const DecisionConfig &config);

class AlertGate {
 public:
  AlertGate(uint8_t requiredConsecutiveFrames, uint32_t cooldownMs);

  bool observe(
      bool qualifying,
      Direction direction,
      WarningLevel level,
      uint32_t nowMs);

  void resetCandidate();

 private:
  uint8_t requiredConsecutiveFrames_;
  uint32_t cooldownMs_;
  uint8_t consecutiveFrames_;
  Direction candidateDirection_;
  WarningLevel candidateLevel_;
  uint32_t lastAlertMs_;
  bool hasAlerted_;
};

}  // namespace CheckIt
