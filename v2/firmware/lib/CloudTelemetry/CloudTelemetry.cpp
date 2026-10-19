#include "CloudTelemetry.h"

#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "TrafficFeatures.h"
#include "SupabaseTrust.h"
#include <string.h>
#include <time.h>

#include "CheckItConfig.h"

namespace CheckIt {
namespace {

// Supabase can rotate hosted projects between Let's Encrypt and Google Trust
// Services. Trust the roots observed on both secure endpoint chains.
// Certificate validation stays enabled; never replace this with setInsecure().
// Root YR source: https://letsencrypt.org/certs/gen-y/root-yr.pem
// SHA-256: E5:7B:7E:6F:15:0C:41:91:02:E8:D5:C0:55:72:9F:F9:
//             67:B9:D1:A8:29:BF:00:CE:C8:9C:A6:04:EB:F4:A8:6F
// GTS Root R4 source: https://good.gtsr4.demosite.pki.goog/
// SHA-256: 34:9D:FA:40:58:C5:E2:63:12:3B:39:8A:E7:95:57:3C:
//             4E:13:13:C8:3F:E6:8F:93:55:6C:D5:E8:03:1B:3C:7D
const char kSupabaseTrustAnchors[] PROGMEM = R"CERT(-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFKTCCAxGgAwIBAgIRAOxGNJNgz0sP+KmC2Tqpyj0wDQYJKoZIhvcNAQELBQAw
LjELMAkGA1UEBhMCVVMxDTALBgNVBAoTBElTUkcxEDAOBgNVBAMTB1Jvb3QgWVIw
HhcNMjUwOTAzMDAwMDAwWhcNNDUwOTAyMjM1OTU5WjAuMQswCQYDVQQGEwJVUzEN
MAsGA1UEChMESVNSRzEQMA4GA1UEAxMHUm9vdCBZUjCCAiIwDQYJKoZIhvcNAQEB
BQADggIPADCCAgoCggIBANvGJnN78CTJdWL3+eGfsLN5TrNBJs+VH9hRXqRbwxu9
sGNiB0BD1fcOxbSUQCJIM1xE13Db+5Cw1w0s0EBYsvuIP/6joF0w8cuImbgR1OGg
YbSQ4OpzI+DG8SGuTlcE873OCS+kh3srlo6vl43M5OJg4Aeo1sfHp6kTJDoIiFBN
JAY+OKfX/FUvYKuhjT+no49lmqmupSBI5PkBQiqrEGtWU5uxU/cQWHGu8jSjFBzn
ZqvbNPLMXMLFxCb3WTfrJBXXjqvWG+v4bjzxjjeAtOlU7qarRDvNOyAuQYLln904
M+faKx8hnLCpJ15ZqaEgcNlY+9MMWcC5yvL2A2j3l9+2buggZX+dOE91zYmIdawT
vSZuVvlbRrAlLxIB6pwMBjneXCjYQ8+3BCCjssbSNpZU3hTcBDdhfAlEDlYr6pEa
tnMdmDT5BqnKC92bd0EhM1fbLHioLccLCuievT8ZkPhZrq7Mii7gNXAcUEAR8+lz
Yal+9zTg7C5DALyVOeG/CqfRAMn1KSHCR0NSA6P8tn/mGRlnCct5rtVCLnVySVpU
6H1qGg3DgTOuskf8eahTMiYbI5ezPJmO5ertalskQ1utp74+eDy92PI4ftHKTbq9
IWhH4YZKh3WnJEIt+oQvlYZbY8tpEroKrFB6PFGzrJIDRyts4HqvuH52RFj2zv/B
AgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/MB0GA1Ud
DgQWBBTe51tg0CJtQCh9Pw0B/qS1UrRRlDANBgkqhkiG9w0BAQsFAAOCAgEAWHnf
713Bdkq7t5yN2dNIgQakUb94X9WuyhMEHHkgx4oDpSUlnG0w4g94MoqaEUE31ZjR
LU7L5LD1g9ujFHTQu8AD215AHMVQFbm6j8hQxdXHAzDajFNQnOlDJrLjzIx176oy
AjvUtejZx2NNmdb5fd0WGVGsCdoAJ3N8ozo7ajE8t6vfxStZb4BQ9WYJGHUDrv2N
i5tJF6CNiPnlzs3BUfECRbE4JSk+jvy8+VoGiFE8qsH/j78x2fjgQhAQFV7P7Zxy
dBTZ1wEkNpZNW2qnaK1SKBLa+xf6E06YRIq5uaI+HWH8SY1y5VbRgzq40EKg3yxP
06fz+uYAUIFJoLNfhwRCc3Q6pQVuMX3yAjHAes4gk4moGcLQ5p7HAh39yeylZc1J
41sx/jKwLIkPE6Rr1Nf4pxdsxf9SA4yOEiAkDgq04DVxn8hgYFdUtBCuiuVC2heA
EiqVEa+8QZjuw8Gj0EbHXcRd1nInvGqRS1o9Is7YBdQN57X1AYveGBNNqjICSb7c
awuw1EawTDrs13VUlJVEsbQ0/O/1aaV73mCdOQ8azqL2KTv1Ewu1xbquE2S+kdQU
To9TUwat3wUA6cwXh1EfpS/3fJ0aGah5hdpRyoCLDlsSn8tkrjMfFFX0viC+GxHc
sI1ANRYvqSFC2X1VRZfDg+wD6E21BccmifG4yWc=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi
QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR
HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8
p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
)CERT";

bool hasRealValue(const char *value) {
  return value != nullptr && value[0] != '\0' &&
      strstr(value, "YOUR_") == nullptr;
}

void appendJsonString(String &json, const char *value) {
  json += '"';
  if (value != nullptr) {
    while (*value != '\0') {
      const char c = *value++;
      switch (c) {
        case '"':
          json += F("\\\"");
          break;
        case '\\':
          json += F("\\\\");
          break;
        case '\n':
          json += F("\\n");
          break;
        case '\r':
          json += F("\\r");
          break;
        case '\t':
          json += F("\\t");
          break;
        default:
          if (static_cast<uint8_t>(c) >= 0x20) {
            json += c;
          }
          break;
      }
    }
  }
  json += '"';
}

void appendObservedAt(String &json, uint32_t epoch) {
  if (epoch < CHECKIT_MIN_VALID_UNIX_TIME) {
    json += F("null");
    return;
  }

  const time_t timestamp = static_cast<time_t>(epoch);
  struct tm utcTime {};
  gmtime_r(&timestamp, &utcTime);
  char formatted[25]{};
  strftime(formatted, sizeof(formatted), "%Y-%m-%dT%H:%M:%SZ", &utcTime);
  appendJsonString(json, formatted);
}

}  // namespace

const char *supabaseTrustAnchors() {
  return kSupabaseTrustAnchors;
}

CloudTelemetry::CloudTelemetry(const CloudTelemetryConfig &config)
    : config_(config),
      queue_(nullptr),
      task_(nullptr),
      enabled_(false),
      storageReady_(false),
      uploadRequested_(false),
      healthUploadRequested_(false),
      uploadSchedule_(
          CHECKIT_CLOUD_UPLOAD_INTERVAL_MS,
          CHECKIT_CLOUD_RETRY_BASE_MS,
          CHECKIT_CLOUD_RETRY_MAX_MS,
          CHECKIT_CLOUD_MAX_ATTEMPTS),
      passageJournal_(),
      summaries_{},
      pendingSummaries_{},
      pendingSummaryCount_(0),
      healthSnapshot_{},
      healthAvailable_(false),
      nextHealthAttemptMs_(0),
      stats_{} {}

bool CloudTelemetry::configurationReady() const {
  const bool supportedPublicKey =
      config_.publishableKey != nullptr &&
      (strncmp(config_.publishableKey, "sb_publishable_", 15) == 0 ||
       strncmp(config_.publishableKey, "eyJ", 3) == 0);
  return CHECKIT_ENABLE_CLOUD_UPLOAD &&
      hasRealValue(config_.projectUrl) &&
      hasRealValue(config_.publishableKey) &&
      hasRealValue(config_.summaryTableName) &&
      hasRealValue(config_.passageTableName) &&
      hasRealValue(config_.healthTableName) &&
      hasRealValue(config_.sensorId) &&
      config_.networkTimeReady != nullptr &&
      supportedPublicKey &&
      strncmp(config_.projectUrl, "https://", 8) == 0;
}

bool CloudTelemetry::begin() {
  storageReady_ = passageJournal_.begin();
  if (!storageReady_) {
    Serial.println(
        "[STORAGE] durable passage journal unavailable; completed tracks "
        "will be held in RAM and retried instead of silently discarded");
    return false;
  }

  if (!configurationReady()) {
    Serial.println(
        "[CLOUD] upload disabled: configure CheckItSecrets.h; passages "
        "will remain safely stored on this node");
    return true;
  }

  queue_ = xQueueCreate(
      CHECKIT_CLOUD_QUEUE_DEPTH,
      sizeof(CloudPassage));
  if (queue_ == nullptr) {
    Serial.println("[CLOUD] disabled: queue allocation failed");
    return false;
  }

  uploadSchedule_.begin(millis());
  nextHealthAttemptMs_ = millis() + CHECKIT_CLOUD_HEALTH_STARTUP_DELAY_MS;
  const BaseType_t result = xTaskCreate(
      taskEntry,
      "cloud-upload",
      CHECKIT_CLOUD_TASK_STACK_BYTES,
      this,
      1,
      &task_);
  if (result != pdPASS) {
    vQueueDelete(queue_);
    queue_ = nullptr;
    task_ = nullptr;
    Serial.println("[CLOUD] disabled: task allocation failed");
    return false;
  }

  enabled_ = true;
  Serial.printf(
      "[CLOUD] tracker uploader ready sensor=%s passages=%s summaries=%s "
      "health=%s/%lumin send=hourly retries=%u\n",
      config_.sensorId,
      config_.passageTableName,
      config_.summaryTableName,
      config_.healthTableName,
      static_cast<unsigned long>(CHECKIT_CLOUD_HEALTH_INTERVAL_MS / 60000UL),
      static_cast<unsigned int>(CHECKIT_CLOUD_MAX_ATTEMPTS));
  return true;
}

bool CloudTelemetry::enabled() const {
  return enabled_;
}

bool CloudTelemetry::storageReady() const {
  return storageReady_;
}

bool CloudTelemetry::enqueue(const CloudPassage &passage) {
  // Non-accepted tracks are consumed locally, never persisted to the outbox.
  if (passage.passage.qualityStatus != TRACK_ACCEPTED) {
    Serial.printf("[CLOUD] local-only track %lu quality=%s\n",
        static_cast<unsigned long>(passage.passage.trackId),
        trackQualityName(passage.passage.qualityStatus));
    return true;
  }
  if (!storageReady_) {
    return false;
  }
  if (passage.bootId == 0 ||
      passage.passage.trackId == 0 ||
      directionSlot(passage.passage.direction) < 0) {
    recordQueueResult(false);
    return false;
  }
  const bool accepted = passageJournal_.append(passage);
  if (accepted && queue_ != nullptr &&
      xQueueSend(queue_, &passage, 0) != pdTRUE) {
    // The durable journal is authoritative. A full transient queue can delay
    // local summary calculation, but the complete path still uploads and the
    // Supabase class-summary view remains exact.
    Serial.println(
        "[CLOUD] RAM notification queue full; durable passage retained");
  }
  recordQueueResult(accepted);
  return accepted;
}

void CloudTelemetry::updateHealth(const CloudHealthSnapshot &snapshot) {
  portENTER_CRITICAL(&healthMux_);
  healthSnapshot_ = snapshot;
  healthAvailable_ = true;
  portEXIT_CRITICAL(&healthMux_);
}

bool CloudTelemetry::requestUploadNow() {
  if (!enabled_) {
    return false;
  }
  portENTER_CRITICAL(&controlMux_);
  uploadRequested_ = true;
  healthUploadRequested_ = true;
  portEXIT_CRITICAL(&controlMux_);
  portENTER_CRITICAL(&statsMux_);
  ++stats_.manualUploadRequests;
  portEXIT_CRITICAL(&statsMux_);
  return true;
}

size_t CloudTelemetry::queueDepth() const {
  return passageJournal_.pendingCount();
}

CloudTelemetryStats CloudTelemetry::stats() const {
  portENTER_CRITICAL(&statsMux_);
  CloudTelemetryStats copy = stats_;
  portEXIT_CRITICAL(&statsMux_);
  const PassageJournalStats storage = passageJournal_.stats();
  copy.pendingPassages = storage.pendingRecords;
  copy.storageReady = storage.ready;
  copy.storageUsedBytes = storage.usedBytes;
  copy.storageFreeBytes = storage.freeBytes;
  copy.corruptPassages = storage.corruptRecords;
  copy.persistFailures = storage.persistFailures;
  return copy;
}

bool CloudTelemetry::consumeUploadRequest() {
  portENTER_CRITICAL(&controlMux_);
  const bool requested = uploadRequested_;
  uploadRequested_ = false;
  portEXIT_CRITICAL(&controlMux_);
  return requested;
}

bool CloudTelemetry::consumeHealthRequest() {
  portENTER_CRITICAL(&controlMux_);
  const bool requested = healthUploadRequested_;
  healthUploadRequested_ = false;
  portEXIT_CRITICAL(&controlMux_);
  return requested;
}

void CloudTelemetry::updateScheduleStats() {
  const PassageJournalStats storage = passageJournal_.stats();
  portENTER_CRITICAL(&statsMux_);
  stats_.pendingPassages = storage.pendingRecords;
  stats_.pendingSummaries = pendingSummaryCount_;
  stats_.nextAutomaticUploadMs =
      uploadSchedule_.millisecondsUntilAutomatic(millis());
  stats_.retryAttempts = uploadSchedule_.attemptsMade();
  stats_.retryPending = uploadSchedule_.active();
  stats_.storageReady = storage.ready;
  stats_.storageUsedBytes = storage.usedBytes;
  stats_.storageFreeBytes = storage.freeBytes;
  stats_.corruptPassages = storage.corruptRecords;
  stats_.persistFailures = storage.persistFailures;
  portEXIT_CRITICAL(&statsMux_);
}

void CloudTelemetry::recordQueueResult(bool accepted) {
  portENTER_CRITICAL(&statsMux_);
  if (accepted) {
    ++stats_.enqueuedPassages;
  } else {
    ++stats_.droppedPassages;
  }
  portEXIT_CRITICAL(&statsMux_);
}

void CloudTelemetry::recordAttempt(
    int32_t httpStatus,
    bool success) {
  const uint32_t nowMs = millis();
  portENTER_CRITICAL(&statsMux_);
  ++stats_.uploadAttempts;
  stats_.lastAttemptMs = nowMs;
  stats_.lastHttpStatus = httpStatus;
  if (success) {
    stats_.lastSuccessMs = stats_.lastAttemptMs;
  } else {
    ++stats_.uploadFailures;
  }
  portEXIT_CRITICAL(&statsMux_);
}

void CloudTelemetry::recordDiscardedSummary() {
  portENTER_CRITICAL(&statsMux_);
  ++stats_.droppedSummaries;
  portEXIT_CRITICAL(&statsMux_);
}

void CloudTelemetry::taskEntry(void *context) {
  static_cast<CloudTelemetry *>(context)->run();
}

void CloudTelemetry::run() {
  CloudPassage passage{};
  const TickType_t waitTicks =
      pdMS_TO_TICKS(CHECKIT_CLOUD_QUEUE_WAIT_MS);

  for (;;) {
    if (xQueueReceive(queue_, &passage, waitTicks) == pdTRUE) {
      processPassage(passage);
      while (xQueueReceive(queue_, &passage, 0) == pdTRUE) {
        processPassage(passage);
      }
    }

    const uint32_t nowMs = millis();
    const bool manualUpload = consumeUploadRequest();
    const bool manualHealth = consumeHealthRequest();
    const bool automaticUpload = uploadSchedule_.automaticDue(nowMs);
    if (automaticUpload || manualUpload) {
      stageDirtySummaries();
      if (automaticUpload) {
        uploadSchedule_.startAutomatic(nowMs);
        Serial.printf(
            "[CLOUD] hourly upload cycle started with %u passages and %u "
            "summaries\n",
            static_cast<unsigned int>(passageJournal_.pendingCount()),
            static_cast<unsigned int>(pendingSummaryCount_));
      } else {
        uploadSchedule_.startManual(nowMs);
        Serial.printf(
            "[CLOUD] manual upload cycle started with %u passages and %u "
            "summaries\n",
            static_cast<unsigned int>(passageJournal_.pendingCount()),
            static_cast<unsigned int>(pendingSummaryCount_));
      }
      portENTER_CRITICAL(&statsMux_);
      ++stats_.uploadCycles;
      portEXIT_CRITICAL(&statsMux_);
    }

    bool hasHealth = false;
    portENTER_CRITICAL(&healthMux_);
    hasHealth = healthAvailable_;
    portEXIT_CRITICAL(&healthMux_);
    const bool automaticHealth = hasHealth &&
        static_cast<int32_t>(nowMs - nextHealthAttemptMs_) >= 0;
    if (manualHealth || automaticHealth) {
      bool healthSuccess = false;
      if (hasHealth && WiFi.status() == WL_CONNECTED &&
          config_.networkTimeReady() &&
          static_cast<uint32_t>(time(nullptr)) >=
              CHECKIT_MIN_VALID_UNIX_TIME) {
        healthSuccess = uploadHealth();
      }
      nextHealthAttemptMs_ = nowMs +
          (healthSuccess
              ? CHECKIT_CLOUD_HEALTH_INTERVAL_MS
              : CHECKIT_CLOUD_HEALTH_RETRY_MS);
      if (!healthSuccess) {
        portENTER_CRITICAL(&statsMux_);
        ++stats_.healthUploadFailures;
        portEXIT_CRITICAL(&statsMux_);
      }
    }

    if (uploadSchedule_.attemptDue(nowMs)) {
      bool success =
          passageJournal_.pendingCount() == 0 && pendingSummaryCount_ == 0;
      if (!success &&
          WiFi.status() == WL_CONNECTED &&
          config_.networkTimeReady() &&
          static_cast<uint32_t>(time(nullptr)) >=
              CHECKIT_MIN_VALID_UNIX_TIME) {
        success = uploadPendingPassages();
        if (success) {
          success = uploadPendingSummaries();
        }
        if (success) {
          portENTER_CRITICAL(&statsMux_);
          stats_.uploadedSummaries += pendingSummaryCount_;
          portEXIT_CRITICAL(&statsMux_);
          pendingSummaryCount_ = 0;
        }
      } else if (!success) {
        Serial.println(
            "[CLOUD] upload waiting for Wi-Fi and synchronized network time");
      }

      uploadSchedule_.recordAttempt(success, nowMs);
      if (!success && !uploadSchedule_.active()) {
        Serial.printf(
            "[CLOUD] retry limit reached; retaining %u passages and %u "
            "summaries for the next hourly or manual cycle\n",
            static_cast<unsigned int>(passageJournal_.pendingCount()),
            static_cast<unsigned int>(pendingSummaryCount_));
      }
    }
    updateScheduleStats();
  }
}

int CloudTelemetry::directionSlot(Direction direction) const {
  if (direction == DIR_APPROACH) {
    return 0;
  }
  if (direction == DIR_AWAY) {
    return 1;
  }
  return -1;
}

void CloudTelemetry::resetSummary(
    size_t slot,
    Direction direction,
    uint32_t bucketEpoch) {
  memset(&summaries_[slot], 0, sizeof(DirectionSummary));
  summaries_[slot].bucketEpoch = bucketEpoch;
  summaries_[slot].direction = direction;
}

void CloudTelemetry::processPassage(const CloudPassage &cloudPassage) {
  const TrafficPassage &passage = cloudPassage.passage;
  const int slotValue = directionSlot(passage.direction);
  if (slotValue < 0 ||
      passage.endedEpoch < CHECKIT_MIN_VALID_UNIX_TIME) {
    return;
  }
  // Review and rejected paths remain available for calibration, but only
  // accepted paths affect official ten-minute traffic totals.
  if (passage.qualityStatus != TRACK_ACCEPTED) {
    return;
  }

  const size_t slot = static_cast<size_t>(slotValue);
  const uint32_t bucketEpoch =
      passage.endedEpoch -
      (passage.endedEpoch % CHECKIT_SUMMARY_BUCKET_SECONDS);
  DirectionSummary &summary = summaries_[slot];
  if (summary.bucketEpoch == 0) {
    resetSummary(slot, passage.direction, bucketEpoch);
  } else if (summary.bucketEpoch != bucketEpoch) {
    if (summary.dirty && !stageSummary(summary)) {
      Serial.printf(
          "[CLOUD] pending buffer full; discarded %s summary for bucket %lu\n",
          directionName(summary.direction),
          static_cast<unsigned long>(summary.bucketEpoch));
      recordDiscardedSummary();
    }
    resetSummary(slot, passage.direction, bucketEpoch);
  }

  ++summary.volume;
  ++summary.eventCount;
  summary.speedSumKmh += passage.medianSpeedKmh;
  if (passage.maxSpeedKmh > summary.maxSpeedKmh) {
    summary.maxSpeedKmh = passage.maxSpeedKmh;
  }
  uint16_t &histogramBin =
      summary.peakSpeedHistogram[passage.p85SpeedKmh];
  if (histogramBin != UINT16_MAX) {
    ++histogramBin;
  }
  summary.dirty = true;
}

uint8_t CloudTelemetry::percentile85(
    const DirectionSummary &summary) const {
  if (summary.eventCount == 0) {
    return 0;
  }

  const uint32_t rank = static_cast<uint32_t>(
      (static_cast<uint64_t>(summary.eventCount) * 85U + 99U) / 100U);
  uint32_t cumulative = 0;
  for (uint16_t speed = 0; speed <= UINT8_MAX; ++speed) {
    cumulative += summary.peakSpeedHistogram[speed];
    if (cumulative >= rank) {
      return static_cast<uint8_t>(speed);
    }
  }
  return summary.maxSpeedKmh;
}

bool CloudTelemetry::stageSummary(
    const DirectionSummary &summary) {
  if (!summary.dirty || summary.eventCount == 0) {
    return true;
  }

  const PreparedSummary prepared{
      summary.bucketEpoch,
      summary.direction,
      summary.volume,
      summary.eventCount,
      summary.speedSumKmh,
      percentile85(summary),
      summary.maxSpeedKmh};

  for (size_t i = 0; i < pendingSummaryCount_; ++i) {
    if (pendingSummaries_[i].bucketEpoch == prepared.bucketEpoch &&
        pendingSummaries_[i].direction == prepared.direction) {
      pendingSummaries_[i] = prepared;
      return true;
    }
  }

  if (pendingSummaryCount_ >= CHECKIT_CLOUD_PENDING_SUMMARY_DEPTH) {
    return false;
  }
  pendingSummaries_[pendingSummaryCount_++] = prepared;
  portENTER_CRITICAL(&statsMux_);
  stats_.pendingSummaries = pendingSummaryCount_;
  portEXIT_CRITICAL(&statsMux_);
  return true;
}

void CloudTelemetry::stageDirtySummaries() {
  for (size_t slot = 0; slot < 2; ++slot) {
    DirectionSummary &summary = summaries_[slot];
    if (stageSummary(summary)) {
      summary.dirty = false;
    }
  }
}

bool CloudTelemetry::uploadPendingSummaries() {
  if (pendingSummaryCount_ == 0) {
    return true;
  }
  if (!uploadSummaries(pendingSummaries_, pendingSummaryCount_)) {
    return false;
  }
  return true;
}

bool CloudTelemetry::uploadPendingPassages() {
  CloudPassage batch[CHECKIT_CLOUD_PASSAGE_UPLOAD_BATCH_SIZE]{};
  for (;;) {
    const uint32_t startOffset = passageJournal_.acknowledgedOffset();
    uint32_t nextOffset = startOffset;
    const size_t batchCount = passageJournal_.readBatch(
        batch,
        CHECKIT_CLOUD_PASSAGE_UPLOAD_BATCH_SIZE,
        nextOffset);
    if (batchCount == 0) {
      if (nextOffset > startOffset) {
        Serial.println(
            "[STORAGE] quarantining unreadable passage record; later "
            "records remain available");
        if (!passageJournal_.acknowledge(nextOffset, 0)) {
          return false;
        }
        continue;
      }
      return true;
    }

    // Keep the on-disk layout unchanged so existing CRC-protected records
    // remain readable. Compact only this upload buffer; acknowledge ALL read
    // records after accepted rows succeed, including discarded legacy reviews.
    size_t acceptedCount = 0;
    for (size_t i = 0; i < batchCount; ++i) {
      if (batch[i].passage.qualityStatus == TRACK_ACCEPTED) {
        batch[acceptedCount++] = batch[i];
      } else {
        Serial.printf("[CLOUD] discard legacy track %lu quality=%s\n",
            static_cast<unsigned long>(batch[i].passage.trackId),
            trackQualityName(batch[i].passage.qualityStatus));
      }
    }
    const String payload = buildPassagePayload(batch, acceptedCount);
    if (acceptedCount > 0 && !postPayload(
            config_.passageTableName,
            "sensor_id%2Cboot_id%2Ctrack_id",
            payload,
            acceptedCount,
            "passages")) {
      return false;
    }
    if (!passageJournal_.acknowledge(nextOffset, batchCount)) {
      Serial.println(
          "[STORAGE] cloud accepted batch but local acknowledgement failed; "
          "safe idempotent retry scheduled");
      return false;
    }
    portENTER_CRITICAL(&statsMux_);
    stats_.uploadedPassages += acceptedCount;
    portEXIT_CRITICAL(&statsMux_);
  }
}

void CloudTelemetry::appendPassageObject(
    String &json,
    const CloudPassage &cloudPassage) const {
  const TrafficPassage &passage = cloudPassage.passage;
  json += F("{\"sensor_id\":");
  appendJsonString(json, config_.sensorId);
  json += F(",\"boot_id\":");
  json += static_cast<unsigned long>(cloudPassage.bootId);
  json += F(",\"track_id\":");
  json += static_cast<unsigned long>(passage.trackId);
  json += F(",\"observed_at\":");
  appendObservedAt(json, passage.endedEpoch);
  json += F(",\"direction\":");
  appendJsonString(json, directionName(passage.direction));
  json += F(",\"traffic_class\":");
  appendJsonString(json, trafficClassName(passage.trafficClass));
  json += F(",\"speed_kmh\":");
  json += static_cast<unsigned int>(passage.medianSpeedKmh);
  json += F(",\"max_speed_kmh\":");
  json += static_cast<unsigned int>(passage.maxSpeedKmh);
  json += F(",\"firmware_version\":");
  appendJsonString(json, CHECKIT_FIRMWARE_VERSION);
  // The database stamps receipt time, including for legacy journal retries.
  json += F(",\"received_at\":null}");
}

String CloudTelemetry::buildPassagePayload(
    const CloudPassage *passages,
    size_t passageCount) const {
  String json;
  json.reserve(passageCount * 320U + 2U);
  json += '[';
  for (size_t i = 0; i < passageCount; ++i) {
    if (i > 0) {
      json += ',';
    }
    appendPassageObject(json, passages[i]);
  }
  json += ']';
  return json;
}

String CloudTelemetry::buildHealthPayload(
    const CloudHealthSnapshot &snapshot) const {
  const PassageJournalStats storage = passageJournal_.stats();
  CloudTelemetryStats telemetry{};
  portENTER_CRITICAL(&statsMux_);
  telemetry = stats_;
  portEXIT_CRITICAL(&statsMux_);

  const uint32_t nowEpoch = static_cast<uint32_t>(time(nullptr));
  const uint32_t radarEpoch =
      snapshot.lastRadarFrameAgeMs == UINT32_MAX ||
          snapshot.lastRadarFrameAgeMs / 1000UL > nowEpoch
      ? 0
      : nowEpoch - snapshot.lastRadarFrameAgeMs / 1000UL;
  const char *healthStatus = !storage.ready
      ? "storage_fault"
      : snapshot.radarActive ? "online" : "radar_stale";

  String json;
  json.reserve(1024);
  json += F("[{\"sensor_id\":");
  appendJsonString(json, config_.sensorId);
  json += F(",\"last_seen_at\":");
  appendObservedAt(json, nowEpoch);
  json += F(",\"last_radar_frame_at\":");
  appendObservedAt(json, radarEpoch);
  json += F(",\"last_passage_at\":");
  appendObservedAt(json, snapshot.lastPassageEpoch);
  json += F(",\"health_status\":");
  appendJsonString(json, healthStatus);
  json += F(",\"boot_id\":");
  json += static_cast<unsigned long>(snapshot.bootId);
  json += F(",\"uptime_ms\":");
  json += static_cast<unsigned long>(snapshot.uptimeMs);
  json += F(",\"radar_active\":");
  json += snapshot.radarActive ? F("true") : F("false");
  json += F(",\"wifi_rssi_dbm\":");
  json += static_cast<int>(snapshot.wifiRssiDbm);
  json += F(",\"pending_passages\":");
  json += static_cast<unsigned long>(storage.pendingRecords);
  json += F(",\"storage_free_bytes\":");
  json += static_cast<unsigned long>(storage.freeBytes);
  json += F(",\"last_http_status\":");
  json += static_cast<long>(telemetry.lastHttpStatus);
  json += F(",\"firmware_version\":");
  appendJsonString(json, CHECKIT_FIRMWARE_VERSION);
  json += F(",\"updated_at\":");
  appendObservedAt(json, nowEpoch);
  json += F(",\"diagnostics\":{");
  json += F("\"device_name\":");
  appendJsonString(json, snapshot.deviceName);
  json += F(",\"radar_frame_count\":");
  json += static_cast<unsigned long>(snapshot.radarFrameCount);
  json += F(",\"radar_frame_errors\":");
  json += static_cast<unsigned long>(snapshot.radarFrameErrors);
  json += F(",\"low_snr_returns_filtered\":");
  json += static_cast<unsigned long>(snapshot.lowSnrReturnsFiltered);
  json += F(",\"slow_returns_excluded\":");
  json += static_cast<unsigned long>(snapshot.slowReturnsExcluded);
  json += F(",\"weak_extreme_speed_returns_filtered\":");
  json += static_cast<unsigned long>(
      snapshot.weakExtremeSpeedReturnsFiltered);
  json += F(",\"target_capacity_frames\":");
  json += static_cast<unsigned long>(snapshot.targetCapacityFrames);
  json += F(",\"truncated_target_frames\":");
  json += static_cast<unsigned long>(snapshot.truncatedTargetFrames);
  json += F(",\"maximum_reported_targets\":");
  json += static_cast<unsigned int>(snapshot.maximumReportedTargets);
  json += F(",\"storage_used_bytes\":");
  json += static_cast<unsigned long>(storage.usedBytes);
  json += F(",\"storage_errors\":");
  json += static_cast<unsigned long>(
      storage.corruptRecords + storage.persistFailures);
  json += F(",\"speed_limit_kmh\":");
  json += static_cast<unsigned int>(snapshot.speedLimitKmh);
  json += F(",\"reset_reason\":");
  json += static_cast<unsigned int>(snapshot.resetReason);
  json += F(",\"provisioned\":");
  json += snapshot.provisioned ? F("true") : F("false");
  json += F(",\"ble_active\":");
  json += snapshot.bleActive ? F("true") : F("false");
  json += F(",\"model_version\":");
  appendJsonString(json, CHECKIT_TRAFFIC_MODEL_VERSION);
  json += F(",\"feature_version\":");
  appendJsonString(json, CHECKIT_TRAFFIC_FEATURE_VERSION);
  json += F("}}]");
  return json;
}

bool CloudTelemetry::uploadHealth() {
  CloudHealthSnapshot snapshot{};
  portENTER_CRITICAL(&healthMux_);
  if (!healthAvailable_) {
    portEXIT_CRITICAL(&healthMux_);
    return false;
  }
  snapshot = healthSnapshot_;
  portEXIT_CRITICAL(&healthMux_);

  const String payload = buildHealthPayload(snapshot);
  const bool success = postPayload(
      config_.healthTableName,
      "sensor_id",
      payload,
      1,
      "health report");
  if (success) {
    portENTER_CRITICAL(&statsMux_);
    ++stats_.uploadedHealthReports;
    stats_.lastHealthSuccessMs = millis();
    portEXIT_CRITICAL(&statsMux_);
  }
  return success;
}

void CloudTelemetry::appendSummaryObject(
    String &json,
    const PreparedSummary &summary) const {
  json += F("{\"sensor_id\":");
  appendJsonString(json, config_.sensorId);
  json += F(",\"time_bucket\":");
  appendObservedAt(json, summary.bucketEpoch);
  json += F(",\"direction\":");
  appendJsonString(json, directionName(summary.direction));
  json += F(",\"volume\":");
  json += static_cast<unsigned long>(summary.volume);
  json += F(",\"avg_speed\":");
  const float averageSpeed = summary.eventCount == 0
      ? 0.0f
      : static_cast<float>(summary.speedSumKmh) /
          static_cast<float>(summary.eventCount);
  json += String(averageSpeed, 2);
  json += F(",\"v85_speed\":");
  json += static_cast<unsigned int>(summary.v85SpeedKmh);
  json += F(",\"max_speed\":");
  json += static_cast<unsigned int>(summary.maxSpeedKmh);
  json += '}';
}

String CloudTelemetry::buildPayload(
    const PreparedSummary *summaries,
    size_t summaryCount) const {
  String json;
  json.reserve(summaryCount * 192U + 2U);
  json += '[';
  for (size_t i = 0; i < summaryCount; ++i) {
    if (i > 0) {
      json += ',';
    }
    appendSummaryObject(json, summaries[i]);
  }
  json += ']';
  return json;
}

bool CloudTelemetry::uploadSummaries(
    const PreparedSummary *summaries,
    size_t summaryCount) {
  const String payload = buildPayload(summaries, summaryCount);
  return postPayload(
      config_.summaryTableName,
      "sensor_id%2Ctime_bucket%2Cdirection",
      payload,
      summaryCount,
      "summaries");
}

bool CloudTelemetry::postPayload(
    const char *tableName,
    const char *conflictColumns,
    const String &payload,
    uint32_t rowCount,
    const char *rowLabel) {
  const time_t now = time(nullptr);
  struct tm utcTime {};
  char utcTimestamp[25]{};
  gmtime_r(&now, &utcTime);
  strftime(
      utcTimestamp,
      sizeof(utcTimestamp),
      "%Y-%m-%dT%H:%M:%SZ",
      &utcTime);
  Serial.printf(
      "[CLOUD] starting verified TLS with device UTC=%s\n",
      utcTimestamp);

  WiFiClientSecure client;
  client.setCACert(kSupabaseTrustAnchors);

  String url(config_.projectUrl);
  while (url.endsWith("/")) {
    url.remove(url.length() - 1);
  }
  url += F("/rest/v1/");
  url += tableName;
  url += F("?on_conflict=");
  url += conflictColumns;

  HTTPClient http;
  http.setConnectTimeout(CHECKIT_CLOUD_HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(CHECKIT_CLOUD_HTTP_TIMEOUT_MS);
  if (!http.begin(client, url)) {
    recordAttempt(-1, false);
    return false;
  }

  http.addHeader(F("Content-Type"), F("application/json"));
  http.addHeader(F("apikey"), config_.publishableKey);
  http.addHeader(
      F("Prefer"),
      F("return=minimal,resolution=merge-duplicates"));

  // Legacy anon keys are JWTs and use the Bearer header. New
  // sb_publishable_ keys are not JWTs and must be sent only as apikey.
  if (strncmp(config_.publishableKey, "sb_publishable_", 15) != 0) {
    String authorization(F("Bearer "));
    authorization += config_.publishableKey;
    http.addHeader(F("Authorization"), authorization);
  }

  const int32_t status = http.POST(payload);
  const bool success = status >= 200 && status < 300;
  recordAttempt(status, success);

  if (success) {
    Serial.printf(
        "[CLOUD] upserted %u %s in upload batch HTTP %ld\n",
        static_cast<unsigned int>(rowCount),
        rowLabel,
        static_cast<long>(status));
  } else {
    String response;
    if (status > 0) {
      response = http.getString();
      if (response.length() > 240) {
        response.remove(240);
      }
    }
    Serial.printf(
        "[CLOUD] %s upload failed HTTP %ld%s%s\n",
        rowLabel,
        static_cast<long>(status),
        response.length() == 0 ? "" : ": ",
        response.c_str());
  }

  http.end();
  client.stop();
  return success;
}

}  // namespace CheckIt
