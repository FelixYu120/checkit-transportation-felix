#pragma once

#include <stddef.h>
#include <stdint.h>

namespace CheckIt {

constexpr size_t kLd2415hMeasurementBytes = 9U;
constexpr size_t kLd2415hCommandBytes = 8U;

enum Ld2415hParseResult : uint8_t {
  LD2415H_IN_PROGRESS = 0,
  LD2415H_MEASUREMENT_READY = 1,
  LD2415H_FRAME_ERROR = 2
};

enum Ld2415hDirection : uint8_t {
  LD2415H_APPROACH = 0,
  LD2415H_AWAY = 1
};

enum Ld2415hDetectionMode : uint8_t {
  LD2415H_DETECT_BOTH = 0,
  LD2415H_DETECT_APPROACH_ONLY = 1,
  LD2415H_DETECT_AWAY_ONLY = 2
};

enum Ld2415hSpeedUnit : uint8_t {
  LD2415H_KMH = 0,
  LD2415H_MPH = 1,
  LD2415H_MPS = 2
};

struct Ld2415hMeasurement {
  // Signed tenths of km/h. Positive is approach and negative is away when
  // the radar is configured for km/h standard-protocol output.
  int16_t signedSpeedTenthsKmh;
  Ld2415hDirection direction;
  uint8_t raw[kLd2415hMeasurementBytes];
};

class Ld2415hParser {
 public:
  Ld2415hParser();

  Ld2415hParseResult push(
      uint8_t byte,
      Ld2415hMeasurement &measurement);
  void reset();
  uint32_t validFrames() const;
  uint32_t frameErrors() const;

 private:
  bool decode(Ld2415hMeasurement &measurement) const;
  uint8_t buffer_[kLd2415hMeasurementBytes];
  uint8_t index_;
  uint32_t validFrames_;
  uint32_t frameErrors_;
};

// Commands below are the documented 0x43 0x46 standard-protocol commands.
// They intentionally do not assume an acknowledgement: deployed modules may
// resume measurements immediately after accepting a command.
bool buildLd2415hMeasurementConfig(
    uint8_t minimumSpeedKmh,
    uint8_t angleCompensationDeg,
    uint8_t sensitivity,
    uint8_t output[kLd2415hCommandBytes]);

bool buildLd2415hOutputConfig(
    Ld2415hDetectionMode mode,
    uint8_t sampleRateDivisor,
    Ld2415hSpeedUnit unit,
    uint8_t output[kLd2415hCommandBytes]);

bool buildLd2415hAntiVibrationConfig(
    uint8_t coefficient,
    uint8_t output[kLd2415hCommandBytes]);

}  // namespace CheckIt
