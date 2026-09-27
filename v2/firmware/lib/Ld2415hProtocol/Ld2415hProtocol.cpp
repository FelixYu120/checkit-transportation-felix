#include "Ld2415hProtocol.h"

#include <string.h>

namespace CheckIt {
namespace {

bool isDigit(uint8_t value) {
  return value >= static_cast<uint8_t>('0') &&
      value <= static_cast<uint8_t>('9');
}

void beginCommand(
    uint8_t command,
    uint8_t output[kLd2415hCommandBytes]) {
  memset(output, 0, kLd2415hCommandBytes);
  output[0] = 0x43;
  output[1] = 0x46;
  output[2] = command;
  output[6] = 0x0D;
  output[7] = 0x0A;
}

}  // namespace

Ld2415hParser::Ld2415hParser()
    : buffer_{}, index_(0), validFrames_(0), frameErrors_(0) {}

void Ld2415hParser::reset() {
  index_ = 0;
}

bool Ld2415hParser::decode(Ld2415hMeasurement &measurement) const {
  if (buffer_[0] != static_cast<uint8_t>('V') ||
      (buffer_[1] != static_cast<uint8_t>('+') &&
       buffer_[1] != static_cast<uint8_t>('-')) ||
      !isDigit(buffer_[2]) || !isDigit(buffer_[3]) ||
      !isDigit(buffer_[4]) ||
      buffer_[5] != static_cast<uint8_t>('.') ||
      !isDigit(buffer_[6]) ||
      buffer_[7] != 0x0D || buffer_[8] != 0x0A) {
    return false;
  }

  const int16_t magnitude = static_cast<int16_t>(
      (buffer_[2] - static_cast<uint8_t>('0')) * 1000 +
      (buffer_[3] - static_cast<uint8_t>('0')) * 100 +
      (buffer_[4] - static_cast<uint8_t>('0')) * 10 +
      (buffer_[6] - static_cast<uint8_t>('0')));
  measurement.direction = buffer_[1] == static_cast<uint8_t>('+')
      ? LD2415H_APPROACH
      : LD2415H_AWAY;
  measurement.signedSpeedTenthsKmh =
      measurement.direction == LD2415H_APPROACH ? magnitude : -magnitude;
  memcpy(measurement.raw, buffer_, sizeof(measurement.raw));
  return true;
}

Ld2415hParseResult Ld2415hParser::push(
    uint8_t byte,
    Ld2415hMeasurement &measurement) {
  // A V always starts a new standard-protocol measurement. This also provides
  // deterministic recovery after noise, a partial boot line, or a dropped
  // byte without accepting a reconstructed frame.
  if (byte == static_cast<uint8_t>('V')) {
    if (index_ != 0U) {
      ++frameErrors_;
    }
    buffer_[0] = byte;
    index_ = 1U;
    return LD2415H_IN_PROGRESS;
  }
  if (index_ == 0U) {
    return LD2415H_IN_PROGRESS;
  }

  buffer_[index_++] = byte;
  if (index_ < kLd2415hMeasurementBytes) {
    return LD2415H_IN_PROGRESS;
  }
  index_ = 0U;
  if (!decode(measurement)) {
    ++frameErrors_;
    return LD2415H_FRAME_ERROR;
  }
  ++validFrames_;
  return LD2415H_MEASUREMENT_READY;
}

uint32_t Ld2415hParser::validFrames() const {
  return validFrames_;
}

uint32_t Ld2415hParser::frameErrors() const {
  return frameErrors_;
}

bool buildLd2415hMeasurementConfig(
    uint8_t minimumSpeedKmh,
    uint8_t angleCompensationDeg,
    uint8_t sensitivity,
    uint8_t output[kLd2415hCommandBytes]) {
  if (output == nullptr || minimumSpeedKmh == 0U ||
      angleCompensationDeg > 89U || sensitivity < 1U || sensitivity > 15U) {
    return false;
  }
  beginCommand(0x01, output);
  output[3] = minimumSpeedKmh;
  output[4] = angleCompensationDeg;
  output[5] = sensitivity;
  return true;
}

bool buildLd2415hOutputConfig(
    Ld2415hDetectionMode mode,
    uint8_t sampleRateDivisor,
    Ld2415hSpeedUnit unit,
    uint8_t output[kLd2415hCommandBytes]) {
  if (output == nullptr || mode > LD2415H_DETECT_AWAY_ONLY ||
      unit > LD2415H_MPS) {
    return false;
  }
  beginCommand(0x02, output);
  output[3] = static_cast<uint8_t>(mode);
  output[4] = sampleRateDivisor;
  output[5] = static_cast<uint8_t>(unit);
  return true;
}

bool buildLd2415hAntiVibrationConfig(
    uint8_t coefficient,
    uint8_t output[kLd2415hCommandBytes]) {
  if (output == nullptr || coefficient > 0x70U) {
    return false;
  }
  beginCommand(0x03, output);
  output[3] = coefficient;
  return true;
}

}  // namespace CheckIt
