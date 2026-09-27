#include "WarningOutputs.h"

namespace CheckIt {

WarningOutputs::WarningOutputs(
    int8_t matrixDataPin,
    int8_t matrixChipSelectPin,
    int8_t matrixClockPin,
    uint8_t matrixModuleCount,
    bool reverseModuleOrder,
    int8_t speakerPin,
    int8_t statusLedPin,
    bool matrixEnabled,
    bool speakerEnabled)
    : display_(
          matrixDataPin,
          matrixChipSelectPin,
          matrixClockPin,
          matrixModuleCount,
          reverseModuleOrder),
      speakerPin_(speakerPin),
      statusLedPin_(statusLedPin),
      matrixEnabled_(matrixEnabled),
      speakerEnabled_(speakerEnabled),
      outputOn_(false),
      tooFastSecondPage_(false),
      speedKmh_(0),
      direction_(DIR_UNKNOWN),
      level_(WARN_NONE),
      untilMs_(0),
      lastToggleMs_(0) {}

void WarningOutputs::begin(uint8_t matrixIntensity) {
  if (matrixEnabled_) {
    display_.begin(matrixIntensity);
    display_.showIdle();
  }
  if (speakerEnabled_ && speakerPin_ >= 0) {
    pinMode(speakerPin_, OUTPUT);
    digitalWrite(speakerPin_, LOW);
  }
  if (statusLedPin_ >= 0) {
    pinMode(statusLedPin_, OUTPUT);
    digitalWrite(statusLedPin_, LOW);
  }
}

void WarningOutputs::start(
    uint8_t speedKmh,
    Direction direction,
    WarningLevel level,
    uint16_t durationMs,
    uint32_t nowMs) {
  if (outputOn_) {
    setOutput(false);
  }
  speedKmh_ = speedKmh;
  direction_ = direction;
  level_ = level;
  untilMs_ = nowMs + durationMs;
  lastToggleMs_ = nowMs;
  tooFastSecondPage_ = false;
  setOutput(true);
}

void WarningOutputs::stop() {
  untilMs_ = 0;
  level_ = WARN_NONE;
  setOutput(false);
  if (matrixEnabled_) {
    display_.showIdle();
  }
}

bool WarningOutputs::active(uint32_t nowMs) const {
  return level_ != WARN_NONE &&
      static_cast<int32_t>(untilMs_ - nowMs) > 0;
}

uint16_t WarningOutputs::blinkIntervalMs() const {
  switch (level_) {
    case WARN_EMERGENCY:
      return 240;
    case WARN_DANGER:
      return 140;
    case WARN_INFO:
      return 300;
    default:
      return 500;
  }
}

uint16_t WarningOutputs::speakerFrequencyHz() const {
  switch (level_) {
    case WARN_EMERGENCY:
      return 2800;
    case WARN_DANGER:
      return 2200;
    case WARN_INFO:
      return 1600;
    default:
      return 0;
  }
}

void WarningOutputs::setOutput(bool on) {
  if (outputOn_ == on) {
    return;
  }
  outputOn_ = on;

  if (statusLedPin_ >= 0) {
    digitalWrite(statusLedPin_, on ? HIGH : LOW);
  }

  if (matrixEnabled_) {
    if (on) {
      if (level_ == WARN_EMERGENCY) {
        display_.showTooFast(tooFastSecondPage_);
        tooFastSecondPage_ = !tooFastSecondPage_;
      } else {
        display_.showSpeed(speedKmh_, direction_);
      }
    } else {
      display_.clear();
    }
  }

  if (speakerEnabled_ && speakerPin_ >= 0) {
    if (on) {
      tone(speakerPin_, speakerFrequencyHz());
    } else {
      noTone(speakerPin_);
      digitalWrite(speakerPin_, LOW);
    }
  }
}

void WarningOutputs::update(uint32_t nowMs) {
  if (!active(nowMs)) {
    if (level_ != WARN_NONE || outputOn_) {
      stop();
    }
    return;
  }

  if (static_cast<uint32_t>(nowMs - lastToggleMs_) >= blinkIntervalMs()) {
    lastToggleMs_ = nowMs;
    setOutput(!outputOn_);
  }
}

}  // namespace CheckIt
