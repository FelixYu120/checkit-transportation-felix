#include "DecisionEngine.h"

namespace CheckIt {

WarningDecision evaluateTarget(
    const RadarTarget &target,
    const DecisionConfig &config) {
  WarningDecision decision{};

  if (target.speedKmh <= config.speedLimitKmh) {
    return decision;
  }

  if (target.distanceM < config.minWarningDistanceM ||
      target.distanceM > config.maxWarningDistanceM) {
    return decision;
  }

  const int angle = static_cast<int>(target.angleDeg);
  const int absAngle = angle < 0 ? -angle : angle;
  if (absAngle > config.maxAbsAngleDeg || target.snr < config.minSnr) {
    return decision;
  }

  if (target.direction == DIR_UNKNOWN) {
    return decision;
  }
  if (target.direction == DIR_APPROACH && !config.warnApproach) {
    return decision;
  }
  if (target.direction == DIR_AWAY && !config.warnAway) {
    return decision;
  }

  decision.shouldFlashLocal = true;
  decision.shouldFlashRemote = true;

  if (target.speedKmh > config.emergencySpeedKmh) {
    decision.level = WARN_EMERGENCY;
    decision.durationMs = 6000;
  } else if (target.speedKmh >= config.dangerSpeedKmh) {
    decision.level = WARN_DANGER;
    decision.durationMs = 4000;
  } else {
    decision.level = WARN_INFO;
    decision.durationMs = 2500;
  }

  return decision;
}

AlertGate::AlertGate(uint8_t requiredConsecutiveFrames, uint32_t cooldownMs)
    : requiredConsecutiveFrames_(
          requiredConsecutiveFrames == 0 ? 1 : requiredConsecutiveFrames),
      cooldownMs_(cooldownMs),
      consecutiveFrames_(0),
      candidateDirection_(DIR_UNKNOWN),
      candidateLevel_(WARN_NONE),
      lastAlertMs_(0),
      hasAlerted_(false) {}

bool AlertGate::observe(
    bool qualifying,
    Direction direction,
    WarningLevel level,
    uint32_t nowMs) {
  if (!qualifying || direction == DIR_UNKNOWN || level == WARN_NONE) {
    resetCandidate();
    return false;
  }

  if (direction != candidateDirection_ || level != candidateLevel_) {
    candidateDirection_ = direction;
    candidateLevel_ = level;
    consecutiveFrames_ = 1;
  } else if (consecutiveFrames_ < 255) {
    ++consecutiveFrames_;
  }

  if (consecutiveFrames_ < requiredConsecutiveFrames_) {
    return false;
  }

  if (hasAlerted_ && static_cast<uint32_t>(nowMs - lastAlertMs_) < cooldownMs_) {
    return false;
  }

  lastAlertMs_ = nowMs;
  hasAlerted_ = true;
  resetCandidate();
  return true;
}

void AlertGate::resetCandidate() {
  consecutiveFrames_ = 0;
  candidateDirection_ = DIR_UNKNOWN;
  candidateLevel_ = WARN_NONE;
}

}  // namespace CheckIt
