#include "Max7219Display.h"

#include <string.h>

namespace CheckIt {

namespace {

const uint8_t kBlank[8] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};

const uint8_t kDash[8] = {
    0x00, 0x00, 0x00, 0x7E, 0x7E, 0x00, 0x00, 0x00};

const uint8_t kApproachArrow[8] = {
    0x18, 0x3C, 0x7E, 0xDB, 0x18, 0x18, 0x18, 0x18};

const uint8_t kAwayArrow[8] = {
    0x18, 0x18, 0x18, 0x18, 0xDB, 0x7E, 0x3C, 0x18};

const uint8_t kUnknownGlyph[8] = {
    0x3C, 0x66, 0x06, 0x0C, 0x18, 0x00, 0x18, 0x18};

const uint8_t kLetterA[8] = {
    0x18, 0x3C, 0x66, 0x66, 0x7E, 0x66, 0x66, 0x00};

const uint8_t kLetterF[8] = {
    0x7E, 0x60, 0x60, 0x7C, 0x60, 0x60, 0x60, 0x00};

const uint8_t kLetterT[8] = {
    0x7E, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x00};

const uint8_t kDigits[10][8] = {
    {0x3C, 0x66, 0x6E, 0x76, 0x66, 0x66, 0x3C, 0x00},
    {0x18, 0x38, 0x18, 0x18, 0x18, 0x18, 0x7E, 0x00},
    {0x3C, 0x66, 0x06, 0x0C, 0x30, 0x60, 0x7E, 0x00},
    {0x3C, 0x66, 0x06, 0x1C, 0x06, 0x66, 0x3C, 0x00},
    {0x0C, 0x1C, 0x3C, 0x6C, 0x7E, 0x0C, 0x0C, 0x00},
    {0x7E, 0x60, 0x7C, 0x06, 0x06, 0x66, 0x3C, 0x00},
    {0x1C, 0x30, 0x60, 0x7C, 0x66, 0x66, 0x3C, 0x00},
    {0x7E, 0x66, 0x06, 0x0C, 0x18, 0x18, 0x18, 0x00},
    {0x3C, 0x66, 0x66, 0x3C, 0x66, 0x66, 0x3C, 0x00},
    {0x3C, 0x66, 0x66, 0x3E, 0x06, 0x0C, 0x38, 0x00}};

}  // namespace

Max7219Display::Max7219Display(
    int8_t dataPin,
    int8_t chipSelectPin,
    int8_t clockPin,
    uint8_t moduleCount,
    bool reverseModuleOrder)
    : dataPin_(dataPin),
      chipSelectPin_(chipSelectPin),
      clockPin_(clockPin),
      moduleCount_(
          moduleCount == 0
              ? 1
              : (moduleCount > kMaxModules ? kMaxModules : moduleCount)),
      reverseModuleOrder_(reverseModuleOrder) {
  memset(rows_, 0, sizeof(rows_));
}

void Max7219Display::begin(uint8_t intensity) {
  pinMode(dataPin_, OUTPUT);
  pinMode(chipSelectPin_, OUTPUT);
  pinMode(clockPin_, OUTPUT);
  digitalWrite(chipSelectPin_, HIGH);
  digitalWrite(clockPin_, LOW);

  sendCommandAll(0x0F, 0x00);  // display test off
  sendCommandAll(0x0C, 0x01);  // normal operation
  sendCommandAll(0x0B, 0x07);  // all eight rows
  sendCommandAll(0x09, 0x00);  // no BCD decode
  setIntensity(intensity);
  clear();
}

void Max7219Display::sendCommandAll(uint8_t address, uint8_t value) {
  digitalWrite(chipSelectPin_, LOW);
  for (uint8_t module = 0; module < moduleCount_; ++module) {
    shiftOut(dataPin_, clockPin_, MSBFIRST, address);
    shiftOut(dataPin_, clockPin_, MSBFIRST, value);
  }
  digitalWrite(chipSelectPin_, HIGH);
}

void Max7219Display::setIntensity(uint8_t intensity) {
  sendCommandAll(0x0A, intensity > 15 ? 15 : intensity);
}

uint8_t Max7219Display::physicalModule(uint8_t logicalModule) const {
  return reverseModuleOrder_
      ? static_cast<uint8_t>(moduleCount_ - 1 - logicalModule)
      : logicalModule;
}

void Max7219Display::setGlyph(uint8_t module, const uint8_t glyph[8]) {
  if (module >= moduleCount_) {
    return;
  }
  memcpy(rows_[physicalModule(module)], glyph, 8);
}

void Max7219Display::flushRows() {
  for (uint8_t row = 0; row < 8; ++row) {
    digitalWrite(chipSelectPin_, LOW);
    // MAX7219 chains receive the farthest module first.
    for (int module = moduleCount_ - 1; module >= 0; --module) {
      shiftOut(dataPin_, clockPin_, MSBFIRST, row + 1);
      shiftOut(dataPin_, clockPin_, MSBFIRST, rows_[module][row]);
    }
    digitalWrite(chipSelectPin_, HIGH);
  }
}

void Max7219Display::clear() {
  memset(rows_, 0, sizeof(rows_));
  flushRows();
}

void Max7219Display::showSpeed(uint8_t speedKmh, Direction direction) {
  memset(rows_, 0, sizeof(rows_));

  if (moduleCount_ >= 4) {
    setGlyph(
        0,
        direction == DIR_APPROACH
            ? kApproachArrow
            : (direction == DIR_AWAY ? kAwayArrow : kUnknownGlyph));

    const uint8_t hundreds = speedKmh / 100;
    const uint8_t tens = (speedKmh / 10) % 10;
    const uint8_t ones = speedKmh % 10;
    setGlyph(1, hundreds == 0 ? kBlank : kDigits[hundreds]);
    setGlyph(2, speedKmh < 10 ? kBlank : kDigits[tens]);
    setGlyph(3, kDigits[ones]);
  } else {
    // Use all available modules for the least ambiguous numeric value.
    const uint8_t hundreds = speedKmh / 100;
    const uint8_t tens = (speedKmh / 10) % 10;
    const uint8_t ones = speedKmh % 10;
    if (moduleCount_ == 1) {
      setGlyph(0, kDigits[ones]);
    } else if (moduleCount_ == 2) {
      setGlyph(0, speedKmh < 10 ? kBlank : kDigits[tens]);
      setGlyph(1, kDigits[ones]);
    } else {
      setGlyph(0, hundreds == 0 ? kBlank : kDigits[hundreds]);
      setGlyph(1, speedKmh < 10 ? kBlank : kDigits[tens]);
      setGlyph(2, kDigits[ones]);
    }
  }

  flushRows();
}

void Max7219Display::showTooFast(bool fastPage) {
  memset(rows_, 0, sizeof(rows_));

  const uint8_t *page[4] = {
      fastPage ? kLetterF : kLetterT,
      fastPage ? kLetterA : kDigits[0],
      fastPage ? kDigits[5] : kDigits[0],
      fastPage ? kLetterT : kBlank};
  for (uint8_t module = 0; module < moduleCount_ && module < 4; ++module) {
    setGlyph(module, page[module]);
  }

  flushRows();
}

void Max7219Display::showIdle() {
  memset(rows_, 0, sizeof(rows_));
  for (uint8_t module = 0; module < moduleCount_; ++module) {
    setGlyph(module, kDash);
  }
  flushRows();
}

}  // namespace CheckIt
