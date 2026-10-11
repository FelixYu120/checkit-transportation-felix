#include "TrafficFeatures.h"

#include <math.h>

namespace CheckIt {
namespace {

constexpr float kPi = 3.14159265358979323846f;

uint8_t boundedPointCount(const TrafficPassage &passage) {
  return passage.pathPointCount > kTrafficTrackerMaxPathPoints
      ? kTrafficTrackerMaxPathPoints
      : passage.pathPointCount;
}

void pointPosition(
    const TrafficTrackPoint &point,
    float &xM,
    float &yM) {
  const float radians = static_cast<float>(point.angleDeg) * kPi / 180.0f;
  xM = static_cast<float>(point.distanceM) * sinf(radians);
  yM = static_cast<float>(point.distanceM) * cosf(radians);
}

bool segmentVelocity(
    const TrafficPassage &passage,
    uint8_t pointIndex,
    float &vxMps,
    float &vyMps) {
  if (pointIndex == 0 || pointIndex >= boundedPointCount(passage)) {
    return false;
  }
  const TrafficTrackPoint &previous = passage.path[pointIndex - 1U];
  const TrafficTrackPoint &current = passage.path[pointIndex];
  if (current.offsetMs <= previous.offsetMs) {
    return false;
  }

  float previousX = 0.0f;
  float previousY = 0.0f;
  float currentX = 0.0f;
  float currentY = 0.0f;
  pointPosition(previous, previousX, previousY);
  pointPosition(current, currentX, currentY);
  const float seconds =
      static_cast<float>(current.offsetMs - previous.offsetMs) / 1000.0f;
  vxMps = (currentX - previousX) / seconds;
  vyMps = (currentY - previousY) / seconds;
  return true;
}

float absoluteFloat(float value) {
  return value < 0.0f ? -value : value;
}

}  // namespace

TrafficPointKinematics deriveTrafficPointKinematics(
    const TrafficPassage &passage,
    uint8_t pointIndex) {
  TrafficPointKinematics result{};
  if (pointIndex >= boundedPointCount(passage)) {
    return result;
  }

  pointPosition(passage.path[pointIndex], result.xM, result.yM);
  result.velocityValid = segmentVelocity(
      passage,
      pointIndex,
      result.vxMps,
      result.vyMps);
  if (!result.velocityValid || pointIndex < 2U) {
    return result;
  }

  float previousVx = 0.0f;
  float previousVy = 0.0f;
  if (!segmentVelocity(
          passage,
          static_cast<uint8_t>(pointIndex - 1U),
          previousVx,
          previousVy)) {
    return result;
  }
  const uint16_t elapsedMs = static_cast<uint16_t>(
      passage.path[pointIndex].offsetMs -
      passage.path[pointIndex - 1U].offsetMs);
  if (elapsedMs == 0U) {
    return result;
  }
  const float seconds = static_cast<float>(elapsedMs) / 1000.0f;
  result.axMps2 = (result.vxMps - previousVx) / seconds;
  result.ayMps2 = (result.vyMps - previousVy) / seconds;
  result.accelerationValid = true;
  return result;
}

TrafficPathFeatures extractTrafficPathFeatures(
    const TrafficPassage &passage,
    uint16_t largeGapThresholdMs) {
  TrafficPathFeatures result{};
  const uint8_t pointCount = boundedPointCount(passage);
  result.pointCount = pointCount;
  if (pointCount == 0U) {
    return result;
  }

  result.minSnr = UINT8_MAX;
  float firstX = 0.0f;
  float firstY = 0.0f;
  float previousX = 0.0f;
  float previousY = 0.0f;
  float lastX = 0.0f;
  float lastY = 0.0f;
  float minX = 0.0f;
  float maxX = 0.0f;
  float minY = 0.0f;
  float maxY = 0.0f;
  float speedSum = 0.0f;
  float speedSquareSum = 0.0f;
  float snrSum = 0.0f;
  float snrSquareSum = 0.0f;
  float distanceSum = 0.0f;
  float absoluteAngleSum = 0.0f;
  float clusterSizeSum = 0.0f;
  float velocityXSum = 0.0f;
  float velocityYSum = 0.0f;
  uint8_t velocityCount = 0U;
  float accelerationSum = 0.0f;
  uint8_t accelerationCount = 0U;

  for (uint8_t i = 0U; i < pointCount; ++i) {
    const TrafficTrackPoint &point = passage.path[i];
    const TrafficPointKinematics motion =
        deriveTrafficPointKinematics(passage, i);
    const float x = motion.xM;
    const float y = motion.yM;
    if (i == 0U) {
      firstX = previousX = minX = maxX = x;
      firstY = previousY = minY = maxY = y;
    } else {
      const float deltaX = x - previousX;
      const float deltaY = y - previousY;
      result.pathLengthM += sqrtf(deltaX * deltaX + deltaY * deltaY);
      previousX = x;
      previousY = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const uint16_t gapMs =
          point.offsetMs > passage.path[i - 1U].offsetMs
          ? static_cast<uint16_t>(
              point.offsetMs - passage.path[i - 1U].offsetMs)
          : 0U;
      if (gapMs > result.maxSampleGapMs) {
        result.maxSampleGapMs = gapMs;
      }
      if (gapMs > largeGapThresholdMs && result.largeGapCount != UINT8_MAX) {
        ++result.largeGapCount;
      }
    }

    if (motion.velocityValid) {
      velocityXSum += motion.vxMps;
      velocityYSum += motion.vyMps;
      if (velocityCount != UINT8_MAX) ++velocityCount;
    }
    if (motion.accelerationValid) {
      const float magnitude = sqrtf(
          motion.axMps2 * motion.axMps2 +
          motion.ayMps2 * motion.ayMps2);
      accelerationSum += magnitude;
      if (magnitude > result.maxAccelerationMps2) {
        result.maxAccelerationMps2 = magnitude;
      }
      if (accelerationCount != UINT8_MAX) ++accelerationCount;
    }

    const float speed = static_cast<float>(point.speedKmh);
    const float snr = static_cast<float>(point.snr);
    speedSum += speed;
    speedSquareSum += speed * speed;
    snrSum += snr;
    snrSquareSum += snr * snr;
    distanceSum += point.distanceM;
    absoluteAngleSum += absoluteFloat(point.angleDeg);
    clusterSizeSum += point.clusterSize;
    if (point.snr < result.minSnr) result.minSnr = point.snr;
    lastX = x;
    lastY = y;
  }

  const float deltaX = lastX - firstX;
  const float deltaY = lastY - firstY;
  result.displacementM = sqrtf(deltaX * deltaX + deltaY * deltaY);
  result.straightness = result.pathLengthM > 0.0f
      ? result.displacementM / result.pathLengthM
      : 0.0f;
  if (result.straightness > 1.0f) result.straightness = 1.0f;
  result.lateralSpanM = maxX - minX;
  result.forwardSpanM = maxY - minY;
  result.meanVxMps = velocityCount == 0U
      ? 0.0f
      : velocityXSum / velocityCount;
  result.meanVyMps = velocityCount == 0U
      ? 0.0f
      : velocityYSum / velocityCount;
  result.meanAccelerationMps2 = accelerationCount == 0U
      ? 0.0f
      : accelerationSum / accelerationCount;

  const float count = static_cast<float>(pointCount);
  const float meanSpeed = speedSum / count;
  const float speedVariance = speedSquareSum / count - meanSpeed * meanSpeed;
  result.speedStdDevKmh = speedVariance > 0.0f
      ? sqrtf(speedVariance)
      : 0.0f;
  const float meanSnr = snrSum / count;
  const float snrVariance = snrSquareSum / count - meanSnr * meanSnr;
  result.snrStdDev = snrVariance > 0.0f ? sqrtf(snrVariance) : 0.0f;
  result.meanDistanceM = distanceSum / count;
  result.meanAbsAngleDeg = absoluteAngleSum / count;
  result.meanClusterSize = clusterSizeSum / count;
  return result;
}

}  // namespace CheckIt
