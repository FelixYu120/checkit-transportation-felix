#include <unity.h>

#include <string.h>

#include "CheckItConfig.h"
#include "CheckItProtocol.h"
#include "DecisionEngine.h"
#include "Ld2451Protocol.h"
#include "TargetQuality.h"

using namespace CheckIt;

namespace {

DecisionConfig standardConfig() {
  return DecisionConfig{
      16,  // speed limit
      25,  // danger
      35,  // emergency
      5,   // minimum warning distance
      80,  // maximum warning distance
      4,   // minimum SNR
      45,  // maximum absolute angle
      true,
      true};
}

RadarTarget target(
    uint8_t speedKmh = 22,
    uint8_t distanceM = 30,
    Direction direction = DIR_APPROACH,
    int8_t angleDeg = 0,
    uint8_t snr = 20) {
  return RadarTarget{0, angleDeg, distanceM, direction, speedKmh, snr};
}

TargetQualityConfig qualityConfig() {
  return TargetQualityConfig{
      2,    // minimum distance
      80,   // maximum distance
      4,    // minimum SNR
      45,   // maximum absolute angle
      2,    // minimum traffic speed
      161,  // implausible extreme speed
      20,   // SNR required at extreme speed
      3,    // maximum distance change
      12,   // maximum angle change
      12,   // maximum speed change
      500}; // maximum frame gap
}

void test_decision_rejects_below_limit_and_bad_geometry() {
  const DecisionConfig config = standardConfig();

  TEST_ASSERT_EQUAL_UINT8(
      WARN_NONE,
      evaluateTarget(target(16), config).level);
  TEST_ASSERT_EQUAL_UINT8(
      WARN_NONE,
      evaluateTarget(target(22, 4), config).level);
  TEST_ASSERT_EQUAL_UINT8(
      WARN_NONE,
      evaluateTarget(target(22, 81), config).level);
  TEST_ASSERT_EQUAL_UINT8(
      WARN_NONE,
      evaluateTarget(target(22, 30, DIR_APPROACH, 46), config).level);
  TEST_ASSERT_EQUAL_UINT8(
      WARN_NONE,
      evaluateTarget(target(22, 30, DIR_APPROACH, 0, 3), config).level);
  TEST_ASSERT_EQUAL_UINT8(
      WARN_NONE,
      evaluateTarget(target(22, 30, DIR_UNKNOWN), config).level);
}

void test_decision_assigns_levels_and_durations() {
  const DecisionConfig config = standardConfig();

  WarningDecision info = evaluateTarget(target(17), config);
  TEST_ASSERT_TRUE(info.shouldFlashLocal);
  TEST_ASSERT_TRUE(info.shouldFlashRemote);
  TEST_ASSERT_EQUAL_UINT8(WARN_INFO, info.level);
  TEST_ASSERT_EQUAL_UINT16(2500, info.durationMs);

  WarningDecision danger = evaluateTarget(target(25), config);
  TEST_ASSERT_EQUAL_UINT8(WARN_DANGER, danger.level);
  TEST_ASSERT_EQUAL_UINT16(4000, danger.durationMs);

  WarningDecision upperBoundary = evaluateTarget(target(35), config);
  TEST_ASSERT_EQUAL_UINT8(WARN_DANGER, upperBoundary.level);

  WarningDecision emergency = evaluateTarget(target(36), config);
  TEST_ASSERT_EQUAL_UINT8(WARN_EMERGENCY, emergency.level);
  TEST_ASSERT_EQUAL_UINT16(6000, emergency.durationMs);
}

void test_decision_switches_level_only_above_upper_field_limit() {
  DecisionConfig config = standardConfig();
  config.dangerSpeedKmh = 16;
  config.emergencySpeedKmh = 25;

  TEST_ASSERT_EQUAL_UINT8(WARN_NONE, evaluateTarget(target(16), config).level);
  TEST_ASSERT_EQUAL_UINT8(WARN_DANGER, evaluateTarget(target(17), config).level);
  TEST_ASSERT_EQUAL_UINT8(WARN_DANGER, evaluateTarget(target(25), config).level);
  TEST_ASSERT_EQUAL_UINT8(WARN_EMERGENCY, evaluateTarget(target(26), config).level);
}

void test_decision_direction_filters() {
  DecisionConfig config = standardConfig();
  config.warnAway = false;

  TEST_ASSERT_EQUAL_UINT8(
      WARN_INFO,
      evaluateTarget(target(22, 30, DIR_APPROACH), config).level);
  TEST_ASSERT_EQUAL_UINT8(
      WARN_NONE,
      evaluateTarget(target(22, 30, DIR_AWAY), config).level);
}

void test_bench_threshold_allows_four_kmh_at_two_metres() {
  const DecisionConfig config{
      CHECKIT_SPEED_LIMIT_KMH,
      CHECKIT_DANGER_SPEED_KMH,
      CHECKIT_EMERGENCY_SPEED_KMH,
      CHECKIT_MIN_WARNING_DISTANCE_M,
      CHECKIT_MAX_WARNING_DISTANCE_M,
      CHECKIT_MIN_WARNING_SNR,
      CHECKIT_MAX_WARNING_ABS_ANGLE_DEG,
      CHECKIT_WARN_APPROACH != 0,
      CHECKIT_WARN_AWAY != 0};

  TEST_ASSERT_EQUAL_UINT8(
      WARN_INFO,
      evaluateTarget(target(4, 2), config).level);
  TEST_ASSERT_EQUAL_UINT8(
      WARN_NONE,
      evaluateTarget(target(4, 1), config).level);
}

void test_alert_gate_debounces_and_cools_down() {
  AlertGate gate(2, 5000);

  TEST_ASSERT_FALSE(gate.observe(true, DIR_APPROACH, WARN_INFO, 100));
  TEST_ASSERT_TRUE(gate.observe(true, DIR_APPROACH, WARN_INFO, 200));
  TEST_ASSERT_FALSE(gate.observe(true, DIR_APPROACH, WARN_INFO, 300));
  TEST_ASSERT_FALSE(gate.observe(true, DIR_APPROACH, WARN_INFO, 400));

  // The cooldown has elapsed; two fresh matching frames can trigger again.
  gate.resetCandidate();
  TEST_ASSERT_FALSE(gate.observe(true, DIR_APPROACH, WARN_INFO, 5300));
  TEST_ASSERT_TRUE(gate.observe(true, DIR_APPROACH, WARN_INFO, 5400));
}

void test_alert_gate_handles_millis_wrap() {
  AlertGate gate(1, 100);
  TEST_ASSERT_TRUE(gate.observe(true, DIR_AWAY, WARN_DANGER, 0xFFFFFFF0UL));
  TEST_ASSERT_FALSE(gate.observe(true, DIR_AWAY, WARN_DANGER, 0x00000020UL));
  TEST_ASSERT_TRUE(gate.observe(true, DIR_AWAY, WARN_DANGER, 0x00000080UL));
}

void test_target_quality_rejects_weak_and_bad_geometry() {
  const TargetQualityConfig config = qualityConfig();

  TEST_ASSERT_TRUE(passesTargetQualityGate(target(20, 20), config));
  TEST_ASSERT_FALSE(
      passesTargetQualityGate(target(20, 20, DIR_APPROACH, 0, 3), config));
  TEST_ASSERT_FALSE(
      passesTargetQualityGate(target(20, 20, DIR_UNKNOWN), config));
  TEST_ASSERT_FALSE(
      passesTargetQualityGate(target(20, 1), config));
  TEST_ASSERT_FALSE(
      passesTargetQualityGate(target(20, 20, DIR_APPROACH, 46), config));
  TEST_ASSERT_FALSE(
      passesTargetQualityGate(target(1, 20), config));
}

void test_target_confirmation_requires_similar_consecutive_frames() {
  TargetConfirmationFilter filter(qualityConfig());

  filter.beginFrame(100);
  TEST_ASSERT_FALSE(filter.observe(target(20, 20, DIR_APPROACH, 0, 10)));
  filter.endFrame();

  filter.beginFrame(240);
  TEST_ASSERT_TRUE(filter.observe(target(24, 21, DIR_APPROACH, 5, 8)));
  filter.endFrame();

  // A large speed jump is a new candidate, not a confirmed target.
  filter.beginFrame(380);
  TEST_ASSERT_FALSE(filter.observe(target(80, 21, DIR_APPROACH, 5, 8)));
  filter.endFrame();

  // A weak reading is neither accepted nor retained as a future baseline.
  filter.beginFrame(520);
  TEST_ASSERT_FALSE(filter.observe(target(80, 21, DIR_APPROACH, 5, 2)));
  filter.endFrame();

  filter.beginFrame(660);
  TEST_ASSERT_FALSE(filter.observe(target(80, 21, DIR_APPROACH, 5, 8)));
  filter.endFrame();
}

void test_target_confirmation_rejects_stale_previous_frame() {
  TargetConfirmationFilter filter(qualityConfig());
  filter.beginFrame(100);
  TEST_ASSERT_FALSE(filter.observe(target()));
  filter.endFrame();

  filter.beginFrame(700);
  TEST_ASSERT_FALSE(filter.observe(target()));
  filter.endFrame();
}

void test_ld2451_parses_official_example() {
  const uint8_t bytes[] = {
      0xF4, 0xF3, 0xF2, 0xF1,
      0x11, 0x00,
      0x03, 0x01,
      0x8A, 0x28, 0x00, 0x3C, 0x15,
      0x8A, 0x1E, 0x01, 0x3C, 0x0F,
      0x76, 0x5F, 0x00, 0x3C, 0x0F,
      0xF8, 0xF7, 0xF6, 0xF5};

  Ld2451Parser parser(false);
  Ld2451Frame frame{};
  Ld2451ParseResult result = LD2451_IN_PROGRESS;
  for (uint8_t byte : bytes) {
    result = parser.push(byte, frame);
  }

  TEST_ASSERT_EQUAL_UINT8(LD2451_FRAME_READY, result);
  TEST_ASSERT_TRUE(frame.alarm);
  TEST_ASSERT_EQUAL_UINT8(3, frame.targetCount);
  TEST_ASSERT_EQUAL_INT8(10, frame.targets[0].angleDeg);
  TEST_ASSERT_EQUAL_UINT8(40, frame.targets[0].distanceM);
  TEST_ASSERT_EQUAL_UINT8(DIR_AWAY, frame.targets[0].direction);
  TEST_ASSERT_EQUAL_UINT8(60, frame.targets[0].speedKmh);
  TEST_ASSERT_EQUAL_UINT8(0x15, frame.targets[0].snr);
  TEST_ASSERT_EQUAL_UINT8(DIR_APPROACH, frame.targets[1].direction);
  TEST_ASSERT_EQUAL_INT8(-10, frame.targets[2].angleDeg);
  TEST_ASSERT_EQUAL_UINT8(95, frame.targets[2].distanceM);
  TEST_ASSERT_EQUAL_UINT32(1, parser.stats().validFrames);
}

void test_ld2451_direction_mapping_can_be_reversed() {
  const uint8_t payload[] = {
      0x02, 0x00,
      0x80, 0x10, 0x00, 0x14, 0x20,
      0x80, 0x10, 0x01, 0x14, 0x20};

  Ld2451Parser parser(true, -1);
  Ld2451Frame frame{};
  TEST_ASSERT_TRUE(parser.parsePayload(payload, sizeof(payload), frame));
  TEST_ASSERT_EQUAL_UINT8(DIR_APPROACH, frame.targets[0].direction);
  TEST_ASSERT_EQUAL_UINT8(DIR_AWAY, frame.targets[1].direction);
  TEST_ASSERT_EQUAL_INT8(0, frame.targets[0].angleDeg);

  const uint8_t anglePayload[] = {
      0x01, 0x00,
      0x85, 0x10, 0x00, 0x14, 0x20};
  TEST_ASSERT_TRUE(
      parser.parsePayload(anglePayload, sizeof(anglePayload), frame));
  TEST_ASSERT_EQUAL_INT8(-5, frame.targets[0].angleDeg);
}

void test_ld2451_supports_marker_and_empty_heartbeat() {
  const uint8_t markerPayload[] = {
      0x02, 0xAA,
      0x01, 0x01,
      0x81, 0x20, 0x01, 0x1E, 0x30};

  Ld2451Parser parser;
  Ld2451Frame markerFrame{};
  TEST_ASSERT_TRUE(
      parser.parsePayload(markerPayload, sizeof(markerPayload), markerFrame));
  TEST_ASSERT_EQUAL_UINT8(1, markerFrame.targetCount);
  TEST_ASSERT_EQUAL_INT8(1, markerFrame.targets[0].angleDeg);

  const uint8_t heartbeat[] = {
      0xF4, 0xF3, 0xF2, 0xF1,
      0x00, 0x00,
      0xF8, 0xF7, 0xF6, 0xF5};
  Ld2451Frame emptyFrame{};
  Ld2451ParseResult result = LD2451_IN_PROGRESS;
  for (uint8_t byte : heartbeat) {
    result = parser.push(byte, emptyFrame);
  }
  TEST_ASSERT_EQUAL_UINT8(LD2451_FRAME_READY, result);
  TEST_ASSERT_EQUAL_UINT8(0, emptyFrame.targetCount);

  uint8_t largePayload[2 + (5 * 17)]{};
  largePayload[0] = 17;
  largePayload[1] = 1;
  for (uint8_t i = 0; i < 17; ++i) {
    const uint8_t base = static_cast<uint8_t>(2 + (i * 5));
    largePayload[base] = 0x80;
    largePayload[base + 1] = static_cast<uint8_t>(20 + i);
    largePayload[base + 2] = i % 2;
    largePayload[base + 3] = 30;
    largePayload[base + 4] = 40;
  }
  Ld2451Frame largeFrame{};
  TEST_ASSERT_TRUE(
      parser.parsePayload(largePayload, sizeof(largePayload), largeFrame));
  TEST_ASSERT_EQUAL_UINT8(17, largeFrame.reportedTargetCount);
  TEST_ASSERT_EQUAL_UINT8(kLd2451MaxTargets, largeFrame.targetCount);
  TEST_ASSERT_TRUE(largeFrame.truncated);
}

void test_ld2451_rejects_bad_length_and_trailer() {
  Ld2451Parser parser;
  Ld2451Frame frame{};

  const uint8_t badPayload[] = {0x01, 0x00, 0x80};
  TEST_ASSERT_FALSE(
      parser.parsePayload(badPayload, sizeof(badPayload), frame));

  const uint8_t badAlarmPayload[] = {
      0x01, 0x02, 0x80, 0x10, 0x00, 0x14, 0x20};
  TEST_ASSERT_FALSE(
      parser.parsePayload(
          badAlarmPayload, sizeof(badAlarmPayload), frame));

  const uint8_t badFrame[] = {
      0xF4, 0xF3, 0xF2, 0xF1,
      0x00, 0x00,
      0xF8, 0xF7, 0xF6, 0x00};
  Ld2451ParseResult result = LD2451_IN_PROGRESS;
  for (uint8_t byte : badFrame) {
    result = parser.push(byte, frame);
  }
  TEST_ASSERT_EQUAL_UINT8(LD2451_FRAME_ERROR, result);
  TEST_ASSERT_EQUAL_UINT32(1, parser.stats().invalidTrailers);
}

void test_ld2451_builds_configuration_commands() {
  const Ld2451CommandFrame enable =
      Ld2451Commands::enableConfiguration();
  const uint8_t expectedEnable[] = {
      0xFD, 0xFC, 0xFB, 0xFA,
      0x04, 0x00, 0xFF, 0x00, 0x01, 0x00,
      0x04, 0x03, 0x02, 0x01};
  TEST_ASSERT_EQUAL_UINT8(sizeof(expectedEnable), enable.length);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(
      expectedEnable, enable.bytes, sizeof(expectedEnable));

  const Ld2451CommandFrame targetCommand =
      Ld2451Commands::setTargetParameters(
          100, LD2451_DETECT_BOTH, 1, 1);
  const uint8_t expectedTarget[] = {
      0xFD, 0xFC, 0xFB, 0xFA,
      0x06, 0x00, 0x02, 0x00,
      0x64, 0x02, 0x01, 0x01,
      0x04, 0x03, 0x02, 0x01};
  TEST_ASSERT_EQUAL_UINT8(sizeof(expectedTarget), targetCommand.length);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(
      expectedTarget, targetCommand.bytes, sizeof(expectedTarget));
}

void test_ld2451_parses_ack() {
  const uint8_t bytes[] = {
      0xFD, 0xFC, 0xFB, 0xFA,
      0x08, 0x00,
      0x12, 0x01, 0x00, 0x00,
      0x64, 0x02, 0x01, 0x01,
      0x04, 0x03, 0x02, 0x01};

  Ld2451AckParser parser;
  Ld2451Ack ack{};
  Ld2451ParseResult result = LD2451_IN_PROGRESS;
  for (uint8_t byte : bytes) {
    result = parser.push(byte, ack);
  }

  TEST_ASSERT_EQUAL_UINT8(LD2451_FRAME_READY, result);
  TEST_ASSERT_EQUAL_HEX16(0x0112, ack.command);
  TEST_ASSERT_EQUAL_UINT16(0, ack.status);
  TEST_ASSERT_EQUAL_UINT8(4, ack.payloadLength);
  TEST_ASSERT_EQUAL_HEX8(0x64, ack.payload[0]);
  TEST_ASSERT_EQUAL_HEX8(0x02, ack.payload[1]);
}

void test_message_crc_and_fields() {
  const RadarTarget radarTarget = target(28, 42, DIR_APPROACH, -7, 55);
  CheckItMessage message = makeMessage(
      MSG_ALERT,
      9,
      1,
      101,
      123456,
      &radarTarget,
      WARN_DANGER,
      4000,
      FLAG_RADAR_ALARM | FLAG_REMOTE_OUTPUT);

  TEST_ASSERT_TRUE(isValidMessage(message));
  TEST_ASSERT_EQUAL_UINT16(9, message.sequence);
  TEST_ASSERT_EQUAL_UINT8(28, message.speedKmh);
  TEST_ASSERT_EQUAL_INT8(-7, message.angleDeg);
  TEST_ASSERT_EQUAL_UINT8(DIR_APPROACH, message.direction);

  message.speedKmh ^= 1;
  TEST_ASSERT_FALSE(isValidMessage(message));
}

void test_sequence_tracker_rejects_duplicates_and_accepts_wrap() {
  SequenceTracker tracker;
  TEST_ASSERT_TRUE(tracker.accept(1, 65534));
  TEST_ASSERT_TRUE(tracker.accept(1, 65535));
  TEST_ASSERT_TRUE(tracker.accept(1, 0));
  TEST_ASSERT_TRUE(tracker.accept(1, 1));
  TEST_ASSERT_FALSE(tracker.accept(1, 1));
  TEST_ASSERT_FALSE(tracker.accept(1, 65535));
  TEST_ASSERT_TRUE(tracker.accept(2, 1));
}

}  // namespace

void setUp() {}
void tearDown() {}

int main() {
  UNITY_BEGIN();

  RUN_TEST(test_decision_rejects_below_limit_and_bad_geometry);
  RUN_TEST(test_decision_assigns_levels_and_durations);
  RUN_TEST(test_decision_switches_level_only_above_upper_field_limit);
  RUN_TEST(test_decision_direction_filters);
  RUN_TEST(test_bench_threshold_allows_four_kmh_at_two_metres);
  RUN_TEST(test_alert_gate_debounces_and_cools_down);
  RUN_TEST(test_alert_gate_handles_millis_wrap);
  RUN_TEST(test_target_quality_rejects_weak_and_bad_geometry);
  RUN_TEST(test_target_confirmation_requires_similar_consecutive_frames);
  RUN_TEST(test_target_confirmation_rejects_stale_previous_frame);
  RUN_TEST(test_ld2451_parses_official_example);
  RUN_TEST(test_ld2451_direction_mapping_can_be_reversed);
  RUN_TEST(test_ld2451_supports_marker_and_empty_heartbeat);
  RUN_TEST(test_ld2451_rejects_bad_length_and_trailer);
  RUN_TEST(test_ld2451_builds_configuration_commands);
  RUN_TEST(test_ld2451_parses_ack);
  RUN_TEST(test_message_crc_and_fields);
  RUN_TEST(test_sequence_tracker_rejects_duplicates_and_accepts_wrap);

  return UNITY_END();
}
