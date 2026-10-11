# V2 firmware

This directory contains the restored ESP32-S3 / LILYGO T-SIM7080-S3 and
HLK-LD2451 firmware. PlatformIO targets are defined in `platformio.ini`.

Copy `include/CheckItSecrets.example.h` to the ignored
`include/CheckItSecrets.h` for local builds, then provide the required local
values. Never commit device credentials or permanent R2 credentials.

The radar node uses one firmware image for all deployments. Secure BLE setup
stores one of these operating modes:

- `roadside_observation`: counting, storage, and cloud upload only; warning
  outputs and ESP-NOW are disabled, and infrastructure Wi-Fi may use any
  channel.
- `radar_warning`: warnings use the radar's local matrix/speaker; ESP-NOW is
  disabled, and infrastructure Wi-Fi may use any channel.
- `flashing_warning`: warnings are sent to the flashing node over ESP-NOW;
  infrastructure Wi-Fi must share `CHECKIT_ESPNOW_CHANNEL`. If the remote node
  does not acknowledge an alert, the radar uses its local output as a fallback.

Existing provisioned devices without an explicit stored mode retain their old
distance-routed warning behavior until they are reprovisioned.

Build and test from this directory:

```sh
pio run -e radar_node
pio run -e flash_node
pio test -e native
```
