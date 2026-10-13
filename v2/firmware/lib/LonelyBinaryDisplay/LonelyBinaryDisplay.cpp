#include "LonelyBinaryDisplay.h"

namespace CheckIt {
namespace {
constexpr uint8_t kDigits[10] = {
    0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};
}

void LonelyBinaryDisplay::begin() {
  // Preload LOW before enabling outputs so clock/latch do not rise on setup.
  digitalWrite(dataPin_, LOW);
  digitalWrite(clockPin_, LOW);
  digitalWrite(latchPin_, LOW);
  pinMode(dataPin_, OUTPUT);
  pinMode(latchPin_, OUTPUT);
  pinMode(clockPin_, OUTPUT);
  clear();
}

void LonelyBinaryDisplay::sendByte(uint8_t pattern) {
  // Both clock phases use the configured duration; 500 us gives about 1 kHz.
  for (int bit = 7; bit >= 0; --bit) {
    digitalWrite(clockPin_, LOW);
    digitalWrite(dataPin_, (pattern & (1U << bit)) ? HIGH : LOW);
    delayMicroseconds(halfPeriodUs_);
    digitalWrite(clockPin_, HIGH);
    delayMicroseconds(halfPeriodUs_);
  }
  digitalWrite(clockPin_, LOW);
}

void LonelyBinaryDisplay::writeDigits(uint8_t left, uint8_t right) {
  leftPattern_ = left;
  rightPattern_ = right;
  digitalWrite(latchPin_, LOW);
  // First byte reaches far module #2; second stays in near module #1.
  sendByte(reverseDigitOrder_ ? right : left);
  sendByte(reverseDigitOrder_ ? left : right);
  digitalWrite(latchPin_, HIGH);
  delayMicroseconds(halfPeriodUs_);
  digitalWrite(latchPin_, LOW);
}

void LonelyBinaryDisplay::refresh() {
  writeDigits(leftPattern_, rightPattern_);
}

void LonelyBinaryDisplay::clear() {
  writeDigits(0x00, 0x00);
}

void LonelyBinaryDisplay::showAllSegments() {
  writeDigits(0xFF, 0xFF);
}

void LonelyBinaryDisplay::showDigits(int leftDigit, int rightDigit) {
  writeDigits(leftDigit >= 0 && leftDigit <= 9 ? kDigits[leftDigit] : 0x00,
              rightDigit >= 0 && rightDigit <= 9 ? kDigits[rightDigit] : 0x00);
}

void LonelyBinaryDisplay::showNumber(int number, bool leadingZero) {
  if (number < 0) {
    clear();
    return;
  }
  if (number > 99) number = 99;
  writeDigits(number < 10 && !leadingZero ? 0x00 : kDigits[number / 10],
              kDigits[number % 10]);
}

}  // namespace CheckIt
