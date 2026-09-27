#include <unity.h>

#include "TrafficTracker.h"

using namespace CheckIt;

namespace {

const TrafficTrackerConfig kConfig{
    400UL,  // maxAssociationGapMs
    600UL,  // finalizeGapMs
    100UL,  // pathSampleIntervalMs
    300UL,  // minDurationMs
    4,      // minHits
    2,      // minTravelM
    4,      // maxDistanceDeltaM
    12,     // maxAngleDeltaDeg
    12,     // maxSpeedDeltaKmh
    2,      // clusterDistanceM
    5,      // clusterAngleDeg
    5,      // clusterSpeedKmh
    70,     // minAssociationConfidence
    70,     // minDirectionConsistency
    75,     // acceptedQualityScore
    50,     // reviewQualityScore
    7,      // micromobilityMinSpeedKmh
    18,     // motorVehicleMinSpeedKmh
    75};    // classConfidenceThreshold

RadarTarget target(
    uint8_t index,
    int8_t angle,
    uint8_t distance,
    uint8_t speed,
    uint8_t snr = 80) {
  return RadarTarget{index, angle, distance, DIR_APPROACH, speed, snr};
}

void finishOne(
    TrafficTracker &tracker,
    uint32_t nowMs,
    TrafficPassage &passage) {
  tracker.expire(nowMs, 1800000000UL);
  TEST_ASSERT_TRUE(tracker.popCompleted(passage));
}

void test_fast_cluster_becomes_one_vehicle_passage() {
  TrafficTracker tracker(kConfig);
  for (uint8_t frame = 0; frame < 4; ++frame) {
    RadarTarget targets[] = {
        target(0, 0, static_cast<uint8_t>(20 - frame * 2), 30),
        target(1, 2, static_cast<uint8_t>(21 - frame * 2), 31)};
    tracker.update(targets, 2, frame * 100UL, 1800000000UL + frame);
  }

  TrafficPassage passage{};
  finishOne(tracker, 1001UL, passage);
  TEST_ASSERT_EQUAL_UINT8(TRACK_ACCEPTED, passage.qualityStatus);
  TEST_ASSERT_EQUAL_UINT8(TRAFFIC_MOTOR_VEHICLE, passage.trafficClass);
  TEST_ASSERT_EQUAL_UINT16(4, passage.hitCount);
  TEST_ASSERT_EQUAL_UINT8(2, passage.peakClusterSize);
  TEST_ASSERT_TRUE(passage.classConfidence >= 75);
  TrafficPassage unexpected{};
  TEST_ASSERT_FALSE(tracker.popCompleted(unexpected));
}

void test_smooth_single_return_path_becomes_micromobility() {
  TrafficTracker tracker(kConfig);
  for (uint8_t frame = 0; frame < 4; ++frame) {
    const RadarTarget observation =
        target(0, 4, static_cast<uint8_t>(20 - frame * 2), 12);
    tracker.update(
        &observation,
        1,
        frame * 300UL,
        1800000000UL + frame);
  }

  TrafficPassage passage{};
  finishOne(tracker, 1601UL, passage);
  TEST_ASSERT_EQUAL_UINT8(TRACK_ACCEPTED, passage.qualityStatus);
  TEST_ASSERT_EQUAL_UINT8(TRAFFIC_MICROMOBILITY, passage.trafficClass);
  TEST_ASSERT_TRUE(passage.pathPointCount >= 4);
  TEST_ASSERT_EQUAL_UINT8(12, passage.medianSpeedKmh);
}

void test_one_frame_ghost_is_retained_but_rejected() {
  TrafficTracker tracker(kConfig);
  const RadarTarget ghost = target(0, 30, 15, 8, 20);
  tracker.update(&ghost, 1, 0UL, 1800000000UL);

  TrafficPassage passage{};
  finishOne(tracker, 601UL, passage);
  TEST_ASSERT_EQUAL_UINT8(TRACK_REJECTED, passage.qualityStatus);
  TEST_ASSERT_EQUAL_UINT8(TRAFFIC_UNKNOWN, passage.trafficClass);
  TEST_ASSERT_EQUAL_UINT16(1, passage.hitCount);
}

void test_walking_speed_path_is_not_tracked() {
  TrafficTracker tracker(kConfig);
  for (uint8_t frame = 0; frame < 5; ++frame) {
    const RadarTarget observation =
        target(0, 3, static_cast<uint8_t>(12 - frame), 3, 45);
    tracker.update(
        &observation,
        1,
        frame * 300UL,
        1800000000UL + frame);
  }

  tracker.expire(2001UL, 1800000010UL);
  TrafficPassage passage{};
  TEST_ASSERT_FALSE(tracker.popCompleted(passage));
  TEST_ASSERT_EQUAL_UINT32(0, tracker.stats().tracksStarted);
}

void test_constrained_matching_avoids_creating_a_false_third_path() {
  TrafficTracker tracker(kConfig);
  RadarTarget initial[] = {
      target(0, 0, 10, 10),
      target(1, 0, 13, 10)};
  tracker.update(initial, 2, 0UL, 1800000000UL);

  // The 12 m dot can match either prior path. The 16 m dot can match only the
  // 13 m path, so it must be assigned first regardless of array order.
  RadarTarget next[] = {
      target(0, 0, 12, 10),
      target(1, 0, 16, 10)};
  tracker.update(next, 2, 100UL, 1800000001UL);
  tracker.expire(1000UL, 1800000010UL);

  TrafficPassage first{};
  TrafficPassage second{};
  TrafficPassage unexpected{};
  TEST_ASSERT_TRUE(tracker.popCompleted(first));
  TEST_ASSERT_TRUE(tracker.popCompleted(second));
  TEST_ASSERT_FALSE(tracker.popCompleted(unexpected));
  TEST_ASSERT_EQUAL_UINT32(2, tracker.stats().tracksStarted);
  TEST_ASSERT_EQUAL_UINT8(10, first.entryDistanceM);
  TEST_ASSERT_EQUAL_UINT8(12, first.exitDistanceM);
  TEST_ASSERT_EQUAL_UINT8(13, second.entryDistanceM);
  TEST_ASSERT_EQUAL_UINT8(16, second.exitDistanceM);
}

void test_speed_alone_does_not_force_motor_vehicle_class() {
  TrafficTracker tracker(kConfig);
  for (uint8_t frame = 0; frame < 4; ++frame) {
    const RadarTarget observation =
        target(0, 4, static_cast<uint8_t>(20 - frame * 2), 28);
    tracker.update(
        &observation,
        1,
        frame * 300UL,
        1800000000UL + frame);
  }

  TrafficPassage passage{};
  finishOne(tracker, 1601UL, passage);
  TEST_ASSERT_EQUAL_UINT8(TRACK_ACCEPTED, passage.qualityStatus);
  TEST_ASSERT_EQUAL_UINT8(TRAFFIC_UNKNOWN, passage.trafficClass);
  TEST_ASSERT_TRUE(passage.classConfidence < 75);
}

void test_separated_dots_keep_distinct_track_ids() {
  TrafficTracker tracker(kConfig);
  for (uint8_t frame = 0; frame < 4; ++frame) {
    RadarTarget targets[] = {
        target(0, -25, static_cast<uint8_t>(20 - frame * 2), 12),
        target(1, 25, static_cast<uint8_t>(22 - frame * 2), 28)};
    tracker.update(targets, 2, frame * 100UL, 1800000000UL + frame);
  }
  tracker.expire(1001UL, 1800000010UL);

  TrafficPassage first{};
  TrafficPassage second{};
  TEST_ASSERT_TRUE(tracker.popCompleted(first));
  TEST_ASSERT_TRUE(tracker.popCompleted(second));
  TEST_ASSERT_NOT_EQUAL(first.trackId, second.trackId);
  TEST_ASSERT_EQUAL_UINT32(2, tracker.stats().tracksCompleted);
}

}  // namespace

void setUp() {}
void tearDown() {}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_fast_cluster_becomes_one_vehicle_passage);
  RUN_TEST(test_smooth_single_return_path_becomes_micromobility);
  RUN_TEST(test_one_frame_ghost_is_retained_but_rejected);
  RUN_TEST(test_walking_speed_path_is_not_tracked);
  RUN_TEST(test_speed_alone_does_not_force_motor_vehicle_class);
  RUN_TEST(test_separated_dots_keep_distinct_track_ids);
  RUN_TEST(test_constrained_matching_avoids_creating_a_false_third_path);
  return UNITY_END();
}
