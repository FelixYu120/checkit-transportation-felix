#include <unity.h>

#include "TargetQuality.h"

using namespace CheckIt;

namespace {

TargetQualityConfig qualityConfig() {
  return TargetQualityConfig{
      2,    // minimum distance
      80,   // maximum distance
      4,    // minimum SNR
      45,   // maximum absolute angle
      7,    // minimum traffic speed
      161,  // implausible extreme speed
      20,   // SNR required at extreme speed
      3,    // maximum distance change
      12,   // maximum angle change
      12,   // maximum speed change
      500}; // maximum frame gap
}

RadarTarget target(uint8_t speedKmh, uint8_t snr) {
  return RadarTarget{0, 0, 20, DIR_APPROACH, speedKmh, snr};
}

void test_rejects_only_weak_extreme_speed_pair() {
  const TargetQualityConfig config = qualityConfig();

  const RadarTarget weakExtreme = target(161, 19);
  TEST_ASSERT_TRUE(isWeakExtremeSpeedReading(weakExtreme, config));
  TEST_ASSERT_FALSE(passesTargetQualityGate(weakExtreme, config));

  // High speed with stronger evidence and weaker evidence below the extreme
  // speed threshold are retained; neither condition is sufficient alone.
  TEST_ASSERT_FALSE(isWeakExtremeSpeedReading(target(161, 20), config));
  TEST_ASSERT_TRUE(passesTargetQualityGate(target(161, 20), config));
  TEST_ASSERT_FALSE(isWeakExtremeSpeedReading(target(160, 4), config));
  TEST_ASSERT_TRUE(passesTargetQualityGate(target(160, 4), config));
}

void test_ordinary_quality_gates_still_apply() {
  const TargetQualityConfig config = qualityConfig();
  TEST_ASSERT_FALSE(passesTargetQualityGate(target(6, 30), config));
  TEST_ASSERT_FALSE(passesTargetQualityGate(target(20, 3), config));
  TEST_ASSERT_TRUE(passesTargetQualityGate(target(20, 4), config));
}

}  // namespace

void setUp() {}
void tearDown() {}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_rejects_only_weak_extreme_speed_pair);
  RUN_TEST(test_ordinary_quality_gates_still_apply);
  return UNITY_END();
}
