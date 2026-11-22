# LDTR21BT_A standalone test with LilyGO T-SIM7080G-S3

Separate receive-only bench firmware. The exact LDTR21BT_A supply, connector
pinout, TTL voltage and protocol are **not yet verified**. Do not reuse the
K-MD7 connector numbers or wire colors. No speed decoder or dashboard is
implemented until we have the protocol or a documented capture.

## Supplied purchase listing (checked November 21, 2026)

The supplied [Alibaba listing](https://www.alibaba.com/product-detail/Self-Developed-LDTR20-LDTR21-24GHZ-Millimeter_1601452605625.html)
currently identifies the product as **ZLYTR20**, sold by Zilai Technology
(Shenzhen), despite the LDTR20/LDTR21 URL. It does not establish the identity
or wiring of an **LDTR21BT_A**.

The supplier description advertises 9-24 V, <=75 mA at 12 V, RS-485 and TTL
serial interfaces at 9600 baud. These are listing claims for ZLYTR20, not
verified specifications for your BT_A. It does not establish the BT_A cable
colors, connector pin numbers, TTL logic voltage, parity, or packet protocol.
If the seller confirms your unit matches this supply specification, use a
regulated 12 V supply for the radar; LilyGO 3V3/VSYS cannot power it directly.

Ask the seller to confirm the delivered model and provide the **LDTR21BT_A**
datasheet, power and signal pin/color diagram, interface option, TTL voltage
if applicable, UART settings, and protocol including whether it streams
automatically or needs requests. Do not assign wire functions by color alone.

## Choose the interface first

- **RS-485 A/B terminals:** use a **3.3 V MAX3485 breakout board** exposing
  VCC, GND, RO, DI, DE, /RE and A/B. Its supply and RO logic must be 3.3 V.
  A USB-to-RS485 dongle is for direct computer testing, not this ESP32 wiring.
- **Verified 3.3 V TTL TX:** connect directly to GPIO16; no RS-485 adapter.
- **5 V TTL TX:** use a suitable unidirectional 5 V-to-3.3 V UART level
  translator on TX -> GPIO16. Do not wire it directly to the ESP32.
- **RS-232:** requires a different transceiver. Stop and confirm the interface.

Avoid generic 5 V MAX485 modules unless their ESP32-side logic compatibility
is explicitly guaranteed. MAX3485 is a different, 3.3 V part. Check the
breakout schematic too; onboard resistors and termination vary.

## Supply and wires

The related manufacturer LDTR21M page specifies 9-24 V and <=48 mA at 12 V;
this is NOT confirmation for the BT_A. If your exact unit's label/manual
confirms that range, regulated **12 V** is a suitable bench supply. Otherwise
use the exact specified supply. LilyGO VSYS/3V3 is not a 12 V radar supply.
Never apply the radar supply voltage to an ESP32 GPIO or the 3.3 V adapter.

Have a USB-C data cable for LilyGO, short insulated jumper leads with ends
matching your headers, a twisted pair for A/B, a terminal block for common
ground, and a multimeter. Use a current-limited bench supply with capacity
for the radar's documented peak current. The table below refers to functional
labels, not physical connector positions or cable colors.

### RS-485: receive-only wiring

Power off before wiring. This assumes a short, non-isolated bench connection.

| From | To |
| --- | --- |
| Verified radar power input + | Correct external regulated supply + |
| Radar GND / supply return | Supply negative, LilyGO GND and adapter GND |
| LilyGO 3V3 | MAX3485 VCC |
| MAX3485 RO (receiver output) | LilyGO GPIO16 |
| MAX3485 DE (driver enable) | GND: transmitter disabled |
| MAX3485 /RE (active-low receiver enable) | GND: receiver enabled |
| MAX3485 DI (driver input) | GND: defined level; transmitter stays disabled |
| Radar RS-485 A | Adapter A, subject to both manuals' polarity definitions |
| Radar RS-485 B | Adapter B, subject to both manuals' polarity definitions |

Do not connect A/B directly to ESP32 GPIOs. A/B naming can differ between
vendors: if the verified powered device should transmit and nothing is
received, check both manuals' differential polarity definitions. Correct
an inverted pair with power off; never experiment by swapping power wires.
Follow the radar/adapter guidance for termination and biasing; inspect any
installed resistors before adding more. Longer outdoor wiring needs a
separate grounding, surge protection and isolation design.

GPIO17 is **unused** in this first test. For a future documented request/response
protocol, TX and DE control will be added deliberately. Do not tie DE high.

### Verified 3.3 V TTL: receive-only wiring

| From | To |
| --- | --- |
| Radar TX (verified 3.3 V logic) | LilyGO GPIO16 |
| Radar GND / supply negative | LilyGO GND |
| Radar supply input | Correct external supply, as specified for that unit |
| Radar RX | Leave disconnected during passive capture |

## Same LilyGO, separate firmware

Disconnect K-MD7 TX and any camera from GPIO16 before connecting this radar.
The camera shares GPIO16/17 on T-SIM7080G-S3. Keep the existing display and
other unused peripherals disconnected for the first bench test. Connect
LilyGO's **USB-C**, not the modem Micro-USB connector.

Uploading replaces the running K-MD7 firmware; it does not edit its project.
No upload is performed merely by preparing this folder. Stop the K-MD7 USB
dashboard and all serial monitors before uploading or opening this monitor.

```sh
cd /Users/himan/Desktop/Check/checkit-transportation-felix/ldtr21bt-a-tsim7080g
pio run -e tsim7080g
pio device list
pio run -e tsim7080g -t upload --upload-port /dev/cu.YOUR_PORT
pio device monitor -e tsim7080g --port /dev/cu.YOUR_PORT
```

Replace the port placeholder using `pio device list`. USB console is 115200.
Radar UART starts at **9600 8N1**, a provisional setting: only 9600 baud is
supported by the related LDTR21M and supplied ZLYTR20 listings; parity/stop bits and the BT_A baud
are unconfirmed. Adjust `LDTR_BAUD`, `LDTR_PARITY`, `LDTR_STOP_BITS` in
`platformio.ini` to the exact manual, rebuild and upload. This changes the
reader only, not radar settings. At higher data rates verbose hex output can
exceed USB logging throughput; this is a low-rate diagnostic, not a lossless
high-rate logger.

The monitor prints timestamped HEX and printable ASCII, byte counters, and
UART framing/parity/overflow errors. `h` prints help; `s` prints status.
Console keys never get forwarded to the radar. Line breaks are read chunks,
**not confirmed protocol packet boundaries**. Received bytes alone do not
prove valid detections. Silence does not prove lack of power: the unit may
need polling, startup commands, different UART settings, or a moving target.
No guessed Modbus, K-MD7 INIT, or configuration commands are sent.

## First capture and comparison

1. Verify the unit's supply/interface/pinout and measure supply polarity.
2. Capture 30 seconds with an empty scene, then controlled approaching and
   receding motion. Record UART settings and save the monitor output.
3. Obtain the exact vendor protocol before labeling bytes as speed/direction.
4. Once decoded, compare with K-MD7 using repeated passes, identical mounting
   geometry, and one radar powered at a time initially. Record missed passes,
   false reports, latency, repeatability and first reliable detection distance.
5. Measure supply **watts** (volts x amps), not just current across differing
   supply voltages. Use an independent speed reference for accuracy testing.

To restore the K-MD7 project on the same board:

```sh
cd /Users/himan/Desktop/Check/checkit-transportation-felix/kmd7-tsim7080g
pio run -e tsim7080g -t upload --upload-port /dev/cu.YOUR_PORT
```

## Sources and remaining information

- [LDTR21M manufacturer page](https://www.mwradar.com/ruda888/products/58124160.html): related-family supply, interface and baud only.
- [MAX3485 manufacturer datasheet](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX3483-MAX3491.pdf): 3.3 V transceiver and DE / RE behavior.
- [LilyGO board documentation](https://github.com/Xinyuan-LilyGO/LilyGo-T-SIM7080G): GPIO16/17 camera sharing and board configuration.

Purchase link received and checked above. Still needed to finish the exact
wiring/decoder: confirmation of the delivered model, BT_A wiring diagram,
output logic levels, and serial protocol/manual. Label and connector photos
can help resolve the model mismatch.
