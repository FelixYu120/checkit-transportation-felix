#pragma once

#include <Arduino.h>
#include <FS.h>
#include <Preferences.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <stdint.h>

#include "Ld2415hProtocol.h"

namespace CheckIt {

struct ReferenceSample {
  uint32_t bootId;
  uint32_t sequence;
  uint32_t uptimeMs;
  uint32_t observedEpoch;
  int16_t signedSpeedTenthsKmh;
  Ld2415hDirection direction;
  uint8_t raw[kLd2415hMeasurementBytes];
};

struct ReferenceTelemetryConfig {
  const char *projectUrl;
  const char *publishableKey;
  const char *tableName;
  const char *primarySensorId;
  const char *referenceSensorId;
  const char *testRunId;
  bool useFfat;
};

struct ReferenceTelemetryStats {
  bool storageReady;
  bool cloudEnabled;
  uint32_t pendingSamples;
  uint32_t enqueuedSamples;
  uint32_t droppedSamples;
  uint32_t uploadedSamples;
  uint32_t uploadFailures;
  uint32_t corruptRecords;
  uint32_t persistFailures;
  int32_t lastHttpStatus;
  uint32_t lastSuccessMs;
};

// Durable, idempotent reference-sample uploader. UART acquisition calls
// enqueue() without waiting for flash or HTTPS; a separate low-priority task
// owns the LittleFS journal and cloud operations.
class ReferenceTelemetry {
 public:
  explicit ReferenceTelemetry(const ReferenceTelemetryConfig &config);

  bool begin();
  bool enqueue(const ReferenceSample &sample);
  bool requestUploadNow();
  ReferenceTelemetryStats stats() const;

 private:
  struct JournalRecord;

  static void taskEntry(void *context);
  void run();
  bool mountStorage();
  fs::FS &storage();
  bool scanJournal();
  bool appendRecord(const ReferenceSample &sample);
  size_t readBatch(
      ReferenceSample *samples,
      size_t capacity,
      uint32_t &nextOffset);
  bool acknowledge(uint32_t nextOffset, size_t uploadedCount);
  bool compact();
  bool repairTrailingBytes(uint32_t alignedSize);
  bool uploadBatch(const ReferenceSample *samples, size_t count);
  String buildPayload(const ReferenceSample *samples, size_t count) const;
  bool cloudConfigurationReady() const;
  uint32_t crc32(const uint8_t *data, size_t length) const;
  bool validRecord(const JournalRecord &record) const;
  void setLastHttpStatus(int32_t status);

  ReferenceTelemetryConfig config_;
  Preferences preferences_;
  QueueHandle_t queue_;
  TaskHandle_t task_;
  uint32_t acknowledgedOffset_;
  uint32_t fileBytes_;
  uint32_t nextAutomaticUploadMs_;
  uint32_t nextRetryMs_;
  bool uploadRequested_;
  mutable portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
  ReferenceTelemetryStats stats_;
};

}  // namespace CheckIt
