#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_err.h>
#include <stdint.h>
#include <sys/types.h>

#include "OperatingMode.h"

namespace CheckIt {

constexpr size_t kProvisioningDeviceNameLength = 32;
constexpr size_t kProvisioningSensorIdLength = 48;
constexpr size_t kProvisioningWifiSsidLength = 33;
constexpr size_t kProvisioningWifiPasswordLength = 65;
constexpr size_t kProvisioningSupabaseUrlLength = 160;
constexpr size_t kProvisioningSupabaseKeyLength = 320;
constexpr size_t kProvisioningAdminTokenLength = 96;

struct ProvisioningSettings {
  char deviceName[kProvisioningDeviceNameLength];
  char sensorId[kProvisioningSensorIdLength];
  char wifiSsid[kProvisioningWifiSsidLength];
  char wifiPassword[kProvisioningWifiPasswordLength];
  char supabaseUrl[kProvisioningSupabaseUrlLength];
  char supabaseKey[kProvisioningSupabaseKeyLength];
  char adminResetToken[kProvisioningAdminTokenLength];
  uint8_t speedLimitKmh;
  uint8_t dangerSpeedKmh;
  uint8_t emergencySpeedKmh;
  double latitude;
  double longitude;
  float radarHeadingDeg;
};

struct ProvisioningState {
  bool provisioned;
  bool bleActive;
  bool restartPending;
};

// Persistent first-run provisioning over Espressif Security 1. The installer
// supplies the six-digit proof of possession in its own visible UI; BLE is not
// initialized after a committed configuration loads.
class ProvisioningManager {
 public:
  ProvisioningManager();

  bool begin(
      const ProvisioningSettings &compiledDefaults,
      uint32_t setupPin, bool useEspressifBle = true);
  // Called only by the authenticated logistics setup transport.
  bool commitSettings(const ProvisioningSettings &settings);
  void update(uint32_t nowMs);

  const ProvisioningSettings &settings() const;
  OperatingMode operatingMode() const;
  ProvisioningState state() const;
  bool provisioned() const;
  bool bleActive() const;

  bool adminTokenMatches(const String &candidate) const;
  bool requestSetupReset(uint32_t nowMs);

  static bool validate(
      const ProvisioningSettings &settings,
      String &error);

 private:
  bool loadStored();
  bool saveStored();
  bool clearStoredForSetup();
  bool startBle(uint32_t setupPin);
  void stopBle();
  bool parseConfigPayload(
      const uint8_t *input,
      size_t inputLength,
      ProvisioningSettings &parsed,
      OperatingMode &parsedOperatingMode) const;
  bool commitIfReady();
  void handleArduinoEvent(const arduino_event_t &event);
  static void onArduinoEvent(arduino_event_t *event);
  static esp_err_t onConfigEndpoint(
      uint32_t sessionId,
      const uint8_t *input,
      ssize_t inputLength,
      uint8_t **output,
      ssize_t *outputLength,
      void *context);
  uint32_t checksum(const ProvisioningSettings &settings) const;
  static bool validateForStage(
      const ProvisioningSettings &settings,
      bool requireWifiCredentials,
      String &error);
  static bool configuredValue(const char *value);
  static bool safeSensorId(const char *value);
  static bool copyValue(
      char *destination,
      size_t capacity,
      const String &value);
  static bool constantTimeEqual(const char *left, const char *right);

  Preferences preferences_;
  ProvisioningSettings settings_;
  ProvisioningSettings draftSettings_;
  OperatingMode operatingMode_;
  OperatingMode draftOperatingMode_;
  ProvisioningState state_;
  wifi_event_id_t eventHandlerId_;
  uint32_t restartAtMs_;
  bool managerInitialized_;
  bool endpointRegistered_;
  bool customConfigReceived_;
  bool wifiCredentialsReceived_;
  bool wifiProvisioned_;
  char setupPop_[7];
};

}  // namespace CheckIt
