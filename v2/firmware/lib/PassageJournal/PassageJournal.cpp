#include "PassageJournal.h"

#include <FFat.h>
#include <FS.h>
#include <string.h>

#include "CheckItConfig.h"

namespace CheckIt {
namespace {

constexpr char kJournalPath[] = "/traffic-passages.bin";
constexpr char kTemporaryPath[] = "/traffic-passages.tmp";
constexpr char kBackupPath[] = "/traffic-passages.bak";
constexpr char kPreferencesNamespace[] = "checkit-data";
constexpr char kInitializedKey[] = "ffat-init";
constexpr char kAcknowledgedKey[] = "pass-ack";
constexpr uint32_t kRecordMagic = 0x43545047UL;  // "CTPG"
constexpr uint16_t kRecordVersion = 1;

struct JournalRecord {
  uint32_t magic;
  uint16_t version;
  uint16_t payloadBytes;
  CloudPassage payload;
  uint32_t checksum;
};

constexpr size_t kChecksumBytes = offsetof(JournalRecord, checksum);
static_assert(
    sizeof(CloudPassage) <= UINT16_MAX,
    "Cloud passage must fit in the journal record header");

}  // namespace

PassageJournal::PassageJournal()
    : mutex_(nullptr),
      preferences_(),
      ready_(false),
      acknowledgedOffset_(0),
      fileBytes_(0),
      pendingRecords_(0),
      corruptRecords_(0),
      persistFailures_(0),
      usedBytes_(0),
      freeBytes_(0) {}

bool PassageJournal::lock() const {
  return mutex_ != nullptr &&
      xSemaphoreTake(mutex_, portMAX_DELAY) == pdTRUE;
}

void PassageJournal::unlock() const {
  if (mutex_ != nullptr) {
    xSemaphoreGive(mutex_);
  }
}

uint32_t PassageJournal::crc32(
    const uint8_t *data,
    size_t length) const {
  uint32_t crc = 0xFFFFFFFFUL;
  for (size_t i = 0; i < length; ++i) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8; ++bit) {
      const uint32_t mask = static_cast<uint32_t>(
          -static_cast<int32_t>(crc & 1U));
      crc = (crc >> 1U) ^ (0xEDB88320UL & mask);
    }
  }
  return ~crc;
}

bool PassageJournal::validRecord(const void *recordValue) const {
  if (recordValue == nullptr) {
    return false;
  }
  const JournalRecord &record =
      *static_cast<const JournalRecord *>(recordValue);
  return record.magic == kRecordMagic &&
      record.version == kRecordVersion &&
      record.payloadBytes == sizeof(CloudPassage) &&
      record.checksum == crc32(
          reinterpret_cast<const uint8_t *>(&record),
          kChecksumBytes);
}

bool PassageJournal::mountStorage() {
  if (!preferences_.begin(kPreferencesNamespace, false)) {
    return false;
  }

  if (FFat.begin(false)) {
    preferences_.putBool(kInitializedKey, true);
    return true;
  }

  // Format only a partition that this firmware has never initialized. Once
  // data has existed, a mount failure is left untouched for recovery instead
  // of silently erasing training data.
  if (preferences_.getBool(kInitializedKey, false)) {
    Serial.println(
        "[STORAGE] FFat mount failed; refusing to format existing data");
    return false;
  }

  Serial.println("[STORAGE] initializing passage data partition once");
  FFat.end();
  if (!FFat.format() || !FFat.begin(false)) {
    return false;
  }
  preferences_.putBool(kInitializedKey, true);
  return true;
}

bool PassageJournal::recoverFiles() {
  if (!FFat.exists(kJournalPath)) {
    if (FFat.exists(kTemporaryPath)) {
      if (!FFat.rename(kTemporaryPath, kJournalPath)) {
        return false;
      }
    } else if (FFat.exists(kBackupPath)) {
      if (!FFat.rename(kBackupPath, kJournalPath)) {
        return false;
      }
    } else {
      File created = FFat.open(kJournalPath, FILE_WRITE);
      if (!created) {
        return false;
      }
      created.flush();
      created.close();
    }
  }
  if (FFat.exists(kTemporaryPath)) {
    FFat.remove(kTemporaryPath);
  }
  if (FFat.exists(kBackupPath)) {
    FFat.remove(kBackupPath);
  }
  return true;
}

bool PassageJournal::repairTrailingBytes(uint32_t alignedSize) {
  File source = FFat.open(kJournalPath, FILE_READ);
  File destination = FFat.open(kTemporaryPath, FILE_WRITE);
  if (!source || !destination) {
    source.close();
    destination.close();
    return false;
  }

  uint8_t buffer[512]{};
  uint32_t remaining = alignedSize;
  while (remaining > 0) {
    const size_t chunk = remaining > sizeof(buffer)
        ? sizeof(buffer)
        : static_cast<size_t>(remaining);
    if (source.read(buffer, chunk) != chunk ||
        destination.write(buffer, chunk) != chunk) {
      source.close();
      destination.close();
      return false;
    }
    remaining -= static_cast<uint32_t>(chunk);
  }
  destination.flush();
  source.close();
  destination.close();

  FFat.remove(kBackupPath);
  if (!FFat.rename(kJournalPath, kBackupPath)) {
    return false;
  }
  if (!FFat.rename(kTemporaryPath, kJournalPath)) {
    FFat.rename(kBackupPath, kJournalPath);
    return false;
  }
  FFat.remove(kBackupPath);
  return true;
}

bool PassageJournal::scanRecords() {
  File file = FFat.open(kJournalPath, FILE_READ);
  if (!file) {
    return false;
  }
  fileBytes_ = static_cast<uint32_t>(file.size());
  file.close();

  const uint32_t alignedSize = fileBytes_ -
      (fileBytes_ % static_cast<uint32_t>(sizeof(JournalRecord)));
  if (alignedSize != fileBytes_) {
    Serial.printf(
        "[STORAGE] repairing %lu-byte interrupted journal tail\n",
        static_cast<unsigned long>(fileBytes_ - alignedSize));
    if (!repairTrailingBytes(alignedSize)) {
      return false;
    }
    fileBytes_ = alignedSize;
  }

  acknowledgedOffset_ = preferences_.getULong(kAcknowledgedKey, 0);
  if (acknowledgedOffset_ > fileBytes_ ||
      acknowledgedOffset_ % sizeof(JournalRecord) != 0) {
    // Replaying an already-uploaded idempotent row is safer than skipping an
    // unacknowledged record after damaged metadata.
    acknowledgedOffset_ = 0;
    preferences_.putULong(kAcknowledgedKey, 0);
  }

  pendingRecords_ = 0;
  corruptRecords_ = 0;
  file = FFat.open(kJournalPath, FILE_READ);
  if (!file || !file.seek(acknowledgedOffset_)) {
    file.close();
    return false;
  }
  JournalRecord record{};
  while (file.read(
             reinterpret_cast<uint8_t *>(&record),
             sizeof(record)) == sizeof(record)) {
    if (validRecord(&record)) {
      ++pendingRecords_;
    } else {
      ++corruptRecords_;
    }
  }
  file.close();
  return true;
}

void PassageJournal::refreshCapacity() {
  usedBytes_ = static_cast<uint32_t>(FFat.usedBytes());
  freeBytes_ = static_cast<uint32_t>(FFat.freeBytes());
}

bool PassageJournal::begin() {
  mutex_ = xSemaphoreCreateMutex();
  if (mutex_ == nullptr || !mountStorage() || !recoverFiles() ||
      !scanRecords()) {
    ++persistFailures_;
    return false;
  }
  refreshCapacity();
  ready_ = true;
  Serial.printf(
      "[STORAGE] durable passage journal ready pending=%lu "
      "used=%luKB free=%luKB corrupt=%lu\n",
      static_cast<unsigned long>(pendingRecords_),
      static_cast<unsigned long>(usedBytes_ / 1024UL),
      static_cast<unsigned long>(freeBytes_ / 1024UL),
      static_cast<unsigned long>(corruptRecords_));
  return true;
}

bool PassageJournal::ready() const {
  return ready_;
}

bool PassageJournal::append(const CloudPassage &passage) {
  if (!ready_ || !lock()) {
    return false;
  }

  JournalRecord record{};
  record.magic = kRecordMagic;
  record.version = kRecordVersion;
  record.payloadBytes = sizeof(CloudPassage);
  record.payload = passage;
  record.checksum = crc32(
      reinterpret_cast<const uint8_t *>(&record),
      kChecksumBytes);

  File file = FFat.open(kJournalPath, FILE_APPEND);
  const bool accepted = file &&
      file.write(
          reinterpret_cast<const uint8_t *>(&record),
          sizeof(record)) == sizeof(record);
  if (file) {
    file.flush();
    file.close();
  }

  if (accepted) {
    fileBytes_ += sizeof(record);
    ++pendingRecords_;
  } else {
    ++persistFailures_;
    // A failed FAT append can leave a partial record. Restore the previously
    // known aligned prefix before accepting any later passage.
    if (!repairTrailingBytes(fileBytes_)) {
      ready_ = false;
    }
    Serial.println(
        "[STORAGE] passage persistence failed; record remains in tracker");
  }
  refreshCapacity();
  unlock();
  return accepted;
}

size_t PassageJournal::readBatch(
    CloudPassage *passages,
    size_t capacity,
    uint32_t &nextOffset) {
  nextOffset = acknowledgedOffset_;
  if (!ready_ || passages == nullptr || capacity == 0 || !lock()) {
    return 0;
  }

  const uint32_t startOffset = acknowledgedOffset_;
  nextOffset = startOffset;
  File file = FFat.open(kJournalPath, FILE_READ);
  if (!file || !file.seek(startOffset)) {
    file.close();
    unlock();
    return 0;
  }

  size_t count = 0;
  JournalRecord record{};
  while (count < capacity &&
         file.read(
             reinterpret_cast<uint8_t *>(&record),
             sizeof(record)) == sizeof(record)) {
    nextOffset += sizeof(record);
    if (validRecord(&record)) {
      passages[count++] = record.payload;
    }
  }
  file.close();
  unlock();
  return count;
}

bool PassageJournal::compact() {
  File source = FFat.open(kJournalPath, FILE_READ);
  File destination = FFat.open(kTemporaryPath, FILE_WRITE);
  if (!source || !destination || !source.seek(acknowledgedOffset_)) {
    source.close();
    destination.close();
    return false;
  }

  uint8_t buffer[1024]{};
  while (source.available()) {
    const size_t readCount = source.read(buffer, sizeof(buffer));
    if (readCount == 0 || destination.write(buffer, readCount) != readCount) {
      source.close();
      destination.close();
      return false;
    }
  }
  destination.flush();
  source.close();
  destination.close();

  // Resetting the cursor before file replacement can only cause duplicate
  // idempotent uploads if power fails between these operations; it cannot skip
  // an unuploaded record.
  if (preferences_.putULong(kAcknowledgedKey, 0) != sizeof(uint32_t)) {
    return false;
  }
  FFat.remove(kBackupPath);
  if (!FFat.rename(kJournalPath, kBackupPath)) {
    return false;
  }
  if (!FFat.rename(kTemporaryPath, kJournalPath)) {
    FFat.rename(kBackupPath, kJournalPath);
    return false;
  }
  FFat.remove(kBackupPath);
  fileBytes_ -= acknowledgedOffset_;
  acknowledgedOffset_ = 0;
  refreshCapacity();
  return true;
}

bool PassageJournal::compactIfNeeded() {
  if (acknowledgedOffset_ == 0) {
    return true;
  }
  if (acknowledgedOffset_ == fileBytes_ ||
      acknowledgedOffset_ >= CHECKIT_PASSAGE_JOURNAL_COMPACT_BYTES) {
    return compact();
  }
  return true;
}

bool PassageJournal::acknowledge(
    uint32_t nextOffset,
    size_t consumedRecords) {
  if (!ready_ || !lock()) {
    return false;
  }
  if (nextOffset < acknowledgedOffset_ || nextOffset > fileBytes_ ||
      nextOffset % sizeof(JournalRecord) != 0) {
    unlock();
    return false;
  }
  if (preferences_.putULong(kAcknowledgedKey, nextOffset) !=
      sizeof(uint32_t)) {
    ++persistFailures_;
    unlock();
    return false;
  }
  const uint32_t consumedSlots =
      (nextOffset - acknowledgedOffset_) / sizeof(JournalRecord);
  const uint32_t corruptConsumed = consumedSlots > consumedRecords
      ? consumedSlots - static_cast<uint32_t>(consumedRecords)
      : 0;
  acknowledgedOffset_ = nextOffset;
  pendingRecords_ = consumedRecords > pendingRecords_
      ? 0
      : pendingRecords_ - static_cast<uint32_t>(consumedRecords);
  corruptRecords_ = corruptConsumed > corruptRecords_
      ? 0
      : corruptRecords_ - corruptConsumed;
  const bool compacted = compactIfNeeded();
  if (!compacted) {
    ++persistFailures_;
  }
  unlock();
  return compacted;
}

uint32_t PassageJournal::acknowledgedOffset() const {
  if (!ready_ || !lock()) {
    return 0;
  }
  const uint32_t value = acknowledgedOffset_;
  unlock();
  return value;
}

size_t PassageJournal::pendingCount() const {
  if (!ready_ || !lock()) {
    return 0;
  }
  const size_t value = pendingRecords_;
  unlock();
  return value;
}

PassageJournalStats PassageJournal::stats() const {
  PassageJournalStats result{};
  if (!lock()) {
    return result;
  }
  result.ready = ready_;
  result.pendingRecords = pendingRecords_;
  result.corruptRecords = corruptRecords_;
  result.persistFailures = persistFailures_;
  result.usedBytes = usedBytes_;
  result.freeBytes = freeBytes_;
  unlock();
  return result;
}

}  // namespace CheckIt
