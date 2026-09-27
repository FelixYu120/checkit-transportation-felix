#include "TrafficTracker.h"

#include <math.h>
#include <string.h>

namespace CheckIt {
namespace {

float absoluteFloat(float value) {
  return value < 0.0f ? -value : value;
}

float clamp01(float value) {
  if (value < 0.0f) {
    return 0.0f;
  }
  return value > 1.0f ? 1.0f : value;
}

uint8_t roundedByte(float value) {
  if (value <= 0.0f) {
    return 0;
  }
  if (value >= 255.0f) {
    return 255;
  }
  return static_cast<uint8_t>(value + 0.5f);
}

int8_t roundedAngle(float value) {
  if (value <= -128.0f) {
    return -128;
  }
  if (value >= 127.0f) {
    return 127;
  }
  return static_cast<int8_t>(value < 0.0f ? value - 0.5f : value + 0.5f);
}

uint16_t saturatedOffset(uint32_t startMs, uint32_t nowMs) {
  const uint32_t offset = static_cast<uint32_t>(nowMs - startMs);
  return offset > UINT16_MAX ? UINT16_MAX : static_cast<uint16_t>(offset);
}

float polarX(float distanceM, float angleDeg) {
  const float radians = angleDeg * 3.14159265358979323846f / 180.0f;
  return distanceM * sinf(radians);
}

float polarY(float distanceM, float angleDeg) {
  const float radians = angleDeg * 3.14159265358979323846f / 180.0f;
  return distanceM * cosf(radians);
}

}  // namespace

const char *trafficClassName(TrafficClass trafficClass) {
  switch (trafficClass) {
    case TRAFFIC_MICROMOBILITY:
      return "micromobility";
    case TRAFFIC_MOTOR_VEHICLE:
      return "motor_vehicle";
    default:
      return "unknown";
  }
}

const char *trackQualityName(TrackQualityStatus status) {
  switch (status) {
    case TRACK_ACCEPTED:
      return "accepted";
    case TRACK_REVIEW:
      return "review";
    default:
      return "rejected";
  }
}

TrafficTracker::TrafficTracker(const TrafficTrackerConfig &config)
    : config_(config),
      tracks_{},
      completed_{},
      completedHead_(0),
      completedCount_(0),
      nextTrackId_(1),
      stats_{} {}

void TrafficTracker::reset() {
  memset(tracks_, 0, sizeof(tracks_));
  memset(completed_, 0, sizeof(completed_));
  completedHead_ = 0;
  completedCount_ = 0;
  nextTrackId_ = 1;
  stats_ = TrafficTrackerStats{};
}

uint8_t TrafficTracker::buildObservations(
    const RadarTarget *targets,
    uint8_t targetCount,
    Observation *observations) const {
  if (targets == nullptr || observations == nullptr) {
    return 0;
  }

  uint8_t observationCount = 0;
  const uint8_t boundedCount = targetCount > kTrafficTrackerMaxObservations
      ? kTrafficTrackerMaxObservations
      : targetCount;
  for (uint8_t i = 0; i < boundedCount; ++i) {
    const RadarTarget &target = targets[i];
    if (target.speedKmh < config_.micromobilityMinSpeedKmh) {
      continue;
    }
    int match = -1;
    for (uint8_t j = 0; j < observationCount; ++j) {
      const Observation &candidate = observations[j];
      if (candidate.direction == target.direction &&
          absoluteFloat(candidate.distanceM - target.distanceM) <=
              config_.clusterDistanceM &&
          absoluteFloat(candidate.angleDeg - target.angleDeg) <=
              config_.clusterAngleDeg &&
          absoluteFloat(candidate.speedKmh - target.speedKmh) <=
              config_.clusterSpeedKmh) {
        match = j;
        break;
      }
    }

    if (match < 0) {
      Observation &observation = observations[observationCount++];
      observation.distanceM = target.distanceM;
      observation.angleDeg = target.angleDeg;
      observation.speedKmh = target.speedKmh;
      observation.snr = target.snr;
      observation.direction = target.direction;
      observation.clusterSize = 1;
      continue;
    }

    Observation &observation = observations[match];
    const float priorCount = observation.clusterSize;
    const float nextCount = priorCount + 1.0f;
    observation.distanceM =
        (observation.distanceM * priorCount + target.distanceM) / nextCount;
    observation.angleDeg =
        (observation.angleDeg * priorCount + target.angleDeg) / nextCount;
    observation.speedKmh =
        (observation.speedKmh * priorCount + target.speedKmh) / nextCount;
    observation.snr =
        (observation.snr * priorCount + target.snr) / nextCount;
    if (observation.clusterSize != UINT8_MAX) {
      ++observation.clusterSize;
    }
  }
  return observationCount;
}

int TrafficTracker::findBestTrack(
    const Observation &observation,
    const bool *trackUsed,
    uint32_t nowMs,
    uint8_t &confidence,
    uint8_t &candidateCount) const {
  int bestIndex = -1;
  float bestScore = 0.0f;
  candidateCount = 0;
  for (uint8_t i = 0; i < kTrafficTrackerMaxTracks; ++i) {
    const ActiveTrack &track = tracks_[i];
    if (!track.active || trackUsed[i]) {
      continue;
    }
    const uint32_t gap = static_cast<uint32_t>(nowMs - track.lastSeenMs);
    if (gap > config_.maxAssociationGapMs) {
      continue;
    }

    const float distanceDelta =
        absoluteFloat(observation.distanceM - track.lastDistanceM);
    const float angleDelta =
        absoluteFloat(observation.angleDeg - track.lastAngleDeg);
    const float speedDelta =
        absoluteFloat(observation.speedKmh - track.lastSpeedKmh);
    if (distanceDelta > config_.maxDistanceDeltaM ||
        angleDelta > config_.maxAngleDeltaDeg ||
        speedDelta > config_.maxSpeedDeltaKmh) {
      continue;
    }

    float predictedX = polarX(track.lastDistanceM, track.lastAngleDeg);
    float predictedY = polarY(track.lastDistanceM, track.lastAngleDeg);
    if (track.hasPreviousObservation &&
        track.lastSeenMs != track.previousSeenMs) {
      const float priorX =
          polarX(track.previousDistanceM, track.previousAngleDeg);
      const float priorY =
          polarY(track.previousDistanceM, track.previousAngleDeg);
      const uint32_t sampleGapMs = static_cast<uint32_t>(
          track.lastSeenMs - track.previousSeenMs);
      float predictionSteps = static_cast<float>(gap) / sampleGapMs;
      if (predictionSteps > 2.0f) {
        predictionSteps = 2.0f;
      }
      predictedX += (predictedX - priorX) * predictionSteps;
      predictedY += (predictedY - priorY) * predictionSteps;
    }
    const float observedX =
        polarX(observation.distanceM, observation.angleDeg);
    const float observedY =
        polarY(observation.distanceM, observation.angleDeg);
    const float positionDelta = sqrtf(
        (observedX - predictedX) * (observedX - predictedX) +
        (observedY - predictedY) * (observedY - predictedY));
    const float maximumPositionDelta =
        static_cast<float>(config_.maxDistanceDeltaM) * 1.5f;
    if (positionDelta > maximumPositionDelta) {
      continue;
    }

    const float positionScore = 1.0f -
        positionDelta / maximumPositionDelta;
    const float distanceScore = 1.0f -
        distanceDelta / static_cast<float>(config_.maxDistanceDeltaM);
    const float angleScore = 1.0f -
        angleDelta / static_cast<float>(config_.maxAngleDeltaDeg);
    const float speedScore = 1.0f -
        speedDelta / static_cast<float>(config_.maxSpeedDeltaKmh);
    float score = 0.50f * positionScore + 0.20f * distanceScore +
        0.15f * angleScore + 0.15f * speedScore;

    const Direction trackDirection =
        track.approachVotes >= track.awayVotes ? DIR_APPROACH : DIR_AWAY;
    if (observation.direction != trackDirection) {
      score -= 0.12f;
    }
    if (score < 0.45f) {
      continue;
    }
    if (candidateCount != UINT8_MAX) {
      ++candidateCount;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  confidence = roundedByte(clamp01(bestScore) * 100.0f);
  return bestIndex;
}

void TrafficTracker::appendPathPoint(
    ActiveTrack &track,
    const Observation &observation,
    uint32_t nowMs,
    bool force) {
  const bool sampleDue = force || track.pathPointCount == 0 ||
      static_cast<uint32_t>(nowMs - track.lastPathSampleMs) >=
          config_.pathSampleIntervalMs;
  if (!sampleDue) {
    return;
  }

  const TrafficTrackPoint point{
      saturatedOffset(track.startedMs, nowMs),
      roundedAngle(observation.angleDeg),
      roundedByte(observation.distanceM),
      roundedByte(observation.speedKmh),
      roundedByte(observation.snr),
      observation.direction,
      observation.clusterSize};
  if (track.pathPointCount < kTrafficTrackerMaxPathPoints) {
    track.path[track.pathPointCount++] = point;
  } else {
    // Always preserve the most recent exit point once the fixed path buffer is
    // full. Earlier points remain available for shape and smoothness checks.
    track.path[kTrafficTrackerMaxPathPoints - 1] = point;
  }
  track.lastPathSampleMs = nowMs;
}

int TrafficTracker::startTrack(
    const Observation &observation,
    uint32_t nowMs,
    uint32_t observedEpoch) {
  int freeIndex = -1;
  for (uint8_t i = 0; i < kTrafficTrackerMaxTracks; ++i) {
    if (!tracks_[i].active) {
      freeIndex = i;
      break;
    }
  }
  if (freeIndex < 0) {
    return -1;
  }

  ActiveTrack &track = tracks_[freeIndex];
  track = ActiveTrack{};
  track.active = true;
  track.id = nextTrackId_++;
  if (nextTrackId_ == 0) {
    nextTrackId_ = 1;
  }
  track.startedMs = nowMs;
  track.lastSeenMs = nowMs;
  track.startedEpoch = observedEpoch;
  track.lastEpoch = observedEpoch;
  track.lastDistanceM = observation.distanceM;
  track.lastAngleDeg = observation.angleDeg;
  track.lastSpeedKmh = observation.speedKmh;
  track.hits = 1;
  track.approachVotes = observation.direction == DIR_APPROACH ? 1 : 0;
  track.awayVotes = observation.direction == DIR_AWAY ? 1 : 0;
  track.snrSum = observation.snr;
  track.maxSnr = roundedByte(observation.snr);
  track.peakClusterSize = observation.clusterSize;
  track.entryDistanceM = roundedByte(observation.distanceM);
  track.entryAngleDeg = roundedAngle(observation.angleDeg);
  track.exitDistanceM = track.entryDistanceM;
  track.exitAngleDeg = track.entryAngleDeg;
  track.maxSpeedKmh = roundedByte(observation.speedKmh);
  track.speeds[0] = track.maxSpeedKmh;
  track.speedSampleCount = 1;
  appendPathPoint(track, observation, nowMs, true);
  ++stats_.tracksStarted;
  ++stats_.activeTracks;
  return freeIndex;
}

void TrafficTracker::updateTrack(
    ActiveTrack &track,
    const Observation &observation,
    uint32_t nowMs,
    uint32_t observedEpoch,
    uint8_t associationConfidence) {
  track.previousSeenMs = track.lastSeenMs;
  track.previousDistanceM = track.lastDistanceM;
  track.previousAngleDeg = track.lastAngleDeg;
  track.hasPreviousObservation = true;
  track.lastSeenMs = nowMs;
  track.lastEpoch = observedEpoch;
  track.lastDistanceM = observation.distanceM;
  track.lastAngleDeg = observation.angleDeg;
  track.lastSpeedKmh = observation.speedKmh;
  if (track.hits != UINT16_MAX) {
    ++track.hits;
  }
  if (observation.direction == DIR_APPROACH &&
      track.approachVotes != UINT16_MAX) {
    ++track.approachVotes;
  } else if (observation.direction == DIR_AWAY &&
             track.awayVotes != UINT16_MAX) {
    ++track.awayVotes;
  }
  track.associationScoreSum += associationConfidence;
  if (track.associationCount != UINT16_MAX) {
    ++track.associationCount;
  }
  track.snrSum += observation.snr;
  const uint8_t snr = roundedByte(observation.snr);
  if (snr > track.maxSnr) {
    track.maxSnr = snr;
  }
  if (observation.clusterSize > track.peakClusterSize) {
    track.peakClusterSize = observation.clusterSize;
  }
  track.exitDistanceM = roundedByte(observation.distanceM);
  track.exitAngleDeg = roundedAngle(observation.angleDeg);
  const uint8_t speed = roundedByte(observation.speedKmh);
  if (speed > track.maxSpeedKmh) {
    track.maxSpeedKmh = speed;
  }
  if (track.speedSampleCount < kTrafficTrackerSpeedSamples) {
    track.speeds[track.speedSampleCount++] = speed;
  }
  appendPathPoint(track, observation, nowMs, false);
}

uint8_t TrafficTracker::percentileSpeed(
    const ActiveTrack &track,
    uint8_t percentile) const {
  if (track.speedSampleCount == 0) {
    return 0;
  }
  uint8_t sorted[kTrafficTrackerSpeedSamples]{};
  memcpy(sorted, track.speeds, track.speedSampleCount);
  for (uint8_t i = 1; i < track.speedSampleCount; ++i) {
    const uint8_t value = sorted[i];
    uint8_t j = i;
    while (j > 0 && sorted[j - 1] > value) {
      sorted[j] = sorted[j - 1];
      --j;
    }
    sorted[j] = value;
  }
  uint16_t rank = static_cast<uint16_t>(
      (static_cast<uint16_t>(track.speedSampleCount) * percentile + 99U) /
      100U);
  if (rank == 0) {
    rank = 1;
  }
  if (rank > track.speedSampleCount) {
    rank = track.speedSampleCount;
  }
  return sorted[rank - 1];
}

TrafficPassage TrafficTracker::makePassage(
    const ActiveTrack &track,
    uint32_t endedEpoch) const {
  TrafficPassage passage{};
  passage.trackId = track.id;
  passage.startedUptimeMs = track.startedMs;
  passage.endedUptimeMs = track.lastSeenMs;
  passage.startedEpoch = track.startedEpoch;
  passage.endedEpoch = track.lastEpoch != 0 ? track.lastEpoch : endedEpoch;
  passage.durationMs = static_cast<uint32_t>(track.lastSeenMs - track.startedMs);
  if (passage.startedEpoch == 0 && passage.endedEpoch >= passage.durationMs / 1000U) {
    passage.startedEpoch = passage.endedEpoch - passage.durationMs / 1000U;
  }
  passage.hitCount = track.hits;
  passage.direction =
      track.approachVotes >= track.awayVotes ? DIR_APPROACH : DIR_AWAY;
  const uint16_t directionVotes = track.approachVotes + track.awayVotes;
  const uint16_t majorityVotes = track.approachVotes > track.awayVotes
      ? track.approachVotes
      : track.awayVotes;
  passage.directionConsistency = directionVotes == 0
      ? 0
      : static_cast<uint8_t>(
          (static_cast<uint32_t>(majorityVotes) * 100U) / directionVotes);
  passage.associationConfidence = track.associationCount == 0
      ? 0
      : roundedByte(
          track.associationScoreSum / track.associationCount);
  passage.medianSpeedKmh = percentileSpeed(track, 50);
  passage.p85SpeedKmh = percentileSpeed(track, 85);
  passage.maxSpeedKmh = track.maxSpeedKmh;
  passage.meanSnr = track.hits == 0
      ? 0
      : roundedByte(track.snrSum / track.hits);
  passage.maxSnr = track.maxSnr;
  passage.peakClusterSize = track.peakClusterSize;
  passage.entryDistanceM = track.entryDistanceM;
  passage.entryAngleDeg = track.entryAngleDeg;
  passage.exitDistanceM = track.exitDistanceM;
  passage.exitAngleDeg = track.exitAngleDeg;

  const float entryAngleRad =
      static_cast<float>(track.entryAngleDeg) * 3.14159265358979323846f /
      180.0f;
  const float exitAngleRad =
      static_cast<float>(track.exitAngleDeg) * 3.14159265358979323846f /
      180.0f;
  const float entryX = track.entryDistanceM * sinf(entryAngleRad);
  const float entryY = track.entryDistanceM * cosf(entryAngleRad);
  const float exitX = track.exitDistanceM * sinf(exitAngleRad);
  const float exitY = track.exitDistanceM * cosf(exitAngleRad);
  const float deltaX = exitX - entryX;
  const float deltaY = exitY - entryY;
  passage.travelDistanceM = sqrtf(deltaX * deltaX + deltaY * deltaY);

  float quality = 0.0f;
  quality += 25.0f * clamp01(
      static_cast<float>(track.hits) / config_.minHits);
  quality += 15.0f * clamp01(
      static_cast<float>(passage.durationMs) / config_.minDurationMs);
  quality += 25.0f * passage.associationConfidence / 100.0f;
  quality += 15.0f * passage.directionConsistency / 100.0f;
  quality += 10.0f * clamp01(
      passage.travelDistanceM / config_.minTravelM);
  quality += 10.0f * clamp01(passage.meanSnr / 64.0f);
  passage.qualityScore = roundedByte(quality);

  const bool accepted =
      track.hits >= config_.minHits &&
      passage.durationMs >= config_.minDurationMs &&
      passage.travelDistanceM >= config_.minTravelM &&
      passage.associationConfidence >= config_.minAssociationConfidence &&
      passage.directionConsistency >= config_.minDirectionConsistency &&
      passage.qualityScore >= config_.acceptedQualityScore;
  if (accepted) {
    passage.qualityStatus = TRACK_ACCEPTED;
  } else if (track.hits >= 2 &&
             passage.qualityScore >= config_.reviewQualityScore) {
    passage.qualityStatus = TRACK_REVIEW;
  } else {
    passage.qualityStatus = TRACK_REJECTED;
  }

  passage.trafficClass = TRAFFIC_UNKNOWN;
  passage.classConfidence = 0;
  if (passage.qualityStatus == TRACK_ACCEPTED) {
    float motorEvidence = 0.0f;
    if (passage.p85SpeedKmh >= config_.motorVehicleMinSpeedKmh + 17U) {
      motorEvidence += 0.72f;
    } else if (passage.p85SpeedKmh >=
               config_.motorVehicleMinSpeedKmh + 6U) {
      motorEvidence += 0.55f;
    } else if (passage.p85SpeedKmh >= config_.motorVehicleMinSpeedKmh) {
      motorEvidence += 0.40f;
    }
    if (passage.peakClusterSize >= 3) {
      motorEvidence += 0.35f;
    } else if (passage.peakClusterSize >= 2) {
      motorEvidence += 0.25f;
    }
    if (passage.travelDistanceM >= 6.0f) {
      motorEvidence += 0.08f;
    }

    float microEvidence = 0.0f;
    if (passage.medianSpeedKmh >= config_.micromobilityMinSpeedKmh &&
        passage.p85SpeedKmh < config_.motorVehicleMinSpeedKmh) {
      microEvidence += 0.50f;
    }
    if (passage.p85SpeedKmh >= config_.micromobilityMinSpeedKmh + 1U &&
        passage.p85SpeedKmh < config_.motorVehicleMinSpeedKmh + 6U) {
      microEvidence += 0.10f;
    }
    if (passage.peakClusterSize == 1) {
      microEvidence += 0.10f;
    }
    if (passage.durationMs >= 900) {
      microEvidence += 0.10f;
    }
    if (passage.associationConfidence >= 70) {
      microEvidence += 0.10f;
    }
    if (passage.directionConsistency >= 90) {
      microEvidence += 0.05f;
    }
    if (passage.travelDistanceM >= config_.minTravelM) {
      microEvidence += 0.05f;
    }

    motorEvidence = clamp01(motorEvidence);
    microEvidence = clamp01(microEvidence);
    const float margin = absoluteFloat(motorEvidence - microEvidence);
    const float bestEvidence = motorEvidence > microEvidence
        ? motorEvidence
        : microEvidence;
    passage.classConfidence = roundedByte(bestEvidence * 100.0f);
    if (passage.classConfidence >= config_.classConfidenceThreshold &&
        margin >= 0.10f) {
      passage.trafficClass = motorEvidence > microEvidence
          ? TRAFFIC_MOTOR_VEHICLE
          : TRAFFIC_MICROMOBILITY;
    }
  }

  passage.pathPointCount = track.pathPointCount;
  memcpy(passage.path, track.path, sizeof(passage.path));
  return passage;
}

void TrafficTracker::updateStats(const TrafficPassage &passage) {
  ++stats_.tracksCompleted;
  if (passage.qualityStatus == TRACK_ACCEPTED) {
    ++stats_.acceptedTracks;
  } else if (passage.qualityStatus == TRACK_REVIEW) {
    ++stats_.reviewTracks;
  } else {
    ++stats_.rejectedTracks;
  }
  if (passage.trafficClass == TRAFFIC_MOTOR_VEHICLE) {
    ++stats_.motorVehicleTracks;
  } else if (passage.trafficClass == TRAFFIC_MICROMOBILITY) {
    ++stats_.micromobilityTracks;
  } else {
    ++stats_.unknownTracks;
  }
}

void TrafficTracker::queueCompleted(const TrafficPassage &passage) {
  updateStats(passage);
  if (completedCount_ >= kTrafficTrackerCompletedDepth) {
    ++stats_.droppedCompletedTracks;
    return;
  }
  const uint8_t tail = static_cast<uint8_t>(
      (completedHead_ + completedCount_) % kTrafficTrackerCompletedDepth);
  completed_[tail] = passage;
  ++completedCount_;
}

void TrafficTracker::finalizeTrack(size_t index, uint32_t endedEpoch) {
  ActiveTrack &track = tracks_[index];
  if (!track.active) {
    return;
  }
  // Ensure the path always contains its last observation, even when it ended
  // before the normal path sampling interval elapsed.
  Observation exitObservation{
      track.lastDistanceM,
      track.lastAngleDeg,
      track.lastSpeedKmh,
      track.hits == 0 ? 0.0f : track.snrSum / track.hits,
      track.approachVotes >= track.awayVotes ? DIR_APPROACH : DIR_AWAY,
      track.peakClusterSize};
  appendPathPoint(track, exitObservation, track.lastSeenMs, true);
  queueCompleted(makePassage(track, endedEpoch));
  track = ActiveTrack{};
  if (stats_.activeTracks > 0) {
    --stats_.activeTracks;
  }
}

void TrafficTracker::expire(uint32_t nowMs, uint32_t observedEpoch) {
  for (uint8_t i = 0; i < kTrafficTrackerMaxTracks; ++i) {
    if (tracks_[i].active &&
        static_cast<uint32_t>(nowMs - tracks_[i].lastSeenMs) >
            config_.finalizeGapMs) {
      finalizeTrack(i, observedEpoch);
    }
  }
}

void TrafficTracker::update(
    const RadarTarget *targets,
    uint8_t targetCount,
    uint32_t nowMs,
    uint32_t observedEpoch) {
  expire(nowMs, observedEpoch);

  Observation observations[kTrafficTrackerMaxObservations]{};
  const uint8_t observationCount =
      buildObservations(targets, targetCount, observations);
  bool trackUsed[kTrafficTrackerMaxTracks]{};
  bool observationUsed[kTrafficTrackerMaxObservations]{};
  for (;;) {
    int selectedObservation = -1;
    int selectedTrack = -1;
    uint8_t selectedConfidence = 0;
    uint8_t fewestCandidates = UINT8_MAX;
    for (uint8_t i = 0; i < observationCount; ++i) {
      if (observationUsed[i]) {
        continue;
      }
      uint8_t confidence = 0;
      uint8_t candidateCount = 0;
      const int trackIndex = findBestTrack(
          observations[i],
          trackUsed,
          nowMs,
          confidence,
          candidateCount);
      if (trackIndex < 0) {
        continue;
      }
      if (candidateCount < fewestCandidates ||
          (candidateCount == fewestCandidates &&
           confidence > selectedConfidence)) {
        selectedObservation = i;
        selectedTrack = trackIndex;
        selectedConfidence = confidence;
        fewestCandidates = candidateCount;
      }
    }
    if (selectedObservation < 0 || selectedTrack < 0) {
      break;
    }
    observationUsed[selectedObservation] = true;
    trackUsed[selectedTrack] = true;
    updateTrack(
        tracks_[selectedTrack],
        observations[selectedObservation],
        nowMs,
        observedEpoch,
        selectedConfidence);
  }

  for (uint8_t i = 0; i < observationCount; ++i) {
    if (observationUsed[i]) {
      continue;
    }
    startTrack(observations[i], nowMs, observedEpoch);
  }
}

bool TrafficTracker::popCompleted(TrafficPassage &passage) {
  if (!peekCompleted(passage)) {
    return false;
  }
  return discardCompleted();
}

bool TrafficTracker::peekCompleted(TrafficPassage &passage) const {
  if (completedCount_ == 0) {
    return false;
  }
  passage = completed_[completedHead_];
  return true;
}

bool TrafficTracker::discardCompleted() {
  if (completedCount_ == 0) {
    return false;
  }
  completed_[completedHead_] = TrafficPassage{};
  completedHead_ = static_cast<uint8_t>(
      (completedHead_ + 1) % kTrafficTrackerCompletedDepth);
  --completedCount_;
  return true;
}

uint8_t TrafficTracker::activeTrackCount() const {
  return stats_.activeTracks;
}

const TrafficTrackerStats &TrafficTracker::stats() const {
  return stats_;
}

}  // namespace CheckIt
