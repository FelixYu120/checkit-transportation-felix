#include "Ld2451Protocol.h"

#include <string.h>

namespace CheckIt {

constexpr uint8_t Ld2451Parser::kHeader[4];
constexpr uint8_t Ld2451Parser::kTrailer[4];
constexpr uint8_t Ld2451AckParser::kHeader[4];
constexpr uint8_t Ld2451AckParser::kTrailer[4];

Ld2451Parser::Ld2451Parser(
    bool directionByteZeroMeansApproach,
    int8_t angleSign)
    : directionByteZeroMeansApproach_(directionByteZeroMeansApproach),
      angleSign_(angleSign < 0 ? -1 : 1) {
  memset(&stats_, 0, sizeof(stats_));
  resetFrameState();
}

void Ld2451Parser::resetFrameState() {
  state_ = SEEK_HEADER;
  headerIndex_ = 0;
  trailerIndex_ = 0;
  payloadLength_ = 0;
  payloadIndex_ = 0;
}

void Ld2451Parser::reset() {
  memset(&stats_, 0, sizeof(stats_));
  resetFrameState();
}

const Ld2451ParserStats &Ld2451Parser::stats() const {
  return stats_;
}

void Ld2451Parser::consumeHeaderByte(uint8_t byte) {
  if (byte == kHeader[headerIndex_]) {
    ++headerIndex_;
    if (headerIndex_ == sizeof(kHeader)) {
      state_ = READ_LENGTH_LOW;
      headerIndex_ = 0;
    }
    return;
  }

  headerIndex_ = byte == kHeader[0] ? 1 : 0;
}

Ld2451ParseResult Ld2451Parser::push(uint8_t byte, Ld2451Frame &frame) {
  ++stats_.bytesSeen;

  switch (state_) {
    case SEEK_HEADER:
      consumeHeaderByte(byte);
      return LD2451_IN_PROGRESS;

    case READ_LENGTH_LOW:
      payloadLength_ = byte;
      state_ = READ_LENGTH_HIGH;
      return LD2451_IN_PROGRESS;

    case READ_LENGTH_HIGH:
      payloadLength_ |= static_cast<uint16_t>(byte) << 8;
      if (payloadLength_ > kLd2451MaxPayload) {
        ++stats_.invalidLengths;
        resetFrameState();
        consumeHeaderByte(byte);
        return LD2451_FRAME_ERROR;
      }
      payloadIndex_ = 0;
      state_ = payloadLength_ == 0 ? READ_TRAILER : READ_PAYLOAD;
      return LD2451_IN_PROGRESS;

    case READ_PAYLOAD:
      payload_[payloadIndex_++] = byte;
      if (payloadIndex_ == payloadLength_) {
        trailerIndex_ = 0;
        state_ = READ_TRAILER;
      }
      return LD2451_IN_PROGRESS;

    case READ_TRAILER:
      if (byte != kTrailer[trailerIndex_]) {
        ++stats_.invalidTrailers;
        resetFrameState();
        consumeHeaderByte(byte);
        return LD2451_FRAME_ERROR;
      }
      ++trailerIndex_;
      if (trailerIndex_ < sizeof(kTrailer)) {
        return LD2451_IN_PROGRESS;
      }

      if (!parsePayload(payload_, payloadLength_, frame)) {
        ++stats_.invalidPayloads;
        resetFrameState();
        return LD2451_FRAME_ERROR;
      }

      ++stats_.validFrames;
      if (frame.targetCount == 0) {
        ++stats_.emptyFrames;
      }
      resetFrameState();
      return LD2451_FRAME_READY;
  }

  resetFrameState();
  return LD2451_FRAME_ERROR;
}

bool Ld2451Parser::parsePayload(
    const uint8_t *payload,
    uint16_t length,
    Ld2451Frame &frame) const {
  memset(&frame, 0, sizeof(frame));

  // The radar emits a zero-length heartbeat when no moving target is present.
  if (length == 0) {
    return true;
  }
  if (payload == nullptr) {
    return false;
  }

  // Some field captures prepend an undocumented 02 AA message marker. Support
  // both that variant and the V1.03 documented target-count-first payload.
  const uint16_t offset =
      length >= 2 && payload[0] == 0x02 && payload[1] == 0xAA ? 2 : 0;
  if (length < offset + 2) {
    return false;
  }

  const uint8_t reportedCount = payload[offset];
  if (payload[offset + 1] > 1) {
    return false;
  }
  const uint16_t requiredLength =
      static_cast<uint16_t>(offset + 2 + (reportedCount * 5U));
  if (length != requiredLength) {
    return false;
  }

  frame.alarm = payload[offset + 1] != 0;
  frame.reportedTargetCount = reportedCount;
  frame.targetCount =
      reportedCount > kLd2451MaxTargets ? kLd2451MaxTargets : reportedCount;
  frame.truncated = reportedCount > kLd2451MaxTargets;

  for (uint8_t i = 0; i < frame.targetCount; ++i) {
    const uint16_t base = static_cast<uint16_t>(offset + 2 + (i * 5U));
    RadarTarget &target = frame.targets[i];
    target.targetIndex = i;
    int16_t angleDeg =
        (static_cast<int16_t>(payload[base]) - 0x80) * angleSign_;
    if (angleDeg > 127) {
      angleDeg = 127;
    } else if (angleDeg < -128) {
      angleDeg = -128;
    }
    target.angleDeg = static_cast<int8_t>(angleDeg);
    target.distanceM = payload[base + 1];

    const uint8_t directionByte = payload[base + 2];
    if (directionByte > 1) {
      target.direction = DIR_UNKNOWN;
    } else if (directionByteZeroMeansApproach_) {
      target.direction =
          directionByte == 0 ? DIR_APPROACH : DIR_AWAY;
    } else {
      target.direction =
          directionByte == 0 ? DIR_AWAY : DIR_APPROACH;
    }

    target.speedKmh = payload[base + 3];
    target.snr = payload[base + 4];
  }

  return true;
}

namespace {

Ld2451CommandFrame buildCommand(
    uint16_t command,
    const uint8_t *values,
    uint8_t valueLength) {
  Ld2451CommandFrame frame{};
  const uint16_t dataLength = static_cast<uint16_t>(2 + valueLength);
  const uint8_t totalLength = static_cast<uint8_t>(4 + 2 + dataLength + 4);

  if (totalLength > kLd2451MaxCommandFrame) {
    return frame;
  }

  uint8_t *out = frame.bytes;
  *out++ = 0xFD;
  *out++ = 0xFC;
  *out++ = 0xFB;
  *out++ = 0xFA;
  *out++ = static_cast<uint8_t>(dataLength & 0xFF);
  *out++ = static_cast<uint8_t>(dataLength >> 8);
  *out++ = static_cast<uint8_t>(command & 0xFF);
  *out++ = static_cast<uint8_t>(command >> 8);
  for (uint8_t i = 0; i < valueLength; ++i) {
    *out++ = values[i];
  }
  *out++ = 0x04;
  *out++ = 0x03;
  *out++ = 0x02;
  *out++ = 0x01;

  frame.length = totalLength;
  frame.command = command;
  return frame;
}

}  // namespace

namespace Ld2451Commands {

Ld2451CommandFrame enableConfiguration() {
  const uint8_t values[] = {0x01, 0x00};
  return buildCommand(0x00FF, values, sizeof(values));
}

Ld2451CommandFrame endConfiguration() {
  return buildCommand(0x00FE, nullptr, 0);
}

Ld2451CommandFrame setTargetParameters(
    uint8_t maxDistanceM,
    Ld2451DirectionFilter direction,
    uint8_t minSpeedKmh,
    uint8_t noTargetDelaySec) {
  const uint8_t values[] = {
      maxDistanceM,
      static_cast<uint8_t>(direction),
      minSpeedKmh,
      noTargetDelaySec};
  return buildCommand(0x0002, values, sizeof(values));
}

Ld2451CommandFrame readTargetParameters() {
  return buildCommand(0x0012, nullptr, 0);
}

Ld2451CommandFrame setSensitivity(
    uint8_t consecutiveTriggerCount,
    uint8_t snrThresholdLevel) {
  const uint8_t values[] = {
      consecutiveTriggerCount,
      snrThresholdLevel,
      0x00,
      0x00};
  return buildCommand(0x0003, values, sizeof(values));
}

Ld2451CommandFrame readSensitivity() {
  return buildCommand(0x0013, nullptr, 0);
}

Ld2451CommandFrame readFirmwareVersion() {
  return buildCommand(0x00A0, nullptr, 0);
}

Ld2451CommandFrame factoryReset() {
  return buildCommand(0x00A2, nullptr, 0);
}

Ld2451CommandFrame reboot() {
  return buildCommand(0x00A3, nullptr, 0);
}

}  // namespace Ld2451Commands

Ld2451AckParser::Ld2451AckParser() {
  resetFrameState();
}

void Ld2451AckParser::resetFrameState() {
  state_ = SEEK_HEADER;
  headerIndex_ = 0;
  trailerIndex_ = 0;
  payloadLength_ = 0;
  payloadIndex_ = 0;
}

void Ld2451AckParser::reset() {
  resetFrameState();
}

void Ld2451AckParser::consumeHeaderByte(uint8_t byte) {
  if (byte == kHeader[headerIndex_]) {
    ++headerIndex_;
    if (headerIndex_ == sizeof(kHeader)) {
      state_ = READ_LENGTH_LOW;
      headerIndex_ = 0;
    }
    return;
  }
  headerIndex_ = byte == kHeader[0] ? 1 : 0;
}

Ld2451ParseResult Ld2451AckParser::push(uint8_t byte, Ld2451Ack &ack) {
  switch (state_) {
    case SEEK_HEADER:
      consumeHeaderByte(byte);
      return LD2451_IN_PROGRESS;

    case READ_LENGTH_LOW:
      payloadLength_ = byte;
      state_ = READ_LENGTH_HIGH;
      return LD2451_IN_PROGRESS;

    case READ_LENGTH_HIGH:
      payloadLength_ |= static_cast<uint16_t>(byte) << 8;
      if (payloadLength_ < 4 || payloadLength_ > sizeof(payload_)) {
        resetFrameState();
        consumeHeaderByte(byte);
        return LD2451_FRAME_ERROR;
      }
      payloadIndex_ = 0;
      state_ = READ_PAYLOAD;
      return LD2451_IN_PROGRESS;

    case READ_PAYLOAD:
      payload_[payloadIndex_++] = byte;
      if (payloadIndex_ == payloadLength_) {
        trailerIndex_ = 0;
        state_ = READ_TRAILER;
      }
      return LD2451_IN_PROGRESS;

    case READ_TRAILER:
      if (byte != kTrailer[trailerIndex_]) {
        resetFrameState();
        consumeHeaderByte(byte);
        return LD2451_FRAME_ERROR;
      }
      ++trailerIndex_;
      if (trailerIndex_ < sizeof(kTrailer)) {
        return LD2451_IN_PROGRESS;
      }

      memset(&ack, 0, sizeof(ack));
      ack.command =
          static_cast<uint16_t>(payload_[0]) |
          (static_cast<uint16_t>(payload_[1]) << 8);
      ack.status =
          static_cast<uint16_t>(payload_[2]) |
          (static_cast<uint16_t>(payload_[3]) << 8);
      ack.payloadLength =
          static_cast<uint8_t>(payloadLength_ - 4);
      if (ack.payloadLength > 0) {
        memcpy(ack.payload, payload_ + 4, ack.payloadLength);
      }
      resetFrameState();
      return LD2451_FRAME_READY;
  }

  resetFrameState();
  return LD2451_FRAME_ERROR;
}

}  // namespace CheckIt
