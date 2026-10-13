#pragma once
#include <stdint.h>
#include <cstdio>
#include <cstdarg>
#include <string>
#define LOW 0
#define HIGH 1
#define OUTPUT 1
uint32_t millis();
void pinMode(int pin, int mode);
void digitalWrite(int pin, int value);
void delayMicroseconds(unsigned int us);
struct FakeSerial {
  int pending = -1;
  std::string logs;
  bool connected = true;
  explicit operator bool() const { return connected; }
  int available() { return pending >= 0; }
  int read() { int value = pending; pending = -1; return value; }
  void println(const char *text) { logs += text; logs += "\n"; }
  int printf(const char *format, ...) {
    char buffer[512]; va_list args; va_start(args, format);
    int size = vsnprintf(buffer, sizeof(buffer), format, args); va_end(args);
    logs += buffer; return size;
  }
};
extern FakeSerial Serial;
