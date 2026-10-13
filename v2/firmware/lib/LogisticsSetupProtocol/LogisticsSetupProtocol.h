#pragma once
#include <stddef.h>
#include <stdint.h>
namespace CheckIt {
enum SetupField { DEVICE_NAME, SENSOR_ID, WIFI_SSID, WIFI_PASSWORD, SUPABASE_URL,
 SUPABASE_KEY, SPEED_LIMIT, DANGER_SPEED, EMERGENCY_SPEED, LATITUDE, LONGITUDE, HEADING, SETUP_FIELD_COUNT };
struct SetupCommand { bool commit; SetupField field; char value[320]; double number; };
const char *setupFieldName(SetupField field);
bool parseSetupCommand(const char *data, size_t size, SetupCommand &out);
}
