#include <unity.h>

#include "Ld2415hProtocol.h"

using namespace CheckIt;

void test_approach_frame_parses_losslessly() {
  const uint8_t frame[] = {'V', '+', '0', '2', '5', '.', '4', '\r', '\n'};
  Ld2415hParser parser;
  Ld2415hMeasurement measurement{};
  Ld2415hParseResult result = LD2415H_IN_PROGRESS;
  for (uint8_t byte : frame) result = parser.push(byte, measurement);
  TEST_ASSERT_EQUAL_UINT8(LD2415H_MEASUREMENT_READY, result);
  TEST_ASSERT_EQUAL_INT16(254, measurement.signedSpeedTenthsKmh);
  TEST_ASSERT_EQUAL_UINT8(LD2415H_APPROACH, measurement.direction);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(frame, measurement.raw, sizeof(frame));
}

void test_away_frame_is_negative() {
  const uint8_t frame[] = {'V', '-', '1', '2', '3', '.', '7', '\r', '\n'};
  Ld2415hParser parser;
  Ld2415hMeasurement measurement{};
  for (uint8_t byte : frame) parser.push(byte, measurement);
  TEST_ASSERT_EQUAL_INT16(-1237, measurement.signedSpeedTenthsKmh);
  TEST_ASSERT_EQUAL_UINT8(LD2415H_AWAY, measurement.direction);
}

void test_corrupt_frame_is_rejected_and_next_frame_recovers() {
  const uint8_t bad[] = {'V', '+', '0', '2', 'X', '.', '4', '\r', '\n'};
  const uint8_t good[] = {'V', '+', '0', '0', '8', '.', '0', '\r', '\n'};
  Ld2415hParser parser;
  Ld2415hMeasurement measurement{};
  Ld2415hParseResult result = LD2415H_IN_PROGRESS;
  for (uint8_t byte : bad) result = parser.push(byte, measurement);
  TEST_ASSERT_EQUAL_UINT8(LD2415H_FRAME_ERROR, result);
  for (uint8_t byte : good) result = parser.push(byte, measurement);
  TEST_ASSERT_EQUAL_UINT8(LD2415H_MEASUREMENT_READY, result);
  TEST_ASSERT_EQUAL_INT16(80, measurement.signedSpeedTenthsKmh);
  TEST_ASSERT_EQUAL_UINT32(1, parser.validFrames());
  TEST_ASSERT_EQUAL_UINT32(1, parser.frameErrors());
}

void test_configuration_commands_match_documented_shape() {
  uint8_t command[kLd2415hCommandBytes]{};
  TEST_ASSERT_TRUE(buildLd2415hMeasurementConfig(7, 10, 5, command));
  const uint8_t expectedA[] = {0x43, 0x46, 0x01, 0x07, 0x0A, 0x05, 0x0D, 0x0A};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expectedA, command, sizeof(expectedA));

  TEST_ASSERT_TRUE(buildLd2415hOutputConfig(
      LD2415H_DETECT_BOTH, 1, LD2415H_KMH, command));
  const uint8_t expectedB[] = {0x43, 0x46, 0x02, 0x00, 0x01, 0x00, 0x0D, 0x0A};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expectedB, command, sizeof(expectedB));

  TEST_ASSERT_TRUE(buildLd2415hAntiVibrationConfig(5, command));
  const uint8_t expectedC[] = {0x43, 0x46, 0x03, 0x05, 0x00, 0x00, 0x0D, 0x0A};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expectedC, command, sizeof(expectedC));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_approach_frame_parses_losslessly);
  RUN_TEST(test_away_frame_is_negative);
  RUN_TEST(test_corrupt_frame_is_rejected_and_next_frame_recovers);
  RUN_TEST(test_configuration_commands_match_documented_shape);
  return UNITY_END();
}
