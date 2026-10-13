# V2 firmware

This directory contains the restored ESP32-S3 / LILYGO T-SIM7080-S3 and
HLK-LD2451 firmware. PlatformIO targets are defined in `platformio.ini`.

The current default environment is `radar_connected`, so a plain `pio run`
or `pio run -t upload` keeps the decoded radar logs and serial display/test
commands, local phone dashboard, app setup and cloud upload after commissioning.
Use `-e radar_display_test` for the local-only rollback. Use an
explicit `-e radar_node` only when intentionally switching to the full firmware;
selecting an environment for `pio device monitor` does not change the image
already installed on the board.

Copy `include/CheckItSecrets.example.h` to the ignored
`include/CheckItSecrets.h` for local builds, then provide the required local
values. Never commit device credentials or permanent R2 credentials.

The radar node uses one firmware image for all deployments. Secure BLE setup
stores one of these operating modes:

- `roadside_observation`: counting, storage, and cloud upload only; warning
  outputs and ESP-NOW are disabled, and infrastructure Wi-Fi may use any
  channel.
- `radar_warning`: warnings use the radar's local sign/matrix/speaker; ESP-NOW is
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

## Radar reader with display-only addon

`radar_display_test` builds `src/ld2451_bench/main.cpp` with the optional
`CHECKIT_RADAR_DISPLAY_ADDON` enabled. UART2 remains 115200 8N1 RX16/TX17;
the byte-reading loop and quiet `[WAIT]` messages are unchanged. The addon
observes copies of received bytes and drives only display GPIO21/47/48. It
owns no UART and sends no commands to the sensor. When the addon is disabled,
`ld2451_bench` retains the original raw-only reader.

```sh
pio run -e radar_display_test -t upload --upload-port /dev/cu.usbmodem1101
pio device monitor -e radar_display_test -b 115200 --port /dev/cu.usbmodem1101
```

Addon **v15** starts in **normal automatic mode**, with both digits blank until
a reported speed at or above **8 mph** arrives. It operates on battery without a USB
monitor or command. No boot animation, startup replay or control-pin meter test runs.
Easy testing mode is enabled only by pressing `a`; it is never saved across reboot.

This image uses a display clock of approximately **1 kHz**: 500 us low and
500 us high, followed by a 500 us latch pulse. One two-digit write takes about
16.5 ms. Radar UART remains 115200 baud. The slower clock adds settling time;
secure soldered contacts and a common ground are still required. Other images
retain the driver's default 10 us half-period unless explicitly configured.

Use these USB serial commands (single keys act immediately):

| Command | Display action |
| --- | --- |
| `b` | Blank both digits immediately and pause radar alerts. |
| `8` | Hold 88 steadily; pause radar alerts. |
| `6` | Hold 66 steadily; pause radar alerts. |
| `1` | Hold 8 on near module #1; blank far #2. |
| `2` | Hold 8 on far module #2; blank near #1. |
| `n42` then Enter | Hold 42; any number 0-99 is accepted. |
| `a` | Toggle easy testing (>3 km/h) and normal automatic operation (>=8 mph). |
| `c` | Resume normal automatic operation (>=8 mph), including after a manual hold or pause. |
| `t18` then Enter | Simulate one 18 km/h radar report (11 mph); `t0` simulates empty; range 0-120 km/h. Live alerts pause until `c`. |
| `s` | Show commanded digits (-1 means blank), mode and parser/error counters. |
| `h` or `?` | Show command help. |

Speed simulation uses a separate instance of the real LD2451 parser and feeds
its decoded report through the same threshold, peak, blink and display driver
as live radar. It sends no bytes to the sensor and does not alter live parser
statistics. Each `t` command starts a fresh, blank test. Synthetic reports are
labelled `[SIM]`; `s` shows `mode=simulation` and a separate simulated-report count.
Real radar reports continue to decode/log but cannot change the test display.
After the two-second flash it stays blank until another test or `c` (live normal
mode). Reboot restores normal mode. Invalid test values stay blank.

Try `t12` (blank), `t13` (08), `t14` (09), `t18` (11), or `t22` (14), each followed
by Enter. Values are **km/h**, as received from the sensor; displayed values are
rounded **mph**. A successful visible test verifies parser-to-display operation,
but does not test radar detection, the UART wires or speed accuracy.

Manual holds last until another command or reboot, including after USB is
unplugged. Ctrl+C closes the computer's monitor; it does not stop the firmware.
Press `b` before closing the monitor if you want to pause alerts and blank the
sign. Reboot always restores normal automatic operation (>=8 mph). `b` also cancels an unfinished
number or an active radar flash. Invalid numeric input stays blank and never
enables easy testing. Mode changes cancel the active flash and require a fresh
qualifying report. Radar reports cannot replace a manual pattern. The first byte reaches far #2 (normally left), while
the second stays in near #1 (normally right); the one-digit tests check this chain.

Normal operation automatically triggers on a single decoded radar reading at or above
**8 mph**, flashing for two seconds with 300 ms on/off periods. During each
window the sign shows the **highest reported speed** seen so far, converted
to rounded whole mph. The fastest reported target in a frame can raise this
peak; slower later reports cannot lower it. A new alert starts with a fresh peak.
The threshold is compared before rounding:
12 km/h is below the limit, while 13 km/h (8.08 mph) is the first representable
over-limit reading and displays `08`; 14 km/h displays `09` and 16 km/h displays
`10`. Edit `kLimitMph` in `lib/RadarDisplayAddon/RadarDisplayAddon.cpp` to change
this image's normal threshold. Easy testing uses a separate **>3 km/h** threshold
after `a`; press `a` again or `c` to restore normal operation. Peak increases
can occur during either blink phase; they do not restart the blink or extend
its two-second deadline. The sign
has integer mph; the decoded serial log retains decimal mph.
There is no repeated-report, median-speed, target-association or 200 ms wait.
Any target in a structurally valid report meeting the speed threshold is accepted;
SNR, distance, angle and direction do not suppress the display. This also means
one-off sensor spikes can flash. A lone 22 km/h reading starts a flash of `14` mph,
even if it is followed by empty reports. Once a two-second window ends, the next
above-limit report starts another immediately: there is no one-second rearm gap.
Slow targets cannot suppress a faster target in the same report or reduce the
current window's peak. Old readings are never reused to start another window.
Manual controls still pause automatic alerts; an above-limit report while paused
prints `[SIGN SKIP] manual hold; send c to resume automatic flashes`.
These rules apply to `radar_display_test`; full firmware traffic/warning filters
are unchanged.
In normal mode, reports at 12 km/h or below are logged but do not trigger. In easy
mode, 3 km/h is still below the strict threshold; 4 km/h is the first over-limit
reading (displayed as `02` mph). Manual numbers are chosen digit
patterns, independent of radar speed or unit conversion.

Serial defaults to decoded `[RADAR]` speed, direction, range, angle and SNR, or
`[RADAR] EMPTY: valid report, no target`. `r` toggles raw hex (including empty
frames); `e` toggles decoded empty messages. Neither logging option changes the
selected control mode or stops radar decoding. `s` reports software-commanded
patterns; it cannot confirm that the physical LEDs match. `[SIGN TX]` records
automatic on/off transitions. If the digits flicker or show another pattern
while manual mode commands a steady hold or blank, investigate the electrical
signal path and power rather than treating the received radar speed as a cause.

The old `d` and `p` commands do not run startup/pin tests. The display driver
refreshes its cached pattern at 100 ms intervals; it never intentionally blinks
a manual hold. Logging options reset to decoded output with empty reports on.

Connect display DATA to GPIO21, LATCH to GPIO47 and CLOCK to GPIO48. Use 3.3V
for display logic, separate 12V LED power, 5V radar VIN, and common ground.
GPIO35-37 remain unavailable because this board uses octal PSRAM.

This image has a local Wi-Fi phone dashboard, but **no BLE, reference radar,
cloud, traffic counting, matrix or speaker**. It keeps the original radar reader
and adds the sign and local controls. `ld2451_bench` remains the original radar-only image; `radar_node`
remains the full app/cloud firmware. Uploading the test does not erase the
full firmware's saved app settings or traffic journal. Correct raw packets
must be verified on the assembled hardware before claiming detection works.

### Phone controls on battery (v15)

After uploading `radar_display_test`, the firmware starts automatically on battery
power; USB and a computer are not required. On your phone:

1. Join **CheckIt-Radar-XXXX** (the suffix identifies the board; the currently
   connected board is expected to use **5050**) with password **CheckItV2**.
2. Stay connected when the phone says this network has no internet.
3. Open **http://192.168.4.1/** in your browser.

The page shows current radar health, decoded live targets, the last detection
with its age, commanded display digits, and recent events. Expand raw bytes when
needed. "Simulate a radar speed" accepts 0–120 km/h: 12 should stay blank, 13
flashes 08, 18 flashes 11, and 22 flashes 14. Simulations use the same speed/flash
logic with a separate parser; they do not count as live radar reports.

Manual holds and simulated tests pause live radar alerts, while real radar
readings remain visible. **Tap Resume normal radar before leaving testing.**
Closing the page does not cancel a manual hold or test mode. A power cycle always
returns to normal automatic mode (at least 8 mph), with no startup flash. Phone
controls and the existing USB commands select the same modes.

The access point works without a phone hotspot or internet connection. It uses
channel 6, permits two clients, and does not connect to cloud services. Display
clock remains approximately 1 kHz; radar UART remains 115200 baud on GPIO16/17.

## Cloud + logistics app using the working radar path

Use **`radar_connected`** for the working UART reader, slow-clock display, local
phone controls, logistics-app BLE setup, and existing Supabase uploader together.
`radar_display_test` remains available as a local-only rollback. The connected
image never sends radar configuration commands or starts the reference UART,
matrix, speaker, or ESP-NOW. Both environments retain no startup flash.

```sh
pio run -e radar_connected -t upload --upload-port /dev/cu.usbmodem1101
pio device monitor -e radar_connected -b 115200 --port /dev/cu.usbmodem1101
```

On an unconfigured board, select **CheckIt-Setup-5050** (suffix varies by board)
in the logistics app's Transportation setup. Enter the six-digit PIN configured
locally in `include/CheckItSecrets.h`. The service/command/response UUIDs are
`71d10001/2/3-6e7b-4b7d-9f35-3bb4ecb1c101`; reads/writes require encrypted,
MITM-protected pairing. All twelve app `SET` fields must be acknowledged before
`COMMIT` persists settings. The response is `OK committed`; reboot follows five
seconds later. Bluetooth setup is absent after a saved configuration loads.
Existing committed settings are retained. With USB attached, uppercase `P` uses
the compiled recovery token to clear deployment configuration and reopen app
setup; `s` shows cloud status and `u` requests upload. Authenticated recovery is available
at POST `/api/admin/reset-provisioning` with the local admin token, form field
`token`, and header `X-CheckIt-Control: 1`; it preserves the passage journal.

Keep the phone on a network with internet while the app checks the sensor ID
and database prerequisites. Supply an active sensor ID and an available 2.4 GHz
Wi-Fi network/hotspot. The app supplies the Supabase project/key. Firmware accepts
publishable or legacy **anon** keys and rejects privileged keys. No credentials
are printed in setup logs or returned by the dashboard.

After reboot, app speed limits (km/h) apply inclusively to a single valid report;
the sign displays rounded mph and holds the peak for two seconds. For roughly
8 mph operation enter **13 km/h** in the app. The default before setup is 8 mph.
Easy mode is temporary, enabled with `a` or the dashboard button. Manual and
simulated tests still require Resume normal radar; simulations never feed the
cloud tracker. Traffic counting retains the existing quality/path checks, so a
sign flash does not necessarily mean an accepted vehicle count.

The local dashboard remains at http://192.168.4.1/ on CheckIt-Radar-XXXX,
password CheckItV2. Its Cloud & logistics app panel shows provisioning, Wi-Fi,
clock sync, journal availability, pending/uploaded passages, health uploads, and
HTTP status. **Upload pending data now** requests an upload; automatic passage
batches retain the existing hourly schedule and health reports use the configured
10-minute interval. Uploads use the existing verified-TLS client and tables
`traffic_passages`, `ten_minute_summaries`, and `sensor_health`.

This board has the local speed sign. App checklist items for separate flashing
nodes/ESP-NOW or matrix hardware are not implemented by `radar_connected` and
must not be marked as passed without that hardware/firmware. Database migration,
active sensor registration, real-phone pairing, and successful HTTPS upload must
be verified at commissioning; a successful build alone does not prove them.

## Integrated Lonely Binary mph sign

The normal `radar_node` image follows the logistics app's saved operating mode,
speed thresholds, Wi-Fi credentials, sensor identity and cloud configuration.
`radar_warning` drives the local Lonely Binary sign alongside the existing
matrix/speaker. `roadside_observation` leaves the sign blank.
`flashing_warning` preserves ESP-NOW routing and uses the local sign if the
remote alert cannot be queued or acknowledged. Radar/protocol/cloud/app speed
fields remain **km/h**; the two-digit sign alone displays rounded **mph**.

For indoor commissioning through the app, select **Radar Warning**, set
**Display Speed Above** to **3 km/h**, choose higher ordered danger/emergency
thresholds, and provide the phone hotspot's actual SSID/password. The sign's
first representable over-limit reading is 4 km/h, displayed as 2 mph. App
configuration does not update just by editing `CheckItSecrets.h`: existing saved
credentials/mode take precedence.

**Legacy `radar_node` logistics-app compatibility gap:** `ProvisioningManager` in this repo
exposes Espressif Security 1 and the protected `checkit-config` JSON endpoint
(schema 2). The current `/Users/himan/Desktop/logistic-app` installation flow
instead uses encrypted BLE GATT service `71d10001-6e7b-4b7d-9f35-3bb4ecb1c101`,
protected command/response characteristics, individual `SET key=value` commands,
and `COMMIT` (see `App.tsx` and `src/transportationSetupBle.ts` in that app).
Those protocols are incompatible even though both use the `CheckIt-Setup-*`
name. The current app cannot commission that legacy `radar_node` image.
Use `radar_connected`, which implements the app’s current GATT protocol.
Its manufacturing QR fallback also has a different identity/pairing/peer
contract; do not treat that as an interchangeable workaround.

`radar_display_test` contains neither app setup protocol nor cloud upload.
Its Wi-Fi is a standalone local dashboard, not logistics-app provisioning.
Changing its fixed threshold does not enable app configuration or alter the
full firmware's saved settings. The full firmware uses integer km/h thresholds;
it does not yet accept a fractional 12.874752 km/h value for exactly 8 mph.
BLE setup is off on a provisioned device. An intentional administrative setup
reset uses the existing authenticated `/api/admin/reset-provisioning` endpoint;
this removes saved deployment/network settings, preserves the passage journal,
and reopens BLE setup. Uploading the new image does not perform that reset.

The display warning filter requires three associated returns spanning at least
200 ms, SNR >=4, known direction, and the existing distance/angle gates. Successive
speed changes must be <=4 km/h; the displayed speed uses the median of the last
three returns. Association is one-to-one within each frame and resets after an
empty frame or a >500 ms gap. Warning selection favors severity, then the nearest
stable return instead of simply the fastest reflection. The normal warning
alert gate/cooldown still applies. These checks reduce short spikes; a sustained
false return can still pass and requires real radar samples to diagnose.

Warning intake accepts low speeds independently of the >=7 km/h traffic counting
cutoff. The baseline firmware leaves the LD2451's stored detection settings
alone. The app threshold controls the sign; it does not lower the sensor's
internal cutoff. Factory sensor settings can therefore exclude indoor walking.
Traffic classification, official counts, storage and upload rules are retained.
Place the sensor firmly and test toward/away from its antenna, at least 2 m away.
LD2451 is an outdoor vehicle sensor with a narrow beam; indoor people moving
sideways are not a reliable vehicle-speed calibration test.

Each local sign alert flashes for a fixed 2 seconds, 300 ms on / 300 ms off,
then blanks. Continuous movement does not extend the flash. A one-second gap
without a stable over-limit target rearms the sign. Timing is nonblocking.
`[SPEED POLICY]`, `[SPEED TARGET]`, `[SPEED DISPLAY]` and five-second `[SYSTEM]`
logs distinguish app-disabled warnings, unstable/filtered returns, no UART data,
no valid frames, and Internet status. The local `/api/status` response includes
`speed_display.units`, `active`, `value_mph` and `room_override`.
The phone dashboard also shows the speed sign, the first recent raw radar return
and why it is waiting, rejected, below limit, app-disabled or eligible. Connect
to `CheckIt-Radar-1` and visit `http://192.168.4.1` to inspect this without USB.

### Pins, power and startup

For the selected T-SIM7080G S3 H606, **GPIO35-37 belong to octal PSRAM**.
The display uses **DATA=21, LATCH=47, CLOCK=48**, otherwise unused camera pins;
no camera may be attached. LD2451 stays **RX=16, TX=17** (radar TX ->16,
radar RX ->17). The existing reference UART and modem behavior are unchanged.
The board environment uses 16 MB flash and `qio_opi` PSRAM.

Connect ESP DATA to module #1 DATAIN, #1 DATAOUT to #2 DATAIN, and carry clock,
latch and ground through OUT -> IN. Power the display's **3V3/5V logic input
from ESP 3V3** for direct 3.3 V GPIO signaling; the separate LED rail stays
**12 V**, radar VIN stays **5 V**, and all grounds are common. Solder pin
headers into PCB holes; pushed-in loose pins do not provide reliable contacts.

The driver uses standard active-high patterns, explicit 10 us MSB-first data/
clock/latch timing, two bytes then one latch pulse. First byte reaches far #2
(assumed left), second remains in near #1 (right). Set
`CHECKIT_SPEED_DISPLAY_REVERSE_DIGIT_ORDER=1` if 12 appears as 21.
`showNumber`/`showSpeed` handle 0-99 and saturate higher values; negative values
and `clear`/`blank` blank both digits. `refresh` resends the cached pattern.

`setup()` clears repeatedly for one second while power settles and stays
blank. Neither the full image nor the room-test image runs all-segments, 66
flashes or a count at boot. Only radar warnings light this sign. Refresh
continues every 100 ms during operation. The old startup replay route returns
HTTP 410 without changing the sign; its dashboard button has been removed.

### Simple display and radar checks

In `radar_display_test`, decoded speed and EMPTY reports appear by default;
use `b` to pause/blank, `8` for a steady hold, `a` to toggle easy testing,
`s` for status, `r` to toggle raw bytes and `e` to toggle empty logging.
In the full `radar_node`, the dashboard shows radar health and decoded targets;
`r` starts a bounded raw capture for diagnosing the link. The full image keeps the
Lonely Binary sign blank until qualifying radar detections arrive; the test
image also permits explicit steady manual patterns.

`[RADAR CHECK]` and the dashboard report **NO_DATA**, **UNDECODABLE_DATA**,
**VALID_IDLE**, **TARGET_REPORTED**, or **REPORTS_STALE**. Only recent complete
LD2451 protocol reports prove the UART link is working; bytes alone do not.
An empty valid report proves communication even without a target. A reported
target still passes the existing speed stability, warning and traffic filters.
The dashboard no longer calls zero valid frames a live heartbeat. Periodic hex
samples are off by default; set `CHECKIT_RADAR_RAW_DIAGNOSTICS=1` to restore them.
Type `r` for an optional bounded 15-second raw capture; boot does not dump raw bytes.
LD2451 VIN still needs a verified 5V supply; display logic uses 3.3V. Firmware
cannot correct an undervoltage supply or intermittent header contact.

### LD2451 simple baseline (v14 / 2.8.0)

Both the full `radar_node` and radar-only `ld2451_bench` listen at **115200 8N1**,
ESP RX=GPIO16 (radar TX), ESP TX=GPIO17 (radar RX). At normal boot they send
**no LD2451 configuration commands**: no speed/sensitivity/direction writes,
no version/settings queries, and no baud scanning. Power-cycle the sensor
before testing so a previous configuration session is not left open.

The decoder follows the manufacturer V1.03 format: `F4 F3 F2 F1`, two-byte
little-endian payload length, payload, `F8 F7 F6 F5`. The exact idle report is
`F4 F3 F2 F1 00 00 F8 F7 F6 F5`. Nonempty payloads contain target count,
alarm, then angle/distance/direction/speed/SNR (five bytes per target).
Speed is km/h; angle is raw byte minus 128; direction follows the table:
0=away, 1=approach. Its worked example reverses the direction labels, so use
controlled passes to verify physical direction before changing the mapping.
Undocumented `02 AA` payload prefixes and `A1 A2 A3 A4 A5 A6` streams are
not converted into invented speeds.

Full firmware keeps the radar-driven mph warning policy, app
provisioning, Wi-Fi/cloud, reference radar and traffic counting. Every second
with reported targets, `[LD2451 TARGET]` prints the sensor's decoded measurements
**before app filters**. Five-second `[RADAR CHECK] VALID_IDLE` means valid
reports arrived with no target. `TARGET_REPORTED` means the sensor supplied a
target, independently of whether a warning/count qualifies.

Type `r` in the full firmware to capture a contiguous prefix (up to 512 bytes)
over 15 seconds while normal detection continues. It prints byte/header/valid
report and rejection counts followed by the retained raw bytes. Boot does not
start this capture. Zero report headers means the documented frame was not
received; downstream speed filters have not been reached. Length/payload/trailer
errors identify framed but invalid data.

### Restore the physical radar's factory settings

Uploading simplified ESP code does not itself erase settings saved inside the
LD2451. In the **full `radar_node`** USB monitor, type uppercase **`X`** once
while the display is blank. The manual action sends configuration enable
`0x00FF`, checks model `0x2451` with version query `0x00A0`, sends factory
settings reset `0x00A2`, then reboot `0x00A3`. Each command has one bounded
ACK wait; failure is reported. No reset is sent if the model cannot be confirmed.
An acknowledged reset with an unconfirmed reboot requires a sensor power cycle
to apply the defaults. No custom sensor settings are reapplied afterward.

This restores **settings**, not the radar firmware version. It leaves the ESP's
app credentials, Wi-Fi configuration and traffic journal intact. Normal startup
never repeats the factory reset. After reset, watch for increasing `valid_reports`
and `VALID_IDLE`/`TARGET_REPORTED`; command ACKs alone do not prove measurement
output works. The Bluetooth app can also restore factory settings if it connects.

### Radar-only test

For the ESP connected only to the radar, upload the small `ld2451_bench` image:

```sh
pio run -e ld2451_bench -t upload --upload-port /dev/cu.usbmodem1101
pio device monitor -e ld2451_bench -b 115200 --port /dev/cu.usbmodem1101
```

This is the original raw UART reader that produced valid packets on the working
radar-only pair. It sends no commands and starts no display, Wi-Fi, BLE, cloud,
reference radar, parser or traffic/warning filters. It prints incoming bytes in
hexadecimal and `[WAIT]` when no bytes arrive for two seconds. Look for the idle
packet `F4 F3 F2 F1 00 00 F8 F7 F6 F5` or length-7 one-target packets.
The bench does not implement the full firmware's `X` factory reset command.
Upload `radar_node` afterward to restore the complete system.

Selecting `pio device monitor -e radar_node` does **not** install that firmware;
the last uploaded image remains on the board. A hex-only log can therefore
come from the raw bench image even when the monitor uses `-e radar_node`.

Manufacturer documents used for this baseline:

- [LD2451 UART protocol V1.03](https://h.hlktech.com/download/HLK-LD2451-24G/1/LD2451%20%E4%B8%B2%E5%8F%A3%E9%80%9A%E4%BF%A1%E5%8D%8F%E8%AE%AE%20V1.03.pdf)
- [LD2451 hardware/use manual V1.03](https://h.hlktech.com/download/HLK-LD2451-24G/1/HLK-LD2451%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C_V1.03%20.pdf)
- [LILYGO T-SIM7080G board documentation](https://github.com/Xinyuan-LilyGO/LilyGo-T-SIM7080G)

The hardware manual specifies 5V VIN with supply capacity **greater than
200 mA** (107 mA average), 3.3V I/O, approximately one idle report per second,
and 100 ms reports when a target is detected. This is an outdoor vehicle radar
with a narrow beam. A valid idle packet is evidence of a working UART report
link, not evidence of successful human detection. Keep the sensor still, its
antenna unobstructed and facing the test path. LILYGO VSYS follows its supply:
it is not a regulated 5V output when running from a lower-voltage battery.

### Build, upload and monitor

Use your existing ignored secrets file, then run from this directory:

```sh
pio run -e radar_node
pio run -e radar_node -t upload --upload-port /dev/cu.usbmodem1101
pio device monitor -e radar_node -b 115200 --port /dev/cu.usbmodem1101
```

Use `pio device list` if the USB port changes. Close the monitor before upload.
No Git pull is needed for changes already saved in this checkout. Uploading
`lonely_binary_bench` instead replaces the application with the standalone test.

For an explicit temporary test of an already provisioned board, independent of
its saved observation mode/high speed limit, use **radar_node_room_test**:

```sh
pio run -e radar_node_room_test -t upload --upload-port /dev/cu.usbmodem1101
pio device monitor -e radar_node_room_test -b 115200 --port /dev/cu.usbmodem1101
```

That image uses the compiled hotspot from `CheckItSecrets.h`, a 3 km/h limit,
and 1 m minimum display range. It does not change the radar's stored cutoff.
The sign starts blank and responds only to radar. Saved app settings are retained but explicitly overridden for this test;
restore `radar_node` afterward to follow the app. Wi-Fi/cloud still require a
provisioned identity; a fresh board must first complete secure app setup.

Independent `lonely_binary_bench` repeats blank -> near 8 -> blank -> far 8 ->
both 88 -> five 66 flashes -> blank. `ld2451_bench` prints raw UART bytes using
the same H606 hardware configuration, with no network or radar commands.
Native tests cover spike rejection, low-speed acceptance, median filtering,
association gaps/direction, duplicate targets, quality gates, mph conversion,
fixed flash duration, rearming and timer wraparound.

Files changed for integrated app-controlled mph warnings: `src/radar_node/main.cpp`,
`src/radar_node/RadarDashboardPage.h`, `lib/CheckItConfig/CheckItConfig.h`,
`lib/SpeedDisplayPolicy/SpeedDisplayPolicy.h`,
`lib/SpeedDisplayPolicy/SpeedDisplayPolicy.cpp`,
`test/test_speed_display_policy/test_main.cpp`, `platformio.ini`, and this README.
The existing LonelyBinaryDisplay driver and standalone bench remain available.

Files changed for the v14 LD2451 baseline: `src/radar_node/main.cpp`,
`src/ld2451_bench/main.cpp`, `lib/Ld2451Protocol/Ld2451Protocol.h`,
`lib/Ld2451Protocol/Ld2451Protocol.cpp`, `lib/CheckItConfig/CheckItConfig.h`,
`test/test_decision_engine/test_main.cpp`, `platformio.ini`, and this README.

### Phone diagnostic history

The local radar dashboard pauses a log's live updates when you scroll up. Check
**Follow latest** to resume. A separate **Over-limit detections** log records each
qualifying real target report, its measured speed and active threshold, and either
`FLASH requested` or the manual/simulation pause reason. Empty reports and synthetic
speed tests do not enter this history. These are reports, not unique vehicle counts.
The ESP32 retains the latest 128 entries in RAM until restart; an open page collects
up to 2,000, with a text download for keeping them. Closing/reloading the page loses
its extra entries. Flash requests are software decisions, not feedback from LEDs.
Run `node tools/tests/radar_phone_scroll.cjs` to check the scroll-pause behavior.

### Display timing regression checks (v18)

A qualifying report now sends the first digits immediately, before the cloud
observer and decoded serial logging. Peak updates use the current flash phase;
they do not restart the two-second window. UART processing yields after at most
128 bytes or 5 ms per batch (one report handler can take longer), and the display
is serviced before and after dashboard/cloud work. Radar UART settings and frame
decoding are unchanged. There is no startup animation.

Run the host GPIO/protocol regression suite with
`sh tools/tests/run_display_host.sh`, and dashboard scroll checks with
`node tools/tests/radar_phone_scroll.cjs`. The host suite checks both modes,
single-report thresholds, rounding, multi-target selection, manual pause/resume,
simulations, timer rollover, and the first write before delayed loop/cloud work.
These checks verify commanded data, not electrical delivery or physical LEDs.

Build/upload the connected firmware with `pio run -e radar_connected -t upload`
from this directory; monitor with `pio device monitor -e radar_connected -b 115200`.
The banner identifies v18. In the phone dashboard, select Resume normal radar
after a manual hold or simulation; those controls intentionally pause live alerts.
Normal mode uses the commissioned app limit, or 8 mph when no limit is configured.
Easy mode uses greater than 3 km/h. Both display rounded peak mph.

### v19 last-flash evidence

The phone dashboard also retains a live flash count and the last alert's peak mph
until restart. It updates after sending the first digits; peak increases update
the saved speed without counting another alert. Simulations and manual commands
do not increment the live count. Serial `s` includes the same history. The count
confirms software output commands, not physical illumination.
