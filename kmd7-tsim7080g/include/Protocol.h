#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace kmd7 {
inline uint16_t u16(const uint8_t* p) {
  return uint16_t(p[0]) | (uint16_t(p[1]) << 8);
}
inline int32_t s16(const uint8_t* p) {
  const uint16_t n = u16(p);
  return n & 0x8000 ? int32_t(n) - 65536 : n;
}
inline uint32_t u32(const uint8_t* p) {
  return uint32_t(p[0]) | (uint32_t(p[1]) << 8) |
         (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
}
struct Target {
  float distanceM, speedKmh, angleDeg, magnitudeDb;
  uint8_t id;
};
inline Target target(const uint8_t* p) {
  return {u16(p) / 100.0f, s16(p + 2) / 100.0f,
          s16(p + 4) / 100.0f, u16(p + 6) / 100.0f, p[8]};
}
// Only messages requested by this bench reader are accepted. Bytewise
// resynchronization prevents noise/oversized lengths from overrunning memory.
class Parser {
  uint8_t bytes[80] = {};
  size_t used = 0;
 public:
  void reset() { used = 0; }
  template <typename Handler> void feed(uint8_t byte, Handler handle) {
    bytes[used++] = byte;
    while (used >= 8) {
      uint32_t n = u32(bytes + 4);
      bool valid = (!memcmp(bytes, "RESP", 4) && n == 1) ||
                   (!memcmp(bytes, "VERS", 4) && n == 19) ||
                   (!memcmp(bytes, "DONE", 4) && n == 4) ||
                   (!memcmp(bytes, "TDAT", 4) && n <= 72 && n % 9 == 0);
      if (!valid) {
        memmove(bytes, bytes + 1, --used);
        continue;
      }
      if (used < n + 8) return;
      handle(bytes, bytes + 8, n);
      used = 0;
    }
  }
};
}
