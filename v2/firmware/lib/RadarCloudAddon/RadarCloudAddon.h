#pragma once
#include <Arduino.h>
namespace CheckIt { namespace RadarCloudAddon {
void begin();
void connect();
void update(uint32_t nowMs);
String statusJson();
bool uploadNow();
bool resetSetup(const String &token);
} }
