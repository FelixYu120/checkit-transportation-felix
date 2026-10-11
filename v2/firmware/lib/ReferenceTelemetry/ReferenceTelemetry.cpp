#include "ReferenceTelemetry.h"

#include <HTTPClient.h>
#include <FFat.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <stddef.h>
#include <string.h>
#include <time.h>

#include "CheckItConfig.h"
#include "SupabaseTrust.h"

namespace CheckIt {
namespace {

constexpr char kJournalPath[] = "/ld2415h-reference.bin";
constexpr char kTemporaryPath[] = "/ld2415h-reference.tmp";
constexpr char kBackupPath[] = "/ld2415h-reference.bak";
constexpr char kPreferencesNamespace[] = "checkit-ref";
constexpr char kInitializedKey[] = "fs-init";
constexpr char kAcknowledgedKey[] = "sample-ack";
constexpr uint32_t kRecordMagic = 0x43545246UL;  // "CTRF"
constexpr uint16_t kRecordVersion = 1U;

bool hasRealValue(const char *value) {
  return value != nullptr && value[0] != '\0' &&
      strstr(value, "YOUR_") == nullptr;
}

void appendJsonString(String &json, const char *value) {
  json += '"';
  if (value != nullptr) {
    while (*value != '\0') {
      const char c = *value++;
      if (c == '"' || c == '\\') json += '\\';
      if (static_cast<uint8_t>(c) >= 0x20U) json += c;
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
  struct tm utc {};
  gmtime_r(&timestamp, &utc);
  char value[25]{};
  strftime(value, sizeof(value), "%Y-%m-%dT%H:%M:%SZ", &utc);
  appendJsonString(json, value);
}

char hexDigit(uint8_t nibble) {
  return nibble < 10U ? static_cast<char>('0' + nibble)
                      : static_cast<char>('A' + nibble - 10U);
}

}  // namespace

struct ReferenceTelemetry::JournalRecord {
  uint32_t magic;
  uint16_t version;
  uint16_t payloadBytes;
  ReferenceSample payload;
  uint32_t checksum;
};

ReferenceTelemetry::ReferenceTelemetry(const ReferenceTelemetryConfig &config)
    : config_(config),
      preferences_(),
      queue_(nullptr),
      task_(nullptr),
      acknowledgedOffset_(0),
      fileBytes_(0),
      nextAutomaticUploadMs_(0),
      nextRetryMs_(0),
      uploadRequested_(false),
      stats_{} {}

uint32_t ReferenceTelemetry::crc32(
    const uint8_t *data,
    size_t length) const {
  uint32_t crc = 0xFFFFFFFFUL;
  for (size_t i = 0; i < length; ++i) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8U; ++bit) {
      const uint32_t mask = static_cast<uint32_t>(
          -static_cast<int32_t>(crc & 1U));
      crc = (crc >> 1U) ^ (0xEDB88320UL & mask);
    }
  }
  return ~crc;
}

bool ReferenceTelemetry::validRecord(const JournalRecord &record) const {
  return record.magic == kRecordMagic &&
      record.version == kRecordVersion &&
      record.payloadBytes == sizeof(ReferenceSample) &&
      record.checksum == crc32(
          reinterpret_cast<const uint8_t *>(&record),
          offsetof(JournalRecord, checksum));
}

bool ReferenceTelemetry::repairTrailingBytes(uint32_t alignedSize) {
  fs::FS &filesystem = storage();
  File source = filesystem.open(kJournalPath, FILE_READ);
  File destination = filesystem.open(kTemporaryPath, FILE_WRITE);
  if (!source || !destination) {
    source.close();
    destination.close();
    return false;
  }
  uint8_t buffer[256]{};
  uint32_t remaining = alignedSize;
  while (remaining > 0U) {
    const size_t amount = remaining > sizeof(buffer)
        ? sizeof(buffer)
        : static_cast<size_t>(remaining);
    if (source.read(buffer, amount) != amount ||
        destination.write(buffer, amount) != amount) {
      source.close();
      destination.close();
      return false;
    }
    remaining -= static_cast<uint32_t>(amount);
  }
  destination.flush();
  source.close();
  destination.close();
  filesystem.remove(kBackupPath);
  if (!filesystem.rename(kJournalPath, kBackupPath)) return false;
  if (!filesystem.rename(kTemporaryPath, kJournalPath)) {
    filesystem.rename(kBackupPath, kJournalPath);
    return false;
  }
  filesystem.remove(kBackupPath);
  return true;
}

fs::FS &ReferenceTelemetry::storage() {
  return config_.useFfat ? static_cast<fs::FS &>(FFat)
                         : static_cast<fs::FS &>(LittleFS);
}

bool ReferenceTelemetry::mountStorage() {
  if (!preferences_.begin(kPreferencesNamespace, false)) return false;
  // The integrated radar node mounts FFat through PassageJournal first.
  // Reuse that mount instead of registering the same VFS path a second time.
  const bool mounted = config_.useFfat
      ? (FFat.totalBytes() > 0U || FFat.begin(false))
      : LittleFS.begin(false);
  if (mounted) {
    preferences_.putBool(kInitializedKey, true);
    return true;
  }
  if (preferences_.getBool(kInitializedKey, false)) {
    Serial.println("[REFERENCE STORAGE] mount failed; refusing to format existing data");
    return false;
  }
  // The T-SIM FFat partition is shared with the primary passage journal.
  // Never format it from the optional reference component: a mount failure
  // must not erase authoritative LD2451 passages.
  if (config_.useFfat) {
    Serial.println(
        "[REFERENCE STORAGE] shared FFat unavailable; refusing to format it");
    return false;
  }
  Serial.printf(
      "[REFERENCE STORAGE] initializing %s once\n",
      config_.useFfat ? "FFat" : "LittleFS");
  const bool initialized = config_.useFfat
      ? (FFat.format() && FFat.begin(false))
      : (LittleFS.format() && LittleFS.begin(false));
  if (!initialized) return false;
  preferences_.putBool(kInitializedKey, true);
  return true;
}

bool ReferenceTelemetry::scanJournal() {
  fs::FS &filesystem = storage();
  if (!filesystem.exists(kJournalPath)) {
    File created = filesystem.open(kJournalPath, FILE_WRITE);
    if (!created) return false;
    created.close();
  }
  File file = filesystem.open(kJournalPath, FILE_READ);
  if (!file) return false;
  fileBytes_ = static_cast<uint32_t>(file.size());
  file.close();
  const uint32_t recordBytes = sizeof(JournalRecord);
  const uint32_t alignedSize = fileBytes_ - fileBytes_ % recordBytes;
  if (alignedSize != fileBytes_ && !repairTrailingBytes(alignedSize)) {
    return false;
  }
  fileBytes_ = alignedSize;
  acknowledgedOffset_ = preferences_.getULong(kAcknowledgedKey, 0U);
  if (acknowledgedOffset_ > fileBytes_ ||
      acknowledgedOffset_ % recordBytes != 0U) {
    acknowledgedOffset_ = 0U;
    preferences_.putULong(kAcknowledgedKey, 0U);
  }

  uint32_t pending = 0U;
  uint32_t corrupt = 0U;
  file = filesystem.open(kJournalPath, FILE_READ);
  if (!file || !file.seek(acknowledgedOffset_)) {
    file.close();
    return false;
  }
  JournalRecord record{};
  while (file.read(
             reinterpret_cast<uint8_t *>(&record),
             sizeof(record)) == sizeof(record)) {
    if (validRecord(record)) ++pending;
    else ++corrupt;
  }
  file.close();
  portENTER_CRITICAL(&mux_);
  stats_.pendingSamples = pending;
  stats_.corruptRecords = corrupt;
  portEXIT_CRITICAL(&mux_);
  return true;
}

bool ReferenceTelemetry::cloudConfigurationReady() const {
  const bool supportedKey = config_.publishableKey != nullptr &&
      (strncmp(config_.publishableKey, "sb_publishable_", 15) == 0 ||
       strncmp(config_.publishableKey, "eyJ", 3) == 0);
  return hasRealValue(config_.projectUrl) &&
      hasRealValue(config_.publishableKey) &&
      hasRealValue(config_.tableName) &&
      hasRealValue(config_.primarySensorId) &&
      hasRealValue(config_.referenceSensorId) &&
      supportedKey && strncmp(config_.projectUrl, "https://", 8) == 0;
}

bool ReferenceTelemetry::begin() {
  const bool storageReady = mountStorage() && scanJournal();
  const bool cloudEnabled = cloudConfigurationReady();
  portENTER_CRITICAL(&mux_);
  stats_.storageReady = storageReady;
  stats_.cloudEnabled = cloudEnabled;
  portEXIT_CRITICAL(&mux_);
  if (!storageReady) return false;

  queue_ = xQueueCreate(CHECKIT_REFERENCE_QUEUE_DEPTH, sizeof(ReferenceSample));
  if (queue_ == nullptr) return false;
  nextAutomaticUploadMs_ = millis() + CHECKIT_REFERENCE_UPLOAD_STARTUP_DELAY_MS;
  const BaseType_t created = xTaskCreate(
      taskEntry,
      "reference-upload",
      CHECKIT_REFERENCE_TASK_STACK_BYTES,
      this,
      1,
      &task_);
  if (created != pdPASS) {
    vQueueDelete(queue_);
    queue_ = nullptr;
    return false;
  }
  Serial.printf(
      "[REFERENCE STORAGE] ready pending=%lu cloud=%s\n",
      static_cast<unsigned long>(stats_.pendingSamples),
      cloudEnabled ? "enabled" : "disabled");
  return true;
}

bool ReferenceTelemetry::enqueue(const ReferenceSample &sample) {
  const bool accepted = queue_ != nullptr &&
      xQueueSend(queue_, &sample, 0) == pdTRUE;
  portENTER_CRITICAL(&mux_);
  if (accepted) ++stats_.enqueuedSamples;
  else ++stats_.droppedSamples;
  portEXIT_CRITICAL(&mux_);
  return accepted;
}

bool ReferenceTelemetry::requestUploadNow() {
  portENTER_CRITICAL(&mux_);
  uploadRequested_ = true;
  portEXIT_CRITICAL(&mux_);
  return true;
}

ReferenceTelemetryStats ReferenceTelemetry::stats() const {
  portENTER_CRITICAL(&mux_);
  const ReferenceTelemetryStats value = stats_;
  portEXIT_CRITICAL(&mux_);
  return value;
}

bool ReferenceTelemetry::appendRecord(const ReferenceSample &sample) {
  JournalRecord record{};
  record.magic = kRecordMagic;
  record.version = kRecordVersion;
  record.payloadBytes = sizeof(sample);
  record.payload = sample;
  record.checksum = crc32(
      reinterpret_cast<const uint8_t *>(&record),
      offsetof(JournalRecord, checksum));
  File file = storage().open(kJournalPath, FILE_APPEND);
  const bool stored = file &&
      file.write(reinterpret_cast<const uint8_t *>(&record), sizeof(record)) ==
          sizeof(record);
  if (file) {
    file.flush();
    file.close();
  }
  portENTER_CRITICAL(&mux_);
  if (stored) {
    fileBytes_ += sizeof(record);
    ++stats_.pendingSamples;
  } else {
    ++stats_.persistFailures;
  }
  portEXIT_CRITICAL(&mux_);
  return stored;
}

size_t ReferenceTelemetry::readBatch(
    ReferenceSample *samples,
    size_t capacity,
    uint32_t &nextOffset) {
  nextOffset = acknowledgedOffset_;
  File file = storage().open(kJournalPath, FILE_READ);
  if (!file || !file.seek(acknowledgedOffset_)) {
    file.close();
    return 0U;
  }
  size_t count = 0U;
  JournalRecord record{};
  while (count < capacity &&
         file.read(reinterpret_cast<uint8_t *>(&record), sizeof(record)) ==
             sizeof(record)) {
    nextOffset += sizeof(record);
    if (validRecord(record)) samples[count++] = record.payload;
  }
  file.close();
  return count;
}

bool ReferenceTelemetry::compact() {
  fs::FS &filesystem = storage();
  if (acknowledgedOffset_ == 0U) return true;
  if (acknowledgedOffset_ == fileBytes_) {
    File empty = filesystem.open(kTemporaryPath, FILE_WRITE);
    if (!empty) return false;
    empty.close();
  } else {
    File source = filesystem.open(kJournalPath, FILE_READ);
    File destination = filesystem.open(kTemporaryPath, FILE_WRITE);
    if (!source || !destination || !source.seek(acknowledgedOffset_)) {
      source.close();
      destination.close();
      return false;
    }
    uint8_t buffer[256]{};
    while (source.available()) {
      const size_t amount = source.read(buffer, sizeof(buffer));
      if (amount == 0U || destination.write(buffer, amount) != amount) {
        source.close();
        destination.close();
        return false;
      }
    }
    destination.flush();
    source.close();
    destination.close();
  }
  if (preferences_.putULong(kAcknowledgedKey, 0U) != sizeof(uint32_t)) {
    return false;
  }
  filesystem.remove(kBackupPath);
  if (!filesystem.rename(kJournalPath, kBackupPath)) return false;
  if (!filesystem.rename(kTemporaryPath, kJournalPath)) {
    filesystem.rename(kBackupPath, kJournalPath);
    return false;
  }
  filesystem.remove(kBackupPath);
  fileBytes_ -= acknowledgedOffset_;
  acknowledgedOffset_ = 0U;
  return true;
}

bool ReferenceTelemetry::acknowledge(
    uint32_t nextOffset,
    size_t uploadedCount) {
  if (nextOffset < acknowledgedOffset_ || nextOffset > fileBytes_ ||
      nextOffset % sizeof(JournalRecord) != 0U) return false;
  if (preferences_.putULong(kAcknowledgedKey, nextOffset) !=
      sizeof(uint32_t)) return false;
  acknowledgedOffset_ = nextOffset;
  portENTER_CRITICAL(&mux_);
  stats_.pendingSamples = uploadedCount > stats_.pendingSamples
      ? 0U
      : stats_.pendingSamples - static_cast<uint32_t>(uploadedCount);
  stats_.uploadedSamples += static_cast<uint32_t>(uploadedCount);
  portEXIT_CRITICAL(&mux_);
  return acknowledgedOffset_ == fileBytes_ ||
      acknowledgedOffset_ >= CHECKIT_REFERENCE_JOURNAL_COMPACT_BYTES
      ? compact()
      : true;
}

String ReferenceTelemetry::buildPayload(
    const ReferenceSample *samples,
    size_t count) const {
  String json;
  json.reserve(count * 360U + 2U);
  json += '[';
  for (size_t i = 0; i < count; ++i) {
    if (i != 0U) json += ',';
    const ReferenceSample &sample = samples[i];
    char rawHex[kLd2415hMeasurementBytes * 2U + 1U]{};
    for (size_t j = 0; j < kLd2415hMeasurementBytes; ++j) {
      rawHex[j * 2U] = hexDigit(sample.raw[j] >> 4U);
      rawHex[j * 2U + 1U] = hexDigit(sample.raw[j] & 0x0FU);
    }
    json += F("{\"reference_sensor_id\":");
    appendJsonString(json, config_.referenceSensorId);
    json += F(",\"boot_id\":");
    json += sample.bootId;
    json += F(",\"sequence\":");
    json += sample.sequence;
    json += F(",\"primary_sensor_id\":");
    appendJsonString(json, config_.primarySensorId);
    json += F(",\"observed_at\":");
    appendObservedAt(json, sample.observedEpoch);
    json += F(",\"uptime_ms\":");
    json += sample.uptimeMs;
    json += F(",\"direction\":");
    appendJsonString(
        json,
        sample.direction == LD2415H_APPROACH ? "approach" : "away");
    json += F(",\"signed_speed_kmh\":");
    json += String(sample.signedSpeedTenthsKmh / 10.0f, 1);
    json += F(",\"raw_frame_hex\":");
    appendJsonString(json, rawHex);
    json += F(",\"test_run_id\":");
    if (hasRealValue(config_.testRunId)) appendJsonString(json, config_.testRunId);
    else json += F("null");
    json += F(",\"firmware_version\":");
    appendJsonString(json, CHECKIT_FIRMWARE_VERSION);
    json += '}';
  }
  json += ']';
  return json;
}

void ReferenceTelemetry::setLastHttpStatus(int32_t status) {
  portENTER_CRITICAL(&mux_);
  stats_.lastHttpStatus = status;
  portEXIT_CRITICAL(&mux_);
}

bool ReferenceTelemetry::uploadBatch(
    const ReferenceSample *samples,
    size_t count) {
  WiFiClientSecure secure;
  secure.setCACert(supabaseTrustAnchors());
  HTTPClient http;
  String url(config_.projectUrl);
  url += F("/rest/v1/");
  url += config_.tableName;
  url += F("?on_conflict=reference_sensor_id,boot_id,sequence");
  http.setConnectTimeout(CHECKIT_CLOUD_HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(CHECKIT_CLOUD_HTTP_TIMEOUT_MS);
  if (!http.begin(secure, url)) {
    setLastHttpStatus(-1);
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", config_.publishableKey);
  String authorization("Bearer ");
  authorization += config_.publishableKey;
  http.addHeader("Authorization", authorization);
  http.addHeader("Prefer", "resolution=merge-duplicates,return=minimal");
  const int status = http.POST(buildPayload(samples, count));
  http.end();
  setLastHttpStatus(status);
  return status >= 200 && status < 300;
}

void ReferenceTelemetry::taskEntry(void *context) {
  static_cast<ReferenceTelemetry *>(context)->run();
}

void ReferenceTelemetry::run() {
  for (;;) {
    ReferenceSample sample{};
    while (xQueueReceive(queue_, &sample, pdMS_TO_TICKS(25)) == pdTRUE) {
      appendRecord(sample);
    }

    const uint32_t now = millis();
    bool requested = false;
    portENTER_CRITICAL(&mux_);
    requested = uploadRequested_;
    uploadRequested_ = false;
    const bool enabled = stats_.cloudEnabled;
    const uint32_t pending = stats_.pendingSamples;
    portEXIT_CRITICAL(&mux_);
    const bool scheduled = static_cast<int32_t>(now - nextAutomaticUploadMs_) >= 0;
    const bool retryDue = nextRetryMs_ != 0U &&
        static_cast<int32_t>(now - nextRetryMs_) >= 0;
    if (enabled && pending > 0U && WiFi.status() == WL_CONNECTED &&
        (requested || scheduled || retryDue)) {
      ReferenceSample batch[CHECKIT_REFERENCE_UPLOAD_BATCH_SIZE]{};
      uint32_t nextOffset = acknowledgedOffset_;
      const size_t count = readBatch(
          batch,
          CHECKIT_REFERENCE_UPLOAD_BATCH_SIZE,
          nextOffset);
      if (count > 0U && uploadBatch(batch, count) &&
          acknowledge(nextOffset, count)) {
        portENTER_CRITICAL(&mux_);
        stats_.lastSuccessMs = now;
        portEXIT_CRITICAL(&mux_);
        nextRetryMs_ = 0U;
        // Continue promptly until this upload cycle drains the journal.
        requestUploadNow();
      } else {
        portENTER_CRITICAL(&mux_);
        ++stats_.uploadFailures;
        portEXIT_CRITICAL(&mux_);
        nextRetryMs_ = now + CHECKIT_REFERENCE_RETRY_MS;
      }
      nextAutomaticUploadMs_ = now + CHECKIT_REFERENCE_UPLOAD_INTERVAL_MS;
    } else if (scheduled && pending == 0U) {
      nextAutomaticUploadMs_ = now + CHECKIT_REFERENCE_UPLOAD_INTERVAL_MS;
    }
    vTaskDelay(pdMS_TO_TICKS(25));
  }
}

}  // namespace CheckIt
