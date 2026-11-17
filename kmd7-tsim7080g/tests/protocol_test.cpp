#include "Protocol.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <vector>

int main() {
  kmd7::Parser parser;
  unsigned packets = 0;
  auto handler = [&](const uint8_t* tag, const uint8_t* p, uint32_t n) {
    ++packets;
    if (!memcmp(tag, "TDAT", 4) && n == 9) {
      auto t = kmd7::target(p);
      assert(fabs(t.distanceM - 112.5f) < 0.001f);
      assert(fabs(t.speedKmh + 1.05f) < 0.001f);
      assert(fabs(t.angleDeg - 18.39f) < 0.001f);
      assert(t.id == 23);
    }
  };
  // RFbeam datasheet p17 sample, fed as fragmented UART bytes.
  const uint8_t sample[] = {'T','D','A','T',9,0,0,0,
    0xf2,0x2b,0x97,0xff,0x2f,0x07,0x15,0x18,0x17};
  const uint8_t noise[] = {0xff,0,'T','D','A','T',0xff,0xff,0xff,0xff};
  for (auto b : noise) parser.feed(b, handler);
  for (auto b : sample) parser.feed(b, handler);
  assert(packets == 1);
  const uint8_t empty[] = {'T','D','A','T',0,0,0,0};
  for (auto b : empty) parser.feed(b, handler);
  assert(packets == 2);
  // A partial frame can be discarded on an inter-byte timeout.
  for (unsigned i = 0; i < 10; ++i) parser.feed(sample[i], handler);
  parser.reset();
  for (auto b : sample) parser.feed(b, handler);
  assert(packets == 3);
  // Reject malformed target lengths and accept the maximum eight-target packet.
  const uint8_t bad[] = {'T','D','A','T',10,0,0,0};
  for (auto b : bad) parser.feed(b, handler);
  std::vector<uint8_t> maxFrame = {'T','D','A','T',72,0,0,0};
  maxFrame.resize(80, 0);
  for (auto b : maxFrame) parser.feed(b, handler);
  assert(packets == 4);
  const uint8_t negative[] = {0, 0x80};
  assert(kmd7::s16(negative) == -32768);
  puts("K-MD7 decoder tests passed");
}
