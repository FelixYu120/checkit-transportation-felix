#pragma once

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

#include "CheckItConfig.h"
#include "CheckItCore.h"
#include "CloudPassage.h"
#include "CloudUploadSchedule.h"
#include "PassageJournal.h"
#include "TrafficTracker.h"

namespace CheckIt {

struct CloudTelemetryConfig {
  const char *projectUrl;
  const char *publishableKey;
  const char *summaryTableName;
  const char *passageTableName;
  const char *healthTableName;
  const char *sensorId;
  bool (*networkTimeReady)();
};

struct CloudHealthSnapshot {
  char deviceName[32];
  char wifiSsid[33];
  uint32_t bootId;
  uint32_t uptimeMs;
  uint32_t radarFrameCount;
  uint32_t radarFrameErrors;
  uint32_t lowSnrReturnsFiltered;
  uint32_t slowReturnsExcluded;
  uint32_t weakExtremeSpeedReturnsFiltered;
  uint32_t targetCapacityFrames;
  uint32_t truncatedTargetFrames;
  uint32_t lastRadarFrameAgeMs;
  uint32_t lastPassageEpoch;
  int16_t wifiRssiDbm;
  uint8_t speedLimitKmh;
  uint8_t maximumReportedTargets;
  uint8_t resetReason;
  bool radarActive;
  bool provisioned;
  bool bleActive;
};

struct CloudTelemetryStats {
  uint32_t enqueuedPassages;
  uint32_t droppedPassages;
  uint32_t uploadedPassages;
  uint32_t uploadedSummaries;
  uint32_t pendingPassages;
  uint32_t droppedSummaries;
  uint32_t uploadAttempts;
  uint32_t uploadFailures;
  uint32_t uploadCycles;
  uint32_t manualUploadRequests;
  uint32_t pendingSummaries;
  uint32_t nextAutomaticUploadMs;
  uint32_t lastAttemptMs;
  uint32_t lastSuccessMs;
  int32_t lastHttpStatus;
  uint8_t retryAttempts;
  bool retryPending;
  bool storageReady;
  uint32_t storageUsedBytes;
  uint32_t storageFreeBytes;
  uint32_t corruptPassages;
  uint32_t persistFailures;
  uint32_t uploadedHealthReports;
  uint32_t healthUploadFailures;
  uint32_t lastHealthSuccessMs;
};

class CloudTelemetry {
 public:
  explicit CloudTelemetry(const CloudTelemetryConfig &config);

  // Initializes durable storage first. Returns true in storage-only mode when
  // credentials are absent; enabled() separately reports whether the HTTPS
  // task is configured. The radar warning path remains operational either way.
  bool begin();
  bool enabled() const;
  bool storageReady() const;
  bool enqueue(const CloudPassage &passage);
  void updateHealth(const CloudHealthSnapshot &snapshot);
  bool requestUploadNow();
  size_t queueDepth() const;
  CloudTelemetryStats stats() const;

 private:
  struct DirectionSummary {
    uint32_t bucketEpoch;
    Direction direction;
    uint32_t volume;
    uint32_t eventCount;
    uint32_t speedSumKmh;
    uint8_t maxSpeedKmh;
    uint16_t peakSpeedHistogram[256];
    bool dirty;
  };

  struct PreparedSummary {
    uint32_t bucketEpoch;
    Direction direction;
    uint32_t volume;
    uint32_t eventCount;
    uint32_t speedSumKmh;
    uint8_t v85SpeedKmh;
    uint8_t maxSpeedKmh;
  };

  static void taskEntry(void *context);
  void run();
  void processPassage(const CloudPassage &passage);
  void resetSummary(
      size_t slot,
      Direction direction,
      uint32_t bucketEpoch);
  void stageDirtySummaries();
  bool stageSummary(const DirectionSummary &summary);
  bool uploadPendingSummaries();
  bool uploadPendingPassages();
  bool uploadHealth();
  bool uploadSummaries(
      const PreparedSummary *summaries,
      size_t summaryCount);
  String buildPayload(
      const PreparedSummary *summaries,
      size_t summaryCount) const;
  String buildPassagePayload(
      const CloudPassage *passages,
      size_t passageCount) const;
  String buildHealthPayload(const CloudHealthSnapshot &snapshot) const;
  void appendSummaryObject(
      String &json,
      const PreparedSummary &summary) const;
  void appendPassageObject(
      String &json,
      const CloudPassage &passage) const;
  bool postPayload(
      const char *tableName,
      const char *conflictColumns,
      const String &payload,
      uint32_t rowCount,
      const char *rowLabel);
  uint8_t percentile85(const DirectionSummary &summary) const;
  bool configurationReady() const;
  int directionSlot(Direction direction) const;
  bool consumeUploadRequest();
  bool consumeHealthRequest();
  void updateScheduleStats();
  void recordQueueResult(bool accepted);
  void recordAttempt(
      int32_t httpStatus,
      bool success);
  void recordDiscardedSummary();

  CloudTelemetryConfig config_;
  QueueHandle_t queue_;
  TaskHandle_t task_;
  bool enabled_;
  bool storageReady_;
  bool uploadRequested_;
  bool healthUploadRequested_;
  CloudUploadSchedule uploadSchedule_;
  PassageJournal passageJournal_;
  DirectionSummary summaries_[2];
  PreparedSummary pendingSummaries_[CHECKIT_CLOUD_PENDING_SUMMARY_DEPTH];
  size_t pendingSummaryCount_;
  CloudHealthSnapshot healthSnapshot_;
  bool healthAvailable_;
  uint32_t nextHealthAttemptMs_;
  mutable portMUX_TYPE controlMux_ = portMUX_INITIALIZER_UNLOCKED;
  mutable portMUX_TYPE healthMux_ = portMUX_INITIALIZER_UNLOCKED;
  mutable portMUX_TYPE statsMux_ = portMUX_INITIALIZER_UNLOCKED;
  CloudTelemetryStats stats_;
};

}  // namespace CheckIt
