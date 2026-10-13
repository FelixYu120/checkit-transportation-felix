#include <unity.h>
#include "SpeedDisplayPolicy.h"
#include "DecisionEngine.h"

using namespace CheckIt;
namespace {
TargetQualityConfig config() { return {2, 80, 4, 45, 1, 161, 20, 3, 12, 4, 500}; }
RadarTarget target(uint8_t speed) { return {0, 0, 3, DIR_APPROACH, speed, 8}; }
bool frame(StableSpeedFilter &filter, uint32_t time, uint8_t speed, RadarTarget &out) {
  filter.beginFrame(time);
  bool accepted = filter.observe(target(speed), out);
  filter.endFrame();
  return accepted;
}
void stable_low_speed_and_median() {
  StableSpeedFilter filter(config()); RadarTarget out{};
  TEST_ASSERT_FALSE(frame(filter, 1000, 6, out));
  TEST_ASSERT_FALSE(frame(filter, 1100, 7, out));
  TEST_ASSERT_TRUE(frame(filter, 1200, 6, out));
  TEST_ASSERT_EQUAL_UINT8(6, out.speedKmh);
  DecisionConfig policy{5, 10, 15, 2, 80, 4, 45, true, true};
  TEST_ASSERT_TRUE(evaluateTarget(out, policy).shouldFlashLocal);
  policy.speedLimitKmh = 6;
  TEST_ASSERT_FALSE(evaluateTarget(out, policy).shouldFlashLocal);
}
void spike_and_two_frame_false_return_rejected() {
  StableSpeedFilter filter(config()); RadarTarget out{};
  TEST_ASSERT_FALSE(frame(filter, 1000, 23, out)); // ~14 mph
  TEST_ASSERT_FALSE(frame(filter, 1100, 23, out));
  filter.beginFrame(1200); filter.endFrame();
  TEST_ASSERT_FALSE(frame(filter, 1300, 9, out));
  TEST_ASSERT_FALSE(frame(filter, 1400, 10, out));
  TEST_ASSERT_FALSE(frame(filter, 1500, 23, out));
  TEST_ASSERT_FALSE(frame(filter, 1600, 9, out));
  TEST_ASSERT_FALSE(frame(filter, 1700, 10, out));
  TEST_ASSERT_TRUE(frame(filter, 1800, 9, out));
  TEST_ASSERT_EQUAL_UINT8(9, out.speedKmh);
}
void gap_direction_and_batched_frames_restart_confirmation() {
  StableSpeedFilter filter(config()); RadarTarget out{};
  frame(filter, 1000, 10, out); frame(filter, 1100, 10, out);
  TEST_ASSERT_FALSE(frame(filter, 1700, 10, out));
  filter.beginFrame(1800);
  RadarTarget away = target(10); away.direction = DIR_AWAY;
  TEST_ASSERT_FALSE(filter.observe(away, out)); filter.endFrame();
  StableSpeedFilter batched(config());
  TEST_ASSERT_FALSE(frame(batched, 1000, 10, out));
  TEST_ASSERT_FALSE(frame(batched, 1000, 10, out));
  TEST_ASSERT_FALSE(frame(batched, 1000, 10, out));
}
void one_prior_return_cannot_confirm_multiple_targets() {
  StableSpeedFilter filter(config()); RadarTarget out{};
  frame(filter, 1000, 10, out); frame(filter, 1100, 10, out);
  filter.beginFrame(1200);
  TEST_ASSERT_TRUE(filter.observe(target(10), out));
  TEST_ASSERT_FALSE(filter.observe(target(10), out));
  filter.endFrame();
}
void weak_out_of_range_and_unknown_returns_rejected() {
  StableSpeedFilter filter(config()); RadarTarget out{};
  for (uint32_t t = 1000; t <= 1400; t += 100) {
    filter.beginFrame(t);
    RadarTarget bad = target(10); bad.snr = 3;
    TEST_ASSERT_FALSE(filter.observe(bad, out));
    bad = target(10); bad.distanceM = 1;
    TEST_ASSERT_FALSE(filter.observe(bad, out));
    bad = target(10); bad.direction = DIR_UNKNOWN;
    TEST_ASSERT_FALSE(filter.observe(bad, out));
    filter.endFrame();
  }
}
void units_and_fixed_flash_window() {
  TEST_ASSERT_EQUAL_UINT8(0, SpeedDisplayState::mph(0));
  TEST_ASSERT_EQUAL_UINT8(4, SpeedDisplayState::mph(6));
  TEST_ASSERT_EQUAL_UINT8(14, SpeedDisplayState::mph(23));
  TEST_ASSERT_EQUAL_UINT8(60, SpeedDisplayState::mph(97));
  TEST_ASSERT_EQUAL_UINT8(99, SpeedDisplayState::mph(255));
  SpeedDisplayState display;
  TEST_ASSERT_EQUAL_INT(-1, display.value(1000));
  TEST_ASSERT_TRUE(display.start(23, 1000));
  TEST_ASSERT_EQUAL_INT(14, display.value(1299));
  TEST_ASSERT_EQUAL_INT(-1, display.value(1300));
  TEST_ASSERT_EQUAL_INT(14, display.value(1600));
  display.qualifiedTarget(2900);
  TEST_ASSERT_FALSE(display.start(30, 2900)); // must not extend the window
  TEST_ASSERT_EQUAL_INT(-1, display.value(3000));
  TEST_ASSERT_FALSE(display.start(23, 3500));
  TEST_ASSERT_EQUAL_INT(-1, display.value(3900));
  TEST_ASSERT_TRUE(display.start(23, 3900));
}
void mph_limit_uses_measurement_before_display_rounding() {
  TEST_ASSERT_FALSE(SpeedDisplayState::exceedsMphLimit(0, 8));
  TEST_ASSERT_FALSE(SpeedDisplayState::exceedsMphLimit(12, 8));
  TEST_ASSERT_TRUE(SpeedDisplayState::exceedsMphLimit(13, 8)); // 8.08 mph.
  TEST_ASSERT_EQUAL_UINT8(8, SpeedDisplayState::mph(13)); // Rounded sign may still show 08.
  TEST_ASSERT_TRUE(SpeedDisplayState::exceedsMphLimit(14, 8));
  TEST_ASSERT_FALSE(SpeedDisplayState::exceedsMphLimit(20, 13)); // 12.43 mph rounds to 12.
  TEST_ASSERT_TRUE(SpeedDisplayState::exceedsMphLimit(21, 13)); // 13.05 mph rounds to 13.
  TEST_ASSERT_TRUE(SpeedDisplayState::exceedsMphLimit(255, 120)); // Display saturation is independent.
  TEST_ASSERT_FALSE(SpeedDisplayState::exceedsMphLimit(255, 159));
}
void a_new_target_after_a_gap_rearms_before_timestamp_update() {
  SpeedDisplayState display;
  TEST_ASSERT_TRUE(display.start(10, 1000));
  display.qualifiedTarget(5000);
  TEST_ASSERT_TRUE(display.start(10, 5000));
  SpeedDisplayState custom(1000, 200);
  TEST_ASSERT_TRUE(custom.start(10, 1000));
  TEST_ASSERT_EQUAL_INT(-1, custom.value(1200));
  TEST_ASSERT_EQUAL_INT(6, custom.value(1400));
  TEST_ASSERT_EQUAL_INT(-1, custom.value(2000));
}
void live_speed_changes_without_resetting_flash_phase_or_deadline() {
  SpeedDisplayState display;
  TEST_ASSERT_FALSE(display.updateSpeed(7, 900)); // Does not create an alert.
  TEST_ASSERT_TRUE(display.start(4, 1000));
  TEST_ASSERT_EQUAL_INT(2, display.value(1000));
  TEST_ASSERT_TRUE(display.updateSpeed(7, 1100));
  TEST_ASSERT_EQUAL_INT(4, display.value(1100));
  TEST_ASSERT_FALSE(display.updateSpeed(6, 1200)); // Also rounds to 4 mph.
  TEST_ASSERT_EQUAL_INT(-1, display.value(1300));
  TEST_ASSERT_TRUE(display.updateSpeed(10, 1400)); // Update while LEDs are off.
  TEST_ASSERT_EQUAL_INT(-1, display.value(1400)); // Must not restart blink phase.
  TEST_ASSERT_EQUAL_INT(6, display.value(1600));
  TEST_ASSERT_TRUE(display.updateSpeed(255, 2800));
  TEST_ASSERT_EQUAL_UINT8(99, display.speedMph());
  TEST_ASSERT_FALSE(display.updateSpeed(20, 3000)); // Original two-second deadline.
  TEST_ASSERT_FALSE(display.active());
  TEST_ASSERT_EQUAL_INT(-1, display.value(3000));
  TEST_ASSERT_FALSE(display.updateSpeed(30, 5000)); // Does not restart expired alert.
}
void live_speed_handles_timer_wrap() {
  SpeedDisplayState display;
  TEST_ASSERT_TRUE(display.start(4, UINT32_MAX - 999));
  TEST_ASSERT_TRUE(display.updateSpeed(7, 0));
  TEST_ASSERT_EQUAL_INT(-1, display.value(0)); // Still the original off phase.
  TEST_ASSERT_EQUAL_INT(4, display.value(200));
  TEST_ASSERT_FALSE(display.updateSpeed(10, 1000));
  TEST_ASSERT_FALSE(display.active());
}
void peak_speed_only_rises_and_resets_for_the_next_alert() {
  SpeedDisplayState display;
  TEST_ASSERT_FALSE(display.updatePeakSpeed(30, 900));
  TEST_ASSERT_TRUE(display.start(13, 1000));
  TEST_ASSERT_EQUAL_INT(8, display.value(1000));
  TEST_ASSERT_TRUE(display.updatePeakSpeed(16, 1100));
  TEST_ASSERT_EQUAL_INT(10, display.value(1100));
  TEST_ASSERT_TRUE(display.updatePeakSpeed(19, 1200));
  TEST_ASSERT_FALSE(display.updatePeakSpeed(16, 1250));
  TEST_ASSERT_EQUAL_INT(12, display.value(1250));
  TEST_ASSERT_TRUE(display.updatePeakSpeed(23, 1400));
  TEST_ASSERT_EQUAL_INT(-1, display.value(1400)); // Peak changes do not restart blink phase.
  TEST_ASSERT_EQUAL_INT(14, display.value(1600));
  TEST_ASSERT_FALSE(display.updatePeakSpeed(19, 1700));
  TEST_ASSERT_EQUAL_INT(14, display.value(2800));
  TEST_ASSERT_FALSE(display.updatePeakSpeed(30, 3000));
  TEST_ASSERT_FALSE(display.active()); // Original deadline, despite peak increases.
  TEST_ASSERT_TRUE(display.start(4, 5000));
  TEST_ASSERT_EQUAL_INT(2, display.value(5000)); // No peak carried into a new alert.
}
void startup_lights_all_segments_then_five_pulses_and_blanks() {
  StartupDisplaySequence sequence;
  TEST_ASSERT_EQUAL_INT(-1, sequence.value(0));
  sequence.start(100);
  TEST_ASSERT_EQUAL_INT(StartupDisplaySequence::kAllSegments, sequence.value(100));
  TEST_ASSERT_EQUAL_INT(StartupDisplaySequence::kAllSegments, sequence.value(2099));
  for (uint8_t pulse = 0; pulse < 5; ++pulse) {
    const uint32_t on = 2100 + pulse * 600;
    TEST_ASSERT_EQUAL_INT(66, sequence.value(on));
    TEST_ASSERT_EQUAL_INT(66, sequence.value(on + 299));
    TEST_ASSERT_EQUAL_INT(-1, sequence.value(on + 300));
    TEST_ASSERT_EQUAL_INT(-1, sequence.value(on + 599));
    TEST_ASSERT_TRUE(sequence.active());
  }
  TEST_ASSERT_EQUAL_INT(-1, sequence.value(5100));
  TEST_ASSERT_FALSE(sequence.active());
  TEST_ASSERT_EQUAL_INT(-1, sequence.value(12000));
  sequence.start(12000);
  TEST_ASSERT_EQUAL_INT(StartupDisplaySequence::kAllSegments, sequence.value(12000));
  TEST_ASSERT_EQUAL_INT(-1, sequence.value(17000));
  TEST_ASSERT_FALSE(sequence.active());
}
void startup_handles_timer_wrap_and_disabled_flashes() {
  StartupDisplaySequence sequence;
  sequence.start(UINT32_MAX - 999);
  TEST_ASSERT_EQUAL_INT(StartupDisplaySequence::kAllSegments, sequence.value(999));
  TEST_ASSERT_EQUAL_INT(66, sequence.value(1000));
  TEST_ASSERT_EQUAL_INT(-1, sequence.value(4000));
  TEST_ASSERT_FALSE(sequence.active());
  StartupDisplaySequence allOnly(2000, 300, 0);
  allOnly.start(0);
  TEST_ASSERT_EQUAL_INT(StartupDisplaySequence::kAllSegments, allOnly.value(1999));
  TEST_ASSERT_EQUAL_INT(-1, allOnly.value(2000));
  TEST_ASSERT_FALSE(allOnly.active());
}
void millis_wrap_does_not_extend_flash() {
  SpeedDisplayState display;
  TEST_ASSERT_TRUE(display.start(10, UINT32_MAX - 999));
  TEST_ASSERT_EQUAL_INT(-1, display.value(1000));
  TEST_ASSERT_FALSE(display.active());
}
}
void setUp() {}
void tearDown() {}
int main() {
  UNITY_BEGIN();
  RUN_TEST(stable_low_speed_and_median);
  RUN_TEST(spike_and_two_frame_false_return_rejected);
  RUN_TEST(gap_direction_and_batched_frames_restart_confirmation);
  RUN_TEST(one_prior_return_cannot_confirm_multiple_targets);
  RUN_TEST(weak_out_of_range_and_unknown_returns_rejected);
  RUN_TEST(units_and_fixed_flash_window);
  RUN_TEST(mph_limit_uses_measurement_before_display_rounding);
  RUN_TEST(a_new_target_after_a_gap_rearms_before_timestamp_update);
  RUN_TEST(live_speed_changes_without_resetting_flash_phase_or_deadline);
  RUN_TEST(live_speed_handles_timer_wrap);
  RUN_TEST(peak_speed_only_rises_and_resets_for_the_next_alert);
  RUN_TEST(millis_wrap_does_not_extend_flash);
  RUN_TEST(startup_lights_all_segments_then_five_pulses_and_blanks);
  RUN_TEST(startup_handles_timer_wrap_and_disabled_flashes);
  return UNITY_END();
}
