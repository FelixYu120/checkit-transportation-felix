#include <unity.h>

#include "CloudUploadSchedule.h"

using namespace CheckIt;

namespace {

constexpr uint32_t kHourMs = 3600000UL;

void testAutomaticCycleRunsHourly() {
  CloudUploadSchedule schedule(kHourMs, 15000UL, 120000UL, 5);
  schedule.begin(1000UL);

  TEST_ASSERT_FALSE(schedule.automaticDue(1000UL + kHourMs - 1UL));
  TEST_ASSERT_EQUAL_UINT32(1UL, schedule.millisecondsUntilAutomatic(
      1000UL + kHourMs - 1UL));
  TEST_ASSERT_TRUE(schedule.automaticDue(1000UL + kHourMs));

  schedule.startAutomatic(1000UL + kHourMs);
  TEST_ASSERT_TRUE(schedule.attemptDue(1000UL + kHourMs));
  schedule.recordAttempt(true, 1000UL + kHourMs);
  TEST_ASSERT_FALSE(schedule.active());
  TEST_ASSERT_EQUAL_UINT32(
      kHourMs,
      schedule.millisecondsUntilAutomatic(1000UL + kHourMs));
}

void testManualCycleDoesNotMoveHourlyDeadline() {
  CloudUploadSchedule schedule(kHourMs, 15000UL, 120000UL, 5);
  schedule.begin(500UL);
  schedule.startManual(1000UL);
  schedule.recordAttempt(true, 1000UL);

  TEST_ASSERT_FALSE(schedule.automaticDue(500UL + kHourMs - 1UL));
  TEST_ASSERT_TRUE(schedule.automaticDue(500UL + kHourMs));
}

void testFailuresUseCappedBackoffAndStopAfterFiveAttempts() {
  CloudUploadSchedule schedule(kHourMs, 15000UL, 120000UL, 5);
  schedule.begin(0);
  schedule.startManual(100UL);

  const uint32_t attemptTimes[] = {
      100UL,
      15100UL,
      45100UL,
      105100UL,
      225100UL};
  for (uint8_t i = 0; i < 5; ++i) {
    TEST_ASSERT_TRUE(schedule.attemptDue(attemptTimes[i]));
    schedule.recordAttempt(false, attemptTimes[i]);
    TEST_ASSERT_EQUAL_UINT8(i + 1, schedule.attemptsMade());
  }
  TEST_ASSERT_FALSE(schedule.active());
}

void testHourlyElapsedCheckSurvivesMillisWraparound() {
  CloudUploadSchedule schedule(1000UL, 10UL, 100UL, 3);
  schedule.begin(UINT32_MAX - 499UL);

  TEST_ASSERT_FALSE(schedule.automaticDue(499UL));
  TEST_ASSERT_TRUE(schedule.automaticDue(500UL));
}

}  // namespace

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(testAutomaticCycleRunsHourly);
  RUN_TEST(testManualCycleDoesNotMoveHourlyDeadline);
  RUN_TEST(testFailuresUseCappedBackoffAndStopAfterFiveAttempts);
  RUN_TEST(testHourlyElapsedCheckSurvivesMillisWraparound);
  return UNITY_END();
}
