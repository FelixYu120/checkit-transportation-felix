#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "CheckItCore.h"

namespace CheckIt {

static constexpr uint16_t kProtocolMagic = 0xC17A;
static constexpr uint8_t kProtocolVersion = 2;
static constexpr uint16_t kBroadcastNodeId = 0;

enum MessageType : uint8_t {
  MSG_ALERT = 1,
  MSG_CLEAR = 2,
  MSG_HEARTBEAT = 3,
  MSG_ACK = 4
};

enum MessageFlags : uint8_t {
  FLAG_NONE = 0,
  FLAG_RADAR_ALARM = 1 << 0,
  FLAG_LOCAL_OUTPUT = 1 << 1,
  FLAG_REMOTE_OUTPUT = 1 << 2
};

struct __attribute__((packed)) CheckItMessage {
  uint16_t magic;
  uint8_t version;
  uint8_t type;
  uint16_t sequence;
  uint16_t sourceNodeId;
  uint16_t targetNodeId;
  uint32_t uptimeMs;
  uint8_t flags;
  uint8_t targetIndex;
  int8_t angleDeg;
  uint8_t distanceM;
  uint8_t speedKmh;
  uint8_t snr;
  uint8_t direction;
  uint8_t warningLevel;
  uint16_t durationMs;
  uint16_t relatedSequence;
  uint16_t crc16;
};

static_assert(sizeof(CheckItMessage) == 28, "Unexpected CheckItMessage layout");
static_assert(sizeof(CheckItMessage) <= 250, "ESP-NOW packet too large");

uint16_t crc16Ccitt(const uint8_t *data, size_t length);

inline uint16_t messageCrc(const CheckItMessage &message) {
  return crc16Ccitt(
      reinterpret_cast<const uint8_t *>(&message),
      offsetof(CheckItMessage, crc16));
}

inline bool isKnownMessageType(uint8_t type) {
  return type >= MSG_ALERT && type <= MSG_ACK;
}

inline bool isValidMessage(
    const CheckItMessage &message,
    size_t receivedLength = sizeof(CheckItMessage)) {
  if (receivedLength != sizeof(CheckItMessage)) {
    return false;
  }
  if (message.magic != kProtocolMagic ||
      message.version != kProtocolVersion ||
      !isKnownMessageType(message.type)) {
    return false;
  }
  return message.crc16 == messageCrc(message);
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
    uint16_t relatedSequence = 0);

inline CheckItMessage makeAck(
    uint16_t sequence,
    uint16_t sourceNodeId,
    uint16_t targetNodeId,
    uint32_t uptimeMs,
    uint16_t acknowledgedSequence) {
  return makeMessage(
      MSG_ACK,
      sequence,
      sourceNodeId,
      targetNodeId,
      uptimeMs,
      nullptr,
      WARN_NONE,
      0,
      FLAG_NONE,
      acknowledgedSequence);
}

class SequenceTracker {
 public:
  static constexpr uint8_t kMaxSources = 8;

  SequenceTracker();

  // Returns true for the first packet from a source and for packets newer than
  // the last accepted 16-bit sequence, including normal wraparound.
  bool accept(uint16_t sourceNodeId, uint16_t sequence);
  void reset();

 private:
  struct Entry {
    uint16_t sourceNodeId;
    uint16_t lastSequence;
    bool used;
  };

  Entry entries_[kMaxSources];
};

}  // namespace CheckIt
