#include <unity.h>

#include "FlashRouter.h"

using namespace CheckIt;

namespace {

void test_uses_local_output_below_split() {
  const FlashRoute route =
      routeFlashByDistance(14, FlashRouteConfig{15});

  TEST_ASSERT_TRUE(route.flashLocal);
  TEST_ASSERT_FALSE(route.flashRemote);
  TEST_ASSERT_EQUAL_UINT8(FLASH_DESTINATION_LOCAL, route.destination);
  TEST_ASSERT_EQUAL_STRING("local", flashDestinationName(route.destination));
}

void test_uses_remote_output_at_and_above_split() {
  const FlashRoute atBoundary =
      routeFlashByDistance(15, FlashRouteConfig{15});
  const FlashRoute aboveBoundary =
      routeFlashByDistance(40, FlashRouteConfig{15});

  TEST_ASSERT_FALSE(atBoundary.flashLocal);
  TEST_ASSERT_TRUE(atBoundary.flashRemote);
  TEST_ASSERT_EQUAL_UINT8(
      FLASH_DESTINATION_REMOTE,
      atBoundary.destination);
  TEST_ASSERT_FALSE(aboveBoundary.flashLocal);
  TEST_ASSERT_TRUE(aboveBoundary.flashRemote);
  TEST_ASSERT_EQUAL_STRING(
      "remote",
      flashDestinationName(aboveBoundary.destination));
}

}  // namespace

void setUp() {}
void tearDown() {}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_uses_local_output_below_split);
  RUN_TEST(test_uses_remote_output_at_and_above_split);
  return UNITY_END();
}
