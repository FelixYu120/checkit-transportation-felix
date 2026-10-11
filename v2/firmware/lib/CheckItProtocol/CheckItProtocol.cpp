#include "CheckItProtocol.h"

namespace CheckIt {

uint16_t crc16Ccitt(const uint8_t *data, size_t length) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < length; ++i) {
    crc ^= static_cast<uint16_t>(data[i]) << 8;
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc & 0x8000)
          ? static_cast<uint16_t>((crc << 1) ^ 0x1021)
          : static_cast<uint16_t>(crc << 1);
    }
  }
  return crc;
}

CheckItMessage makeMessage(
    MessageType type,
    uint16_t sequence,
    uint16_t sourceNodeId,
    uint16_t targetNodeId,
    uint32_t uptimeMs,
    const RadarTarget *target,
    WarningLevel level,
    uint16_t durationMs,
    uint8_t flags,
    uint16_t relatedSequence) {
  CheckItMessage message{};
  message.magic = kProtocolMagic;
  message.version = kProtocolVersion;
  message.type = static_cast<uint8_t>(type);
  message.sequence = sequence;
  message.sourceNodeId = sourceNodeId;
  message.targetNodeId = targetNodeId;
  message.uptimeMs = uptimeMs;
  message.flags = flags;
  message.warningLevel = static_cast<uint8_t>(level);
  message.durationMs = durationMs;
  message.relatedSequence = relatedSequence;

  if (target != nullptr) {
    message.targetIndex = target->targetIndex;
    message.angleDeg = target->angleDeg;
    message.distanceM = target->distanceM;
    message.speedKmh = target->speedKmh;
    message.snr = target->snr;
    message.direction = static_cast<uint8_t>(target->direction);
  }

  message.crc16 = messageCrc(message);
  return message;
}

SequenceTracker::SequenceTracker() {
  reset();
}

void SequenceTracker::reset() {
  memset(entries_, 0, sizeof(entries_));
}

bool SequenceTracker::accept(uint16_t sourceNodeId, uint16_t sequence) {
  Entry *freeEntry = nullptr;
  for (uint8_t i = 0; i < kMaxSources; ++i) {
    Entry &entry = entries_[i];
    if (!entry.used && freeEntry == nullptr) {
      freeEntry = &entry;
      continue;
    }
    if (!entry.used || entry.sourceNodeId != sourceNodeId) {
      continue;
    }

    const int16_t delta = static_cast<int16_t>(sequence - entry.lastSequence);
    if (delta <= 0) {
      return false;
    }
    entry.lastSequence = sequence;
    return true;
  }

  if (freeEntry == nullptr) {
    // Deterministic bounded-memory replacement. This is acceptable because a
    // site is expected to have far fewer than eight radar sources.
    freeEntry = &entries_[sourceNodeId % kMaxSources];
  }
  freeEntry->used = true;
  freeEntry->sourceNodeId = sourceNodeId;
  freeEntry->lastSequence = sequence;
  return true;
}

}  // namespace CheckIt
