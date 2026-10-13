#pragma once

#include <Arduino.h>

namespace CheckIt {

// Lonely Binary modules accept active-high segment patterns despite their
// common-anode LEDs: the onboard driver handles the LED polarity.
class LonelyBinaryDisplay {
 public:
  LonelyBinaryDisplay(int8_t dataPin, int8_t latchPin, int8_t clockPin,
                      bool reverseDigitOrder = false, uint16_t halfPeriodUs = 10)
      : dataPin_(dataPin), latchPin_(latchPin), clockPin_(clockPin),
        reverseDigitOrder_(reverseDigitOrder),
        halfPeriodUs_(halfPeriodUs ? halfPeriodUs : 10) {}

  void begin();
  void clear();
  // Light all seven bars and the decimal point on both modules.
  void showAllSegments();
  // Choose each digit independently; -1 (or any invalid digit) means blank.
  void showDigits(int leftDigit, int rightDigit);
  // Re-send the requested pattern after display power interruptions.
  void refresh();
  void blank() { clear(); }
  // Leading zero is intentional (7 -> 07). Negative values blank the chain.
  // Accept int rather than uint8_t so values above 255 cannot wrap before clamp.
  void showNumber(int number, bool leadingZero = true);
  void showSpeed(int speedKmh) { showNumber(speedKmh); }

 private:
  int8_t dataPin_;
  int8_t latchPin_;
  int8_t clockPin_;
  bool reverseDigitOrder_;
  uint16_t halfPeriodUs_;
  uint8_t leftPattern_ = 0;
  uint8_t rightPattern_ = 0;
  void sendByte(uint8_t pattern);
  void writeDigits(uint8_t left, uint8_t right);
};

}  // namespace CheckIt
