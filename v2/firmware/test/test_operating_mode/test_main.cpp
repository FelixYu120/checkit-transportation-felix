#include <unity.h>

#include "OperatingMode.h"

using namespace CheckIt;

void testParsesInstallerModes() {
  OperatingMode mode = OperatingMode::LEGACY_DISTANCE_ROUTED_WARNING;
  TEST_ASSERT_TRUE(parseOperatingMode("roadside_observation", mode));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(OperatingMode::ROADSIDE_OBSERVATION),
      static_cast<uint8_t>(mode));
  TEST_ASSERT_TRUE(parseOperatingMode("radar_warning", mode));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(OperatingMode::RADAR_WARNING),
      static_cast<uint8_t>(mode));
  TEST_ASSERT_TRUE(parseOperatingMode("flashing_warning", mode));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(OperatingMode::FLASHING_WARNING),
      static_cast<uint8_t>(mode));
  TEST_ASSERT_FALSE(parseOperatingMode("warning_system", mode));
}

void testModeCapabilities() {
  TEST_ASSERT_FALSE(
      operatingModeHasWarnings(OperatingMode::ROADSIDE_OBSERVATION));
  TEST_ASSERT_FALSE(
      operatingModeUsesEspNow(OperatingMode::ROADSIDE_OBSERVATION));

  TEST_ASSERT_TRUE(operatingModeHasWarnings(OperatingMode::RADAR_WARNING));
  TEST_ASSERT_TRUE(
      operatingModeUsesLocalOutput(OperatingMode::RADAR_WARNING));
  TEST_ASSERT_FALSE(operatingModeUsesEspNow(OperatingMode::RADAR_WARNING));

  TEST_ASSERT_TRUE(
      operatingModeHasWarnings(OperatingMode::FLASHING_WARNING));
  TEST_ASSERT_TRUE(operatingModeUsesEspNow(OperatingMode::FLASHING_WARNING));
  TEST_ASSERT_FALSE(
      operatingModeUsesLocalOutput(OperatingMode::FLASHING_WARNING));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(testParsesInstallerModes);
  RUN_TEST(testModeCapabilities);
  return UNITY_END();
}
