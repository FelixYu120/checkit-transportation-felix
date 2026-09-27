#pragma once

#include <stdint.h>

namespace CheckIt {

// Pure scheduling logic shared by the ESP32 uploader and native tests.
// Automatic cycles occur once per interval. A failed cycle is retried with
// capped exponential backoff, then left queued for the next hourly cycle.
class CloudUploadSchedule {
 public:
  CloudUploadSchedule(
      uint32_t intervalMs,
      uint32_t retryBaseMs,
      uint32_t retryMaxMs,
      uint8_t maxAttempts);

  void begin(uint32_t nowMs);
  bool automaticDue(uint32_t nowMs) const;
  void startAutomatic(uint32_t nowMs);
  void startManual(uint32_t nowMs);
  bool attemptDue(uint32_t nowMs) const;
  void recordAttempt(bool success, uint32_t nowMs);

  bool active() const;
  uint8_t attemptsMade() const;
  uint32_t millisecondsUntilAutomatic(uint32_t nowMs) const;

 private:
  void startCycle(uint32_t nowMs);
  uint32_t retryDelayMs(uint8_t failedAttempts) const;

  uint32_t intervalMs_;
  uint32_t retryBaseMs_;
  uint32_t retryMaxMs_;
  uint8_t maxAttempts_;
  uint32_t lastAutomaticMs_;
  uint32_t nextAttemptMs_;
  uint8_t attemptsMade_;
  bool active_;
};

}  // namespace CheckIt
