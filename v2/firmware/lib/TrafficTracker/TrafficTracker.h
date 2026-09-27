#pragma once

#include <stddef.h>
#include <stdint.h>

#include "CheckItCore.h"

namespace CheckIt {

constexpr uint8_t kTrafficTrackerMaxTracks = 8;
constexpr uint8_t kTrafficTrackerMaxObservations = 16;
// Preserve detailed micromobility and motor-vehicle paths for later model
// training. At the default 250 ms cadence this covers about 16 s.
constexpr uint8_t kTrafficTrackerMaxPathPoints = 64;
constexpr uint8_t kTrafficTrackerCompletedDepth = 8;
constexpr uint8_t kTrafficTrackerSpeedSamples = 64;

enum TrafficClass : uint8_t {
  TRAFFIC_UNKNOWN = 0,
  TRAFFIC_MICROMOBILITY = 1,
  TRAFFIC_MOTOR_VEHICLE = 2
};

enum TrackQualityStatus : uint8_t {
  TRACK_REJECTED = 0,
  TRACK_REVIEW = 1,
  TRACK_ACCEPTED = 2
};

const char *trafficClassName(TrafficClass trafficClass);
const char *trackQualityName(TrackQualityStatus status);

struct TrafficTrackerConfig {
  uint32_t maxAssociationGapMs;
  uint32_t finalizeGapMs;
  uint32_t pathSampleIntervalMs;
  uint32_t minDurationMs;
  uint8_t minHits;
  uint8_t minTravelM;
  uint8_t maxDistanceDeltaM;
  uint8_t maxAngleDeltaDeg;
  uint8_t maxSpeedDeltaKmh;
  uint8_t clusterDistanceM;
  uint8_t clusterAngleDeg;
  uint8_t clusterSpeedKmh;
  uint8_t minAssociationConfidence;
  uint8_t minDirectionConsistency;
  uint8_t acceptedQualityScore;
  uint8_t reviewQualityScore;
  uint8_t micromobilityMinSpeedKmh;
  uint8_t motorVehicleMinSpeedKmh;
  uint8_t classConfidenceThreshold;
};

struct TrafficTrackPoint {
  uint16_t offsetMs;
  int8_t angleDeg;
  uint8_t distanceM;
  uint8_t speedKmh;
  uint8_t snr;
  Direction direction;
  uint8_t clusterSize;
};

// One anonymous, multi-frame path. The track ID identifies a path only within
// one boot; CloudTelemetry adds a boot ID before database upload.
struct TrafficPassage {
  uint32_t trackId;
  uint32_t startedUptimeMs;
  uint32_t endedUptimeMs;
  uint32_t startedEpoch;
  uint32_t endedEpoch;
  Direction direction;
  TrafficClass trafficClass;
  TrackQualityStatus qualityStatus;
  uint16_t hitCount;
  uint32_t durationMs;
  uint8_t qualityScore;
  uint8_t classConfidence;
  uint8_t associationConfidence;
  uint8_t directionConsistency;
  uint8_t medianSpeedKmh;
  uint8_t p85SpeedKmh;
  uint8_t maxSpeedKmh;
  uint8_t meanSnr;
  uint8_t maxSnr;
  uint8_t peakClusterSize;
  float travelDistanceM;
  uint8_t entryDistanceM;
  int8_t entryAngleDeg;
  uint8_t exitDistanceM;
  int8_t exitAngleDeg;
  uint8_t pathPointCount;
  TrafficTrackPoint path[kTrafficTrackerMaxPathPoints];
};

struct TrafficTrackerStats {
  uint32_t tracksStarted;
  uint32_t tracksCompleted;
  uint32_t acceptedTracks;
  uint32_t reviewTracks;
  uint32_t rejectedTracks;
  uint32_t motorVehicleTracks;
  uint32_t micromobilityTracks;
  uint32_t unknownTracks;
  uint32_t droppedCompletedTracks;
  uint8_t activeTracks;
};

class TrafficTracker {
 public:
  explicit TrafficTracker(const TrafficTrackerConfig &config);

  // Call once for every valid radar frame. Targets should have passed basic
  // physical plausibility checks; cross-frame confidence is computed here.
  void update(
      const RadarTarget *targets,
      uint8_t targetCount,
      uint32_t nowMs,
      uint32_t observedEpoch);

  // Closes tracks even if UART frames stop arriving after a target disappears.
  void expire(uint32_t nowMs, uint32_t observedEpoch);

  bool popCompleted(TrafficPassage &passage);
  bool peekCompleted(TrafficPassage &passage) const;
  bool discardCompleted();
  uint8_t activeTrackCount() const;
  const TrafficTrackerStats &stats() const;
  void reset();

 private:
  struct Observation {
    float distanceM;
    float angleDeg;
    float speedKmh;
    float snr;
    Direction direction;
    uint8_t clusterSize;
  };

  struct ActiveTrack {
    bool active;
    uint32_t id;
    uint32_t startedMs;
    uint32_t lastSeenMs;
    uint32_t startedEpoch;
    uint32_t lastEpoch;
    uint32_t lastPathSampleMs;
    uint16_t hits;
    uint16_t approachVotes;
    uint16_t awayVotes;
    float lastDistanceM;
    float lastAngleDeg;
    float lastSpeedKmh;
    uint32_t previousSeenMs;
    float previousDistanceM;
    float previousAngleDeg;
    bool hasPreviousObservation;
    float associationScoreSum;
    uint16_t associationCount;
    float snrSum;
    uint8_t maxSnr;
    uint8_t peakClusterSize;
    uint8_t entryDistanceM;
    int8_t entryAngleDeg;
    uint8_t exitDistanceM;
    int8_t exitAngleDeg;
    uint8_t maxSpeedKmh;
    uint8_t speedSampleCount;
    uint8_t speeds[kTrafficTrackerSpeedSamples];
    uint8_t pathPointCount;
    TrafficTrackPoint path[kTrafficTrackerMaxPathPoints];
  };

  uint8_t buildObservations(
      const RadarTarget *targets,
      uint8_t targetCount,
      Observation *observations) const;
  int findBestTrack(
      const Observation &observation,
      const bool *trackUsed,
      uint32_t nowMs,
      uint8_t &confidence,
      uint8_t &candidateCount) const;
  int startTrack(
      const Observation &observation,
      uint32_t nowMs,
      uint32_t observedEpoch);
  void updateTrack(
      ActiveTrack &track,
      const Observation &observation,
      uint32_t nowMs,
      uint32_t observedEpoch,
      uint8_t associationConfidence);
  void appendPathPoint(
      ActiveTrack &track,
      const Observation &observation,
      uint32_t nowMs,
      bool force);
  void finalizeTrack(size_t index, uint32_t endedEpoch);
  TrafficPassage makePassage(
      const ActiveTrack &track,
      uint32_t endedEpoch) const;
  void queueCompleted(const TrafficPassage &passage);
  void updateStats(const TrafficPassage &passage);
  uint8_t percentileSpeed(
      const ActiveTrack &track,
      uint8_t percentile) const;

  TrafficTrackerConfig config_;
  ActiveTrack tracks_[kTrafficTrackerMaxTracks];
  TrafficPassage completed_[kTrafficTrackerCompletedDepth];
  uint8_t completedHead_;
  uint8_t completedCount_;
  uint32_t nextTrackId_;
  TrafficTrackerStats stats_;
};

}  // namespace CheckIt
