#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <stddef.h>
#include <stdint.h>

#include "CloudPassage.h"

namespace CheckIt {

struct PassageJournalStats {
  bool ready;
  uint32_t pendingRecords;
  uint32_t corruptRecords;
  uint32_t persistFailures;
  uint32_t usedBytes;
  uint32_t freeBytes;
};

// Flash-backed, append-only passage outbox. Records remain on FFat until the
// cloud uploader acknowledges the exact byte offset after a successful,
// idempotent Supabase upsert. A reset can cause a harmless re-upload, but it
// cannot acknowledge a record that Supabase has not accepted.
class PassageJournal {
 public:
  PassageJournal();

  bool begin();
  bool ready() const;
  bool append(const CloudPassage &passage);

  // Reads up to capacity valid records beginning at the durable acknowledgement
  // cursor. nextOffset may advance across an unrecoverable corrupt record so it
  // can be reported and quarantined instead of blocking every later record.
  size_t readBatch(
      CloudPassage *passages,
      size_t capacity,
      uint32_t &nextOffset);
  bool acknowledge(uint32_t nextOffset, size_t uploadedRecords);

  uint32_t acknowledgedOffset() const;
  size_t pendingCount() const;
  PassageJournalStats stats() const;

 private:
  bool mountStorage();
  bool recoverFiles();
  bool scanRecords();
  bool repairTrailingBytes(uint32_t alignedSize);
  bool compactIfNeeded();
  bool compact();
  bool validRecord(const void *record) const;
  uint32_t crc32(const uint8_t *data, size_t length) const;
  bool lock() const;
  void unlock() const;
  void refreshCapacity();

  mutable SemaphoreHandle_t mutex_;
  Preferences preferences_;
  bool ready_;
  uint32_t acknowledgedOffset_;
  uint32_t fileBytes_;
  uint32_t pendingRecords_;
  uint32_t corruptRecords_;
  uint32_t persistFailures_;
  uint32_t usedBytes_;
  uint32_t freeBytes_;
};

}  // namespace CheckIt
