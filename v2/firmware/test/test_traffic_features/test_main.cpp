#include <unity.h>

#include "TrafficFeatures.h"

using namespace CheckIt;

namespace {

TrafficTrackPoint point(
    uint16_t offsetMs,
    int8_t angleDeg,
    uint8_t distanceM,
    uint8_t speedKmh,
    uint8_t snr,
    uint8_t clusterSize = 1U) {
  return TrafficTrackPoint{
      offsetMs,
      angleDeg,
      distanceM,
      speedKmh,
      snr,
      DIR_APPROACH,
      clusterSize};
}

TrafficPassage straightPassage() {
  TrafficPassage passage{};
  passage.pathPointCount = 3U;
  passage.path[0] = point(0U, 0, 10U, 7U, 10U, 1U);
  passage.path[1] = point(1000U, 0, 12U, 14U, 20U, 2U);
  passage.path[2] = point(2000U, 0, 15U, 21U, 30U, 3U);
  return passage;
}

void test_point_kinematics_preserve_radar_coordinate_convention() {
  TrafficPassage passage{};
  passage.pathPointCount = 2U;
  passage.path[0] = point(0U, 0, 10U, 10U, 20U);
  passage.path[1] = point(1000U, 30, 10U, 10U, 20U);

  const TrafficPointKinematics first =
      deriveTrafficPointKinematics(passage, 0U);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, first.xM);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 10.0f, first.yM);
  TEST_ASSERT_FALSE(first.velocityValid);

  const TrafficPointKinematics second =
      deriveTrafficPointKinematics(passage, 1U);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 5.0f, second.xM);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 8.660f, second.yM);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 5.0f, second.vxMps);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, -1.340f, second.vyMps);
  TEST_ASSERT_TRUE(second.velocityValid);
  TEST_ASSERT_FALSE(second.accelerationValid);
}

void test_straight_path_features_include_velocity_acceleration_and_quality() {
  const TrafficPassage passage = straightPassage();
  const TrafficPathFeatures features =
      extractTrafficPathFeatures(passage, 500U);

  TEST_ASSERT_EQUAL_UINT8(3U, features.pointCount);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 5.0f, features.pathLengthM);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 5.0f, features.displacementM);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, features.straightness);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, features.lateralSpanM);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 5.0f, features.forwardSpanM);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, features.meanVxMps);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 2.5f, features.meanVyMps);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, features.meanAccelerationMps2);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1.0f, features.maxAccelerationMps2);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 5.715f, features.speedStdDevKmh);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 8.165f, features.snrStdDev);
  TEST_ASSERT_EQUAL_UINT8(10U, features.minSnr);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 2.0f, features.meanClusterSize);
  TEST_ASSERT_EQUAL_UINT16(1000U, features.maxSampleGapMs);
  TEST_ASSERT_EQUAL_UINT8(2U, features.largeGapCount);
}

void test_empty_path_has_safe_zero_features() {
  const TrafficPassage passage{};
  const TrafficPathFeatures features =
      extractTrafficPathFeatures(passage, 500U);
  TEST_ASSERT_EQUAL_UINT8(0U, features.pointCount);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, features.pathLengthM);
  TEST_ASSERT_EQUAL_UINT8(0U, features.minSnr);
}

}  // namespace

void setUp() {}
void tearDown() {}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_point_kinematics_preserve_radar_coordinate_convention);
  RUN_TEST(
      test_straight_path_features_include_velocity_acceleration_and_quality);
  RUN_TEST(test_empty_path_has_safe_zero_features);
  return UNITY_END();
}
