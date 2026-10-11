#include "TargetQuality.h"

namespace CheckIt {
namespace {

uint8_t absoluteDifference(uint8_t left, uint8_t right) {
  return left > right ? left - right : right - left;
}

uint8_t absoluteAngleDifference(int8_t left, int8_t right) {
  const int difference = static_cast<int>(left) - static_cast<int>(right);
  return static_cast<uint8_t>(difference < 0 ? -difference : difference);
}

}  // namespace

bool isWeakExtremeSpeedReading(
    const RadarTarget &target,
    const TargetQualityConfig &config) {
  return target.speedKmh >= config.implausibleSpeedKmh &&
      target.snr < config.implausibleSpeedMinSnr;
}

bool passesTargetQualityGate(
    const RadarTarget &target,
    const TargetQualityConfig &config) {
  if (target.direction == DIR_UNKNOWN ||
      target.distanceM < config.minDistanceM ||
      target.distanceM > config.maxDistanceM ||
      target.snr < config.minSnr ||
      target.speedKmh < config.minSpeedKmh ||
      isWeakExtremeSpeedReading(target, config)) {
    return false;
  }

  const int angle = static_cast<int>(target.angleDeg);
  const int absoluteAngle = angle < 0 ? -angle : angle;
  return absoluteAngle <= config.maxAbsAngleDeg;
}

TargetConfirmationFilter::TargetConfirmationFilter(
    const TargetQualityConfig &config)
    : config_(config),
      previous_{},
      current_{},
      previousUsed_{},
      previousCount_(0),
      currentCount_(0),
      previousFrameMs_(0),
      currentFrameMs_(0),
      hasPreviousFrame_(false),
      frameOpen_(false) {}

void TargetConfirmationFilter::beginFrame(uint32_t nowMs) {
  currentFrameMs_ = nowMs;
  currentCount_ = 0;
  for (uint8_t i = 0; i < kTargetQualityMaxTargets; ++i) {
    previousUsed_[i] = false;
  }
  frameOpen_ = true;
}

bool TargetConfirmationFilter::observe(const RadarTarget &target) {
  if (!frameOpen_ || !passesTargetQualityGate(target, config_)) {
    return false;
  }

  if (currentCount_ < kTargetQualityMaxTargets) {
    current_[currentCount_++] = target;
  }

  if (!hasPreviousFrame_ ||
      static_cast<uint32_t>(currentFrameMs_ - previousFrameMs_) >
          config_.maxFrameGapMs) {
    return false;
  }

  int bestIndex = -1;
  uint16_t bestDifference = 0xFFFF;
  for (uint8_t i = 0; i < previousCount_; ++i) {
    if (previousUsed_[i] || !matchesPrevious(target, i)) {
      continue;
    }

    const uint16_t difference =
        absoluteDifference(target.distanceM, previous_[i].distanceM) +
        absoluteAngleDifference(target.angleDeg, previous_[i].angleDeg) +
        absoluteDifference(target.speedKmh, previous_[i].speedKmh);
    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) {
    return false;
  }
  previousUsed_[bestIndex] = true;
  return true;
}

void TargetConfirmationFilter::endFrame() {
  if (!frameOpen_) {
    return;
  }

  previousCount_ = currentCount_;
  for (uint8_t i = 0; i < currentCount_; ++i) {
    previous_[i] = current_[i];
  }
  previousFrameMs_ = currentFrameMs_;
  hasPreviousFrame_ = true;
  frameOpen_ = false;
}

void TargetConfirmationFilter::reset() {
  previousCount_ = 0;
  currentCount_ = 0;
  hasPreviousFrame_ = false;
  frameOpen_ = false;
}

bool TargetConfirmationFilter::matchesPrevious(
    const RadarTarget &target,
    uint8_t previousIndex) const {
  const RadarTarget &previous = previous_[previousIndex];
  return target.direction == previous.direction &&
      absoluteDifference(target.distanceM, previous.distanceM) <=
          config_.maxDistanceDeltaM &&
      absoluteAngleDifference(target.angleDeg, previous.angleDeg) <=
          config_.maxAngleDeltaDeg &&
      absoluteDifference(target.speedKmh, previous.speedKmh) <=
          config_.maxSpeedDeltaKmh;
}

}  // namespace CheckIt
