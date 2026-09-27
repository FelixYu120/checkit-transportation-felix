#pragma once

// Copy this file to CheckItSecrets.h in the same directory. The copied file
// is ignored by Git. Use a 2.4 GHz network with a fixed channel, then set
// CHECKIT_ESPNOW_CHANNEL in CheckItConfig.h to that same channel before
// building both the radar and flashing nodes.
#define CHECKIT_WIFI_SSID "YOUR_2_4_GHZ_WIFI_NAME"
#define CHECKIT_WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Find the project URL under Supabase -> Integrations -> Data API.
#define CHECKIT_SUPABASE_URL "https://YOUR_PROJECT_REF.supabase.co"

// Use a low-privilege sb_publishable_... key. A legacy anon JWT also works.
// Never put an sb_secret_... or service_role key in device firmware.
#define CHECKIT_SUPABASE_PUBLISHABLE_KEY "YOUR_SUPABASE_PUBLISHABLE_KEY"

// Give every physical radar a stable identifier. Use only letters, numbers,
// underscore, and hyphen so logs and database queries stay easy to read.
#define CHECKIT_SENSOR_ID "radar-001"

// Only the ld2415h_reference firmware uses these values. Register this exact
// reference ID in public.reference_sensors before enabling cloud upload. The
// primary ID must be the LD2451 sensor installation it is checking.
#define CHECKIT_REFERENCE_SENSOR_ID "radar-001-ld2415h"
#define CHECKIT_REFERENCE_PRIMARY_SENSOR_ID CHECKIT_SENSOR_ID

// Optional controlled-test label such as "test-2026-08-19-001". Leave empty
// during ordinary production collection.
#define CHECKIT_REFERENCE_TEST_RUN_ID ""

// BLE setup is available only before configuration is committed. The CheckIt
// logistics app displays a six-digit Radar Password field and sends this value
// through Espressif Security 1. Change it for your fleet.
#define CHECKIT_BLE_SETUP_PIN 734291UL

// This value reopens BLE setup after provisioning. Use at least 16 random
// characters, store it in your password manager, and never commit the real
// value. It can also be entered during BLE setup as admin_reset_token.
#define CHECKIT_ADMIN_RESET_TOKEN "CHANGE_ME_TO_A_LONG_RANDOM_ADMIN_TOKEN"

// Friendly installation name shown in health reports.
#define CHECKIT_DEVICE_NAME "Pepper Canyon Radar 1"
