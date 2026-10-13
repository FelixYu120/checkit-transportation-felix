#include "SpeedDisplayPolicy.h"
#include <stdlib.h>

namespace CheckIt {
StableSpeedFilter::StableSpeedFilter(TargetQualityConfig config) : config_(config) {}

void StableSpeedFilter::beginFrame(uint32_t nowMs) {
  nowMs_ = nowMs;
  currentCount_ = 0;
  for (uint8_t i = 0; i < kTargetQualityMaxTargets; ++i) used_[i] = false;
}

bool StableSpeedFilter::observe(const RadarTarget &target, RadarTarget &stableTarget) {
  if (!passesTargetQualityGate(target, config_) || target.direction == DIR_UNKNOWN ||
      currentCount_ == kTargetQualityMaxTargets) return false;
  int best = -1, bestDifference = 32767;
  if (static_cast<uint32_t>(nowMs_ - previousMs_) <= config_.maxFrameGapMs) {
    for (uint8_t i = 0; i < previousCount_; ++i) {
      const RadarTarget &prior = previous_[i].target;
      const int distance = abs(int(target.distanceM) - int(prior.distanceM));
      const int angle = abs(int(target.angleDeg) - int(prior.angleDeg));
      const int speed = abs(int(target.speedKmh) - int(prior.speedKmh));
      if (used_[i] || target.direction != prior.direction ||
          distance > config_.maxDistanceDeltaM || angle > config_.maxAngleDeltaDeg ||
          speed > config_.maxSpeedDeltaKmh) continue;
      const int difference = distance + angle + speed;
      if (difference < bestDifference) { best = i; bestDifference = difference; }
    }
  }
  Track track{target, {target.speedKmh, target.speedKmh, target.speedKmh}, 1, nowMs_};
  if (best >= 0) {
    used_[best] = true;
    track = previous_[best];
    track.target = target;
    track.speeds[0] = track.speeds[1];
    track.speeds[1] = track.speeds[2];
    track.speeds[2] = target.speedKmh;
    if (track.hits < 3) ++track.hits;
  }
  current_[currentCount_++] = track;
  if (track.hits < 3 || static_cast<uint32_t>(nowMs_ - track.startedMs) < 200UL) return false;
  uint8_t a = track.speeds[0], b = track.speeds[1], c = track.speeds[2];
  if (a > b) { uint8_t t = a; a = b; b = t; }
  if (b > c) { uint8_t t = b; b = c; c = t; }
  if (a > b) b = a;
  stableTarget = target;
  stableTarget.speedKmh = b;
  return true;
}

void StableSpeedFilter::endFrame() {
  previousCount_ = currentCount_;
  for (uint8_t i = 0; i < currentCount_; ++i) previous_[i] = current_[i];
  previousMs_ = nowMs_;
}

uint8_t SpeedDisplayState::mph(uint8_t speedKmh) {
  // Integer rounded conversion; display saturation happens after conversion.
  const uint32_t rounded = (uint32_t(speedKmh) * 1000000UL + 804672UL) / 1609344UL;
  return rounded > 99 ? 99 : static_cast<uint8_t>(rounded);
}
bool SpeedDisplayState::exceedsMphLimit(uint8_t speedKmh, uint8_t limitMph) {
  return uint32_t(speedKmh) * 1000000UL > uint32_t(limitMph) * 1609344UL;
}
void SpeedDisplayState::qualifiedTarget(uint32_t nowMs) {
  value(nowMs);  // Expire/rearm before replacing the previous target timestamp.
  lastTargetMs_ = nowMs;
  seenTarget_ = true;
}
bool SpeedDisplayState::start(uint8_t speedKmh, uint32_t nowMs, bool force) {
  value(nowMs);
  if (!force && (active_ || !armed_)) return false;
  speedMph_ = mph(speedKmh);
  startedMs_ = nowMs;
  active_ = true;
  armed_ = false;
  qualifiedTarget(nowMs);
  return true;
}
bool SpeedDisplayState::updateSpeed(uint8_t speedKmh, uint32_t nowMs) {
  value(nowMs);  // Expired alerts must not be revived by a new speed.
  if (!active_) return false;
  const uint8_t nextMph = mph(speedKmh);
  if (nextMph == speedMph_) return false;
  speedMph_ = nextMph;
  return true;
}
bool SpeedDisplayState::updatePeakSpeed(uint8_t speedKmh, uint32_t nowMs) {
  value(nowMs);
  if (!active_ || mph(speedKmh) <= speedMph_) return false;
  return updateSpeed(speedKmh, nowMs);
}
int SpeedDisplayState::value(uint32_t nowMs) {
  if (active_ && static_cast<uint32_t>(nowMs - startedMs_) >= durationMs_) active_ = false;
  if (!active_ && seenTarget_ && static_cast<uint32_t>(nowMs - lastTargetMs_) >= 1000UL) armed_ = true;
  if (!active_ || ((nowMs - startedMs_) / halfPeriodMs_) % 2 != 0) return -1;
  return speedMph_;
}
int StartupDisplaySequence::value(uint32_t nowMs) {
  if (!active_) return -1;
  const uint32_t elapsed = static_cast<uint32_t>(nowMs - startedMs_);
  if (elapsed < allOnMs_) return kAllSegments;
  const uint32_t phase = (elapsed - allOnMs_) / halfPeriodMs_;
  if (phase >= static_cast<uint32_t>(pulses_) * 2U) {
    active_ = false;
    return -1;
  }
  return phase % 2U == 0 ? 66 : -1;
}
}  // namespace CheckIt
