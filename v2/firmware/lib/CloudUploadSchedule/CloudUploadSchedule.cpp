#include "CloudUploadSchedule.h"

#include <limits.h>

namespace CheckIt {

CloudUploadSchedule::CloudUploadSchedule(
    uint32_t intervalMs,
    uint32_t retryBaseMs,
    uint32_t retryMaxMs,
    uint8_t maxAttempts)
    : intervalMs_(intervalMs),
      retryBaseMs_(retryBaseMs),
      retryMaxMs_(retryMaxMs),
      maxAttempts_(maxAttempts == 0 ? 1 : maxAttempts),
      lastAutomaticMs_(0),
      nextAttemptMs_(0),
      attemptsMade_(0),
      active_(false) {}

void CloudUploadSchedule::begin(uint32_t nowMs) {
  lastAutomaticMs_ = nowMs;
  nextAttemptMs_ = nowMs;
  attemptsMade_ = 0;
  active_ = false;
}

bool CloudUploadSchedule::automaticDue(uint32_t nowMs) const {
  return static_cast<uint32_t>(nowMs - lastAutomaticMs_) >= intervalMs_;
}

void CloudUploadSchedule::startCycle(uint32_t nowMs) {
  nextAttemptMs_ = nowMs;
  attemptsMade_ = 0;
  active_ = true;
}

void CloudUploadSchedule::startAutomatic(uint32_t nowMs) {
  lastAutomaticMs_ = nowMs;
  startCycle(nowMs);
}

void CloudUploadSchedule::startManual(uint32_t nowMs) {
  startCycle(nowMs);
}

bool CloudUploadSchedule::attemptDue(uint32_t nowMs) const {
  return active_ &&
      static_cast<int32_t>(nowMs - nextAttemptMs_) >= 0;
}

uint32_t CloudUploadSchedule::retryDelayMs(
    uint8_t failedAttempts) const {
  uint64_t delay = retryBaseMs_;
  for (uint8_t i = 1; i < failedAttempts; ++i) {
    delay *= 2U;
    if (delay >= retryMaxMs_) {
      return retryMaxMs_;
    }
  }
  if (delay > retryMaxMs_) {
    return retryMaxMs_;
  }
  return static_cast<uint32_t>(delay);
}

void CloudUploadSchedule::recordAttempt(
    bool success,
    uint32_t nowMs) {
  if (!active_) {
    return;
  }
  if (success) {
    active_ = false;
    return;
  }

  if (attemptsMade_ != UINT8_MAX) {
    ++attemptsMade_;
  }
  if (attemptsMade_ >= maxAttempts_) {
    active_ = false;
    return;
  }
  nextAttemptMs_ = nowMs + retryDelayMs(attemptsMade_);
}

bool CloudUploadSchedule::active() const {
  return active_;
}

uint8_t CloudUploadSchedule::attemptsMade() const {
  return attemptsMade_;
}

uint32_t CloudUploadSchedule::millisecondsUntilAutomatic(
    uint32_t nowMs) const {
  const uint32_t elapsed = nowMs - lastAutomaticMs_;
  return elapsed >= intervalMs_ ? 0 : intervalMs_ - elapsed;
}

}  // namespace CheckIt
