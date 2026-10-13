#pragma once

#include <stddef.h>
#include <stdint.h>

#include "CheckItCore.h"

namespace CheckIt {

static constexpr uint8_t kLd2451MaxTargets = 16;
// The report count is one byte. Keep enough input storage to validate any
// representable report, while exposing only the first bounded set of targets.
static constexpr uint16_t kLd2451MaxPayload = 2 + (5 * 255);
static constexpr uint8_t kLd2451MaxCommandFrame = 32;
static constexpr uint8_t kLd2451MaxAckPayload = 24;

struct Ld2451Frame {
  bool alarm;
  uint8_t reportedTargetCount;
  uint8_t targetCount;
  bool truncated;
  RadarTarget targets[kLd2451MaxTargets];
};

struct Ld2451ParserStats {
  uint32_t bytesSeen;
  uint32_t headersSeen;
  uint32_t validFrames;
  uint32_t emptyFrames;
  uint32_t invalidLengths;
  uint32_t invalidPayloads;
  uint32_t invalidTrailers;
};

enum Ld2451LinkState : uint8_t {
  LD2451_NO_DATA,
  LD2451_UNDECODABLE_DATA,
  LD2451_VALID_IDLE,
  LD2451_TARGET_REPORTED,
  LD2451_REPORTS_STALE
};
Ld2451LinkState classifyLd2451Link(bool hasReport, uint32_t reportAgeMs,
    uint8_t reportedTargets, bool hasBytes, uint32_t byteAgeMs,
    uint32_t recentMs);
const char *ld2451LinkStateName(Ld2451LinkState state);

enum Ld2451ParseResult : uint8_t {
  LD2451_IN_PROGRESS = 0,
  LD2451_FRAME_READY = 1,
  LD2451_FRAME_ERROR = 2
};

class Ld2451Parser {
 public:
  explicit Ld2451Parser(
      bool directionByteZeroMeansApproach = false,
      int8_t angleSign = 1);

  Ld2451ParseResult push(uint8_t byte, Ld2451Frame &frame);
  bool parsePayload(
      const uint8_t *payload,
      uint16_t length,
      Ld2451Frame &frame) const;

  void reset();
  const Ld2451ParserStats &stats() const;

 private:
  enum State : uint8_t {
    SEEK_HEADER,
    READ_LENGTH_LOW,
    READ_LENGTH_HIGH,
    READ_PAYLOAD,
    READ_TRAILER
  };

  static constexpr uint8_t kHeader[4] = {0xF4, 0xF3, 0xF2, 0xF1};
  static constexpr uint8_t kTrailer[4] = {0xF8, 0xF7, 0xF6, 0xF5};

  bool directionByteZeroMeansApproach_;
  int8_t angleSign_;
  State state_;
  uint8_t headerIndex_;
  uint8_t trailerIndex_;
  uint16_t payloadLength_;
  uint16_t payloadIndex_;
  uint8_t payload_[kLd2451MaxPayload];
  Ld2451ParserStats stats_;

  void resetFrameState();
  void consumeHeaderByte(uint8_t byte);
};

struct Ld2451CommandFrame {
  uint8_t bytes[kLd2451MaxCommandFrame];
  uint8_t length;
  uint16_t command;
};

namespace Ld2451Commands {

Ld2451CommandFrame enableConfiguration();
Ld2451CommandFrame endConfiguration();
Ld2451CommandFrame readFirmwareVersion();
Ld2451CommandFrame factoryReset();
Ld2451CommandFrame reboot();

}  // namespace Ld2451Commands

struct Ld2451Ack {
  uint16_t command;
  uint16_t status;
  uint8_t payloadLength;
  uint8_t payload[kLd2451MaxAckPayload];
};

class Ld2451AckParser {
 public:
  Ld2451AckParser();

  Ld2451ParseResult push(uint8_t byte, Ld2451Ack &ack);
  void reset();

 private:
  enum State : uint8_t {
    SEEK_HEADER,
    READ_LENGTH_LOW,
    READ_LENGTH_HIGH,
    READ_PAYLOAD,
    READ_TRAILER
  };

  static constexpr uint8_t kHeader[4] = {0xFD, 0xFC, 0xFB, 0xFA};
  static constexpr uint8_t kTrailer[4] = {0x04, 0x03, 0x02, 0x01};

  State state_;
  uint8_t headerIndex_;
  uint8_t trailerIndex_;
  uint16_t payloadLength_;
  uint16_t payloadIndex_;
  uint8_t payload_[4 + kLd2451MaxAckPayload];

  void resetFrameState();
  void consumeHeaderByte(uint8_t byte);
};

}  // namespace CheckIt
