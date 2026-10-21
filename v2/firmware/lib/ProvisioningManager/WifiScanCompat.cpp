#include <WiFi.h>

// Arduino-ESP32 2.0.17 consumes every WIFI_SCAN_DONE result, including scans
// started by ESP-IDF's provisioning manager. esp_wifi_scan_get_ap_records()
// frees that shared result list, so provisioning can incorrectly report zero
// networks. Match the ownership guard in newer Arduino cores without editing
// the machine's framework package. The connected environments link --wrap for
// WiFiScanClass::_scanDone(); Arduino's own scans still use the original code.
extern "C" void __real__ZN13WiFiScanClass9_scanDoneEv();

extern "C" void __wrap__ZN13WiFiScanClass9_scanDoneEv() {
  if (WiFiGenericClass::getStatusBits() & WIFI_SCANNING_BIT) {
    __real__ZN13WiFiScanClass9_scanDoneEv();
  }
}
