#include "ProvisioningManager.h"

#include <cJSON.h>
#include <esp_system.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <wifi_provisioning/manager.h>
#include <wifi_provisioning/scheme_ble.h>

namespace CheckIt {
namespace {

constexpr char kPreferencesNamespace[] = "checkit-prov";
constexpr char kSettingsKey[] = "settings";
constexpr char kChecksumKey[] = "crc";
constexpr char kOperatingModeKey[] = "mode";
constexpr char kProvisionedKey[] = "provisioned";
constexpr char kForceSetupKey[] = "force-setup";
constexpr uint32_t kRestartDelayMs = 1200UL;
constexpr char kConfigEndpoint[] = "checkit-config";
constexpr uint8_t kProvisioningServiceUuid[16] = {
    0xC1, 0x7A, 0x50, 0x52, 0x4F, 0x56, 0x49, 0x53,
    0x49, 0x4F, 0x4E, 0x01, 0x00, 0x00, 0x00, 0x01};

ProvisioningManager *activeManager = nullptr;

bool setResponse(
    const char *message,
    uint8_t **output,
    ssize_t *outputLength) {
  if (message == nullptr || output == nullptr || outputLength == nullptr) {
    return false;
  }
  const size_t length = strlen(message);
  uint8_t *buffer = static_cast<uint8_t *>(malloc(length));
  if (buffer == nullptr) {
    return false;
  }
  memcpy(buffer, message, length);
  *output = buffer;
  *outputLength = static_cast<ssize_t>(length);
  return true;
}

const cJSON *jsonItem(const cJSON *object, const char *name) {
  return object == nullptr
      ? nullptr
      : cJSON_GetObjectItemCaseSensitive(object, name);
}

bool readString(
    const cJSON *object,
    const char *name,
    char *destination,
    size_t capacity) {
  const cJSON *item = jsonItem(object, name);
  if (!cJSON_IsString(item) || item->valuestring == nullptr) {
    return false;
  }
  const size_t length = strlen(item->valuestring);
  if (length >= capacity) {
    return false;
  }
  memcpy(destination, item->valuestring, length + 1U);
  return true;
}

bool readNumber(
    const cJSON *object,
    const char *name,
    double minimum,
    double maximum,
    double &value) {
  const cJSON *item = jsonItem(object, name);
  if (!cJSON_IsNumber(item) || !isfinite(item->valuedouble) ||
      item->valuedouble < minimum || item->valuedouble > maximum) {
    return false;
  }
  value = item->valuedouble;
  return true;
}

}  // namespace

ProvisioningManager::ProvisioningManager()
    : preferences_(),
      settings_{},
      draftSettings_{},
      operatingMode_(OperatingMode::RADAR_WARNING),
      draftOperatingMode_(OperatingMode::RADAR_WARNING),
      state_{},
      eventHandlerId_(0),
      restartAtMs_(0),
      managerInitialized_(false),
      endpointRegistered_(false),
      customConfigReceived_(false),
      wifiCredentialsReceived_(false),
      wifiProvisioned_(false),
      setupPop_{} {}

bool ProvisioningManager::configuredValue(const char *value) {
  return value != nullptr && value[0] != '\0' &&
      strstr(value, "YOUR_") == nullptr &&
      strstr(value, "CHANGE_ME") == nullptr;
}

bool ProvisioningManager::safeSensorId(const char *value) {
  if (!configuredValue(value)) {
    return false;
  }
  for (const char *cursor = value; *cursor != '\0'; ++cursor) {
    const char c = *cursor;
    const bool safe =
        (c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') || c == '-' || c == '_';
    if (!safe) {
      return false;
    }
  }
  return true;
}

bool ProvisioningManager::copyValue(
    char *destination,
    size_t capacity,
    const String &value) {
  if (destination == nullptr || capacity == 0 ||
      value.length() >= capacity) {
    return false;
  }
  memcpy(destination, value.c_str(), value.length() + 1U);
  return true;
}

bool ProvisioningManager::constantTimeEqual(
    const char *left,
    const char *right) {
  if (left == nullptr || right == nullptr) {
    return false;
  }
  const size_t leftLength = strlen(left);
  const size_t rightLength = strlen(right);
  const size_t maximum = leftLength > rightLength ? leftLength : rightLength;
  uint8_t difference = static_cast<uint8_t>(leftLength ^ rightLength);
  for (size_t i = 0; i < maximum; ++i) {
    const uint8_t leftByte = i < leftLength
        ? static_cast<uint8_t>(left[i])
        : 0;
    const uint8_t rightByte = i < rightLength
        ? static_cast<uint8_t>(right[i])
        : 0;
    difference |= leftByte ^ rightByte;
  }
  return difference == 0;
}

uint32_t ProvisioningManager::checksum(
    const ProvisioningSettings &settings) const {
  const uint8_t *data = reinterpret_cast<const uint8_t *>(&settings);
  uint32_t crc = 0xFFFFFFFFUL;
  for (size_t i = 0; i < sizeof(settings); ++i) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8; ++bit) {
      const uint32_t mask = static_cast<uint32_t>(
          -static_cast<int32_t>(crc & 1U));
      crc = (crc >> 1U) ^ (0xEDB88320UL & mask);
    }
  }
  return ~crc;
}

bool ProvisioningManager::validate(
    const ProvisioningSettings &settings,
    String &error) {
  return validateForStage(settings, true, error);
}

bool ProvisioningManager::validateForStage(
    const ProvisioningSettings &settings,
    bool requireWifiCredentials,
    String &error) {
  if (!configuredValue(settings.deviceName)) {
    error = F("device_name is required");
    return false;
  }
  if (!safeSensorId(settings.sensorId)) {
    error = F("sensor_id must use letters, numbers, '-' or '_'");
    return false;
  }
  if (requireWifiCredentials && !configuredValue(settings.wifiSsid)) {
    error = F("wifi_ssid is required");
    return false;
  }
  if (!configuredValue(settings.supabaseUrl) ||
      strncmp(settings.supabaseUrl, "https://", 8) != 0) {
    error = F("supabase_url must begin with https://");
    return false;
  }
  if (!configuredValue(settings.supabaseKey) ||
      (strncmp(settings.supabaseKey, "sb_publishable_", 15) != 0 &&
       strncmp(settings.supabaseKey, "eyJ", 3) != 0)) {
    error = F("supabase_key must be publishable or legacy anon");
    return false;
  }
  if (strlen(settings.adminResetToken) < 16 ||
      !configuredValue(settings.adminResetToken)) {
    error = F("admin_reset_token must contain at least 16 characters");
    return false;
  }
  if (settings.speedLimitKmh < 1 ||
      settings.dangerSpeedKmh < settings.speedLimitKmh ||
      settings.emergencySpeedKmh < settings.dangerSpeedKmh) {
    error = F("speed thresholds must increase: limit <= danger <= emergency");
    return false;
  }
  if (!isfinite(settings.latitude) || settings.latitude < -90.0 ||
      settings.latitude > 90.0 || !isfinite(settings.longitude) ||
      settings.longitude < -180.0 || settings.longitude > 180.0 ||
      !isfinite(settings.radarHeadingDeg) ||
      settings.radarHeadingDeg < 0.0f ||
      settings.radarHeadingDeg >= 360.0f) {
    error = F("location or radar_heading_deg is outside its valid range");
    return false;
  }
  error = "";
  return true;
}

bool ProvisioningManager::loadStored() {
  if (!preferences_.getBool(kProvisionedKey, false) ||
      preferences_.getBytesLength(kSettingsKey) != sizeof(settings_)) {
    return false;
  }
  ProvisioningSettings loaded{};
  if (preferences_.getBytes(
          kSettingsKey,
          &loaded,
          sizeof(loaded)) != sizeof(loaded) ||
      preferences_.getULong(kChecksumKey, 0) != checksum(loaded)) {
    Serial.println("[SETUP] stored configuration checksum failed");
    return false;
  }
  String error;
  if (!validate(loaded, error)) {
    Serial.printf("[SETUP] stored configuration invalid: %s\n", error.c_str());
    return false;
  }
  settings_ = loaded;
  if (preferences_.isKey(kOperatingModeKey)) {
    const OperatingMode storedMode = static_cast<OperatingMode>(
        preferences_.getUChar(
            kOperatingModeKey,
            static_cast<uint8_t>(OperatingMode::RADAR_WARNING)));
    if (!operatingModeIsPersistable(storedMode)) {
      Serial.println("[SETUP] stored operating mode is invalid");
      return false;
    }
    operatingMode_ = storedMode;
  } else if (loaded.speedLimitKmh == 240 &&
             loaded.dangerSpeedKmh == 240 &&
             loaded.emergencySpeedKmh == 240) {
    operatingMode_ = OperatingMode::ROADSIDE_OBSERVATION;
  } else {
    // Configurations created before explicit modes keep their original
    // distance-based local/remote warning behavior until reprovisioned.
    operatingMode_ = OperatingMode::LEGACY_DISTANCE_ROUTED_WARNING;
  }
  state_.provisioned = true;
  return true;
}

bool ProvisioningManager::saveStored() {
  String error;
  if (!validate(settings_, error)) {
    Serial.printf("[SETUP] configuration rejected: %s\n", error.c_str());
    return false;
  }
  if (preferences_.putBytes(
          kSettingsKey,
          &settings_,
          sizeof(settings_)) != sizeof(settings_) ||
      preferences_.putULong(kChecksumKey, checksum(settings_)) !=
          sizeof(uint32_t) ||
      preferences_.putUChar(
          kOperatingModeKey,
          static_cast<uint8_t>(operatingMode_)) != sizeof(uint8_t) ||
      preferences_.putBool(kProvisionedKey, true) != sizeof(uint8_t) ||
      preferences_.putBool(kForceSetupKey, false) != sizeof(uint8_t)) {
    Serial.println("[SETUP] could not persist configuration");
    return false;
  }
  state_.provisioned = true;
  return true;
}

bool ProvisioningManager::clearStoredForSetup() {
  const bool operatingModeCleared =
      !preferences_.isKey(kOperatingModeKey) ||
      preferences_.remove(kOperatingModeKey);
  const bool cleared = preferences_.remove(kSettingsKey) &&
      preferences_.remove(kChecksumKey) &&
      operatingModeCleared &&
      preferences_.putBool(kProvisionedKey, false) == sizeof(uint8_t) &&
      preferences_.putBool(kForceSetupKey, true) == sizeof(uint8_t);
  return cleared;
}

bool ProvisioningManager::startBle(uint32_t setupPin) {
  if (setupPin < 100000UL || setupPin > 999999UL) {
    Serial.println("[SETUP] BLE disabled: setup PIN must be six digits");
    return false;
  }

  const uint64_t chipId = ESP.getEfuseMac();
  char advertisedName[28]{};
  snprintf(
      advertisedName,
      sizeof(advertisedName),
      "CheckIt-Setup-%08lX",
      static_cast<unsigned long>(chipId & 0xFFFFFFFFULL));

  snprintf(setupPop_, sizeof(setupPop_), "%06lu",
      static_cast<unsigned long>(setupPin));
  draftSettings_ = settings_;
  draftOperatingMode_ = operatingMode_;
  customConfigReceived_ = false;
  wifiCredentialsReceived_ = false;
  wifiProvisioned_ = false;

  WiFi.mode(WIFI_STA);
  wifi_prov_mgr_config_t managerConfig{};
  managerConfig.scheme = wifi_prov_scheme_ble;
  const wifi_prov_event_handler_t schemeHandler =
      WIFI_PROV_SCHEME_BLE_EVENT_HANDLER_FREE_BTDM;
  memcpy(
      &managerConfig.scheme_event_handler,
      &schemeHandler,
      sizeof(schemeHandler));
  managerConfig.app_event_handler.event_cb = nullptr;
  managerConfig.app_event_handler.user_data = nullptr;

  if (wifi_prov_mgr_init(managerConfig) != ESP_OK) {
    Serial.println("[SETUP] provisioning manager initialization failed");
    return false;
  }
  managerInitialized_ = true;
  activeManager = this;
  eventHandlerId_ = WiFi.onEvent(onArduinoEvent);

  uint8_t serviceUuid[sizeof(kProvisioningServiceUuid)]{};
  memcpy(serviceUuid, kProvisioningServiceUuid, sizeof(serviceUuid));
  if (wifi_prov_scheme_ble_set_service_uuid(serviceUuid) != ESP_OK ||
      wifi_prov_mgr_disable_auto_stop(1000) != ESP_OK ||
      wifi_prov_mgr_endpoint_create(kConfigEndpoint) != ESP_OK ||
      wifi_prov_mgr_start_provisioning(
          WIFI_PROV_SECURITY_1,
          setupPop_,
          advertisedName,
          nullptr) != ESP_OK ||
      wifi_prov_mgr_endpoint_register(
          kConfigEndpoint,
          onConfigEndpoint,
          this) != ESP_OK) {
    Serial.println("[SETUP] secure BLE provisioning startup failed");
    stopBle();
    return false;
  }
  endpointRegistered_ = true;

  state_.bleActive = true;
  Serial.printf(
      "[SETUP] BLE provisioning active as %s; Security 1 password required\n",
      advertisedName);
  return true;
}

bool ProvisioningManager::begin(
    const ProvisioningSettings &compiledDefaults,
    uint32_t setupPin) {
  settings_ = compiledDefaults;
  if (!preferences_.begin(kPreferencesNamespace, false)) {
    Serial.println("[SETUP] Preferences initialization failed");
    return false;
  }

  const bool forceSetup = preferences_.getBool(kForceSetupKey, false);
  if (!forceSetup && loadStored()) {
    Serial.printf(
        "[SETUP] locked configuration loaded sensor=%s name=%s\n",
        settings_.sensorId,
        settings_.deviceName);
    return true;
  }

  if (forceSetup) {
    // An authenticated reset must not silently reactivate compiled cloud
    // credentials. Retain operating defaults and the local-only recovery
    // token; the installer never receives or transmits that token.
    settings_ = ProvisioningSettings{};
    copyValue(
        settings_.deviceName,
        sizeof(settings_.deviceName),
        String(compiledDefaults.deviceName));
    copyValue(
        settings_.adminResetToken,
        sizeof(settings_.adminResetToken),
        String(compiledDefaults.adminResetToken));
    settings_.speedLimitKmh = compiledDefaults.speedLimitKmh;
    settings_.dangerSpeedKmh = compiledDefaults.dangerSpeedKmh;
    settings_.emergencySpeedKmh = compiledDefaults.emergencySpeedKmh;
    settings_.radarHeadingDeg = compiledDefaults.radarHeadingDeg;
    operatingMode_ = OperatingMode::RADAR_WARNING;
  } else {
    Serial.println(
        "[SETUP] no committed configuration; compiled values loaded as "
        "an editable BLE draft");
  }

  state_.provisioned = false;
  return startBle(setupPin);
}

const ProvisioningSettings &ProvisioningManager::settings() const {
  return settings_;
}

OperatingMode ProvisioningManager::operatingMode() const {
  return operatingMode_;
}

ProvisioningState ProvisioningManager::state() const {
  return state_;
}

bool ProvisioningManager::provisioned() const {
  return state_.provisioned;
}

bool ProvisioningManager::bleActive() const {
  return state_.bleActive;
}

bool ProvisioningManager::adminTokenMatches(
    const String &candidate) const {
  return state_.provisioned && strlen(settings_.adminResetToken) >= 16 &&
      constantTimeEqual(settings_.adminResetToken, candidate.c_str());
}

bool ProvisioningManager::requestSetupReset(uint32_t nowMs) {
  if (!state_.provisioned || !clearStoredForSetup()) {
    return false;
  }
  restartAtMs_ = nowMs + kRestartDelayMs;
  state_.restartPending = true;
  Serial.println(
      "[SETUP] authenticated reset accepted; restarting into BLE setup mode");
  return true;
}

bool ProvisioningManager::parseConfigPayload(
    const uint8_t *input,
    size_t inputLength,
    ProvisioningSettings &parsed,
    OperatingMode &parsedOperatingMode) const {
  cJSON *root = cJSON_ParseWithLength(
      reinterpret_cast<const char *>(input),
      inputLength);
  if (root == nullptr || !cJSON_IsObject(root)) {
    cJSON_Delete(root);
    return false;
  }

  ProvisioningSettings candidate = draftSettings_;
  double schemaVersion = 0.0;
  double speedLimit = 0.0;
  double dangerSpeed = 0.0;
  double emergencySpeed = 0.0;
  double latitude = 0.0;
  double longitude = 0.0;
  double heading = 0.0;
  char operatingModeValue[32]{};
  bool valid =
      readNumber(root, "schemaVersion", 1.0, 2.0, schemaVersion) &&
      readString(
          root,
          "deviceName",
          candidate.deviceName,
          sizeof(candidate.deviceName)) &&
      readString(
          root,
          "sensorId",
          candidate.sensorId,
          sizeof(candidate.sensorId)) &&
      readString(
          root,
          "supabaseUrl",
          candidate.supabaseUrl,
          sizeof(candidate.supabaseUrl)) &&
      readString(
          root,
          "supabaseKey",
          candidate.supabaseKey,
          sizeof(candidate.supabaseKey)) &&
      readNumber(root, "speedLimitKmh", 1.0, 240.0, speedLimit) &&
      readNumber(root, "dangerSpeedKmh", 1.0, 240.0, dangerSpeed) &&
      readNumber(root, "emergencySpeedKmh", 1.0, 240.0, emergencySpeed) &&
      readNumber(root, "latitude", -90.0, 90.0, latitude) &&
      readNumber(root, "longitude", -180.0, 180.0, longitude) &&
      readNumber(root, "headingDegrees", 0.0, 359.999, heading);

  valid = valid && floor(schemaVersion) == schemaVersion &&
      floor(speedLimit) == speedLimit &&
      floor(dangerSpeed) == dangerSpeed &&
      floor(emergencySpeed) == emergencySpeed;
  OperatingMode candidateMode = draftOperatingMode_;
  if (valid && static_cast<uint8_t>(schemaVersion) == 2U) {
    valid = readString(
        root,
        "operatingMode",
        operatingModeValue,
        sizeof(operatingModeValue)) &&
        parseOperatingMode(operatingModeValue, candidateMode);
  } else if (valid) {
    candidateMode =
        speedLimit == 240.0 && dangerSpeed == 240.0 &&
            emergencySpeed == 240.0
        ? OperatingMode::ROADSIDE_OBSERVATION
        : OperatingMode::LEGACY_DISTANCE_ROUTED_WARNING;
  }
  if (valid) {
    candidate.speedLimitKmh = static_cast<uint8_t>(speedLimit);
    candidate.dangerSpeedKmh = static_cast<uint8_t>(dangerSpeed);
    candidate.emergencySpeedKmh = static_cast<uint8_t>(emergencySpeed);
    candidate.latitude = latitude;
    candidate.longitude = longitude;
    candidate.radarHeadingDeg = static_cast<float>(heading);
    String error;
    // Espressif sends Wi-Fi credentials after this protected custom payload.
    // Validate those credentials only when the complete record is committed.
    valid = validateForStage(candidate, false, error);
    if (!valid) {
      Serial.printf("[SETUP] protected configuration invalid: %s\n", error.c_str());
    }
  }

  if (valid) {
    parsed = candidate;
    parsedOperatingMode = candidateMode;
  }
  cJSON_Delete(root);
  return valid;
}

bool ProvisioningManager::commitIfReady() {
  if (!customConfigReceived_ || !wifiCredentialsReceived_ ||
      !wifiProvisioned_ || state_.restartPending) {
    return false;
  }
  settings_ = draftSettings_;
  operatingMode_ = draftOperatingMode_;
  if (!saveStored()) {
    return false;
  }
  restartAtMs_ = millis() + kRestartDelayMs;
  state_.restartPending = true;
  Serial.println("[SETUP] secure configuration committed; restarting");
  return true;
}

void ProvisioningManager::onArduinoEvent(arduino_event_t *event) {
  if (activeManager != nullptr && event != nullptr) {
    activeManager->handleArduinoEvent(*event);
  }
}

void ProvisioningManager::handleArduinoEvent(
    const arduino_event_t &event) {
  switch (event.event_id) {
    case ARDUINO_EVENT_PROV_CRED_RECV:
      copyValue(
          draftSettings_.wifiSsid,
          sizeof(draftSettings_.wifiSsid),
          String(reinterpret_cast<const char *>(
              event.event_info.prov_cred_recv.ssid)));
      copyValue(
          draftSettings_.wifiPassword,
          sizeof(draftSettings_.wifiPassword),
          String(reinterpret_cast<const char *>(
              event.event_info.prov_cred_recv.password)));
      wifiCredentialsReceived_ = true;
      break;
    case ARDUINO_EVENT_PROV_CRED_SUCCESS:
      wifiProvisioned_ = true;
      commitIfReady();
      break;
    case ARDUINO_EVENT_PROV_CRED_FAIL:
      wifiProvisioned_ = false;
      break;
    case ARDUINO_EVENT_PROV_END:
      state_.bleActive = false;
      break;
    default:
      break;
  }
}

esp_err_t ProvisioningManager::onConfigEndpoint(
    uint32_t,
    const uint8_t *input,
    ssize_t inputLength,
    uint8_t **output,
    ssize_t *outputLength,
    void *context) {
  auto *manager = static_cast<ProvisioningManager *>(context);
  if (manager == nullptr || input == nullptr || inputLength <= 0) {
    setResponse(
        "{\"ok\":false,\"error\":\"invalid_request\"}",
        output,
        outputLength);
    return ESP_ERR_INVALID_ARG;
  }

  ProvisioningSettings parsed{};
  OperatingMode parsedOperatingMode = OperatingMode::RADAR_WARNING;
  if (!manager->parseConfigPayload(
          input,
          static_cast<size_t>(inputLength),
          parsed,
          parsedOperatingMode)) {
    setResponse(
        "{\"ok\":false,\"error\":\"invalid_config\"}",
        output,
        outputLength);
    return ESP_ERR_INVALID_ARG;
  }
  manager->draftSettings_ = parsed;
  manager->draftOperatingMode_ = parsedOperatingMode;
  manager->customConfigReceived_ = true;
  const bool committed = manager->commitIfReady();
  const char *response = committed
      ? "{\"ok\":true,\"state\":\"saved\"}"
      : "{\"ok\":true,\"state\":\"awaiting_network\"}";
  if (!setResponse(response, output, outputLength)) {
    return ESP_ERR_NO_MEM;
  }
  return ESP_OK;
}

void ProvisioningManager::stopBle() {
  state_.bleActive = false;
  if (endpointRegistered_) {
    wifi_prov_mgr_endpoint_unregister(kConfigEndpoint);
    endpointRegistered_ = false;
  }
  if (managerInitialized_) {
    wifi_prov_mgr_stop_provisioning();
    wifi_prov_mgr_deinit();
    managerInitialized_ = false;
  }
  if (eventHandlerId_ != 0) {
    WiFi.removeEvent(eventHandlerId_);
    eventHandlerId_ = 0;
  }
  if (activeManager == this) {
    activeManager = nullptr;
  }
}

void ProvisioningManager::update(uint32_t nowMs) {
  if (state_.restartPending &&
      static_cast<int32_t>(nowMs - restartAtMs_) >= 0) {
    if (state_.bleActive) {
      stopBle();
    }
    ESP.restart();
  }
}

}  // namespace CheckIt
