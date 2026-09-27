# Check-It ESP-NOW protocol v2

V2 uses one fixed-size, packed binary message for alerts, clears, heartbeats,
and acknowledgements. It is designed for small ESP-NOW packets, deterministic
validation, and compatibility across the radar-node and flashing-node builds.

The source of truth is
`lib/CheckItProtocol/CheckItProtocol.h`. Any incompatible layout or semantic
change requires a new protocol version.

## Wire representation

- Size: 28 bytes
- Byte order: little-endian for all multi-byte integers
- Structure packing: one-byte packed, with no padding
- Magic: `0xC17A`
- Version: `2`
- Integrity: CRC-16/CCITT-FALSE style parameters
  (`poly=0x1021`, `init=0xFFFF`, no reflection, no final XOR)
- Maximum ESP-NOW payload: safely below the 250-byte legacy limit

| Offset | Size | Field | Meaning |
| ---: | ---: | --- | --- |
| 0 | 2 | `magic` | Check-It identifier, `0xC17A` |
| 2 | 1 | `version` | Protocol version, `2` |
| 3 | 1 | `type` | Alert `1`, clear `2`, heartbeat `3`, ACK `4` |
| 4 | 2 | `sequence` | Sender-local monotonically advancing message sequence |
| 6 | 2 | `sourceNodeId` | Logical sender ID |
| 8 | 2 | `targetNodeId` | Logical receiver ID; `0` means all flashing nodes |
| 10 | 4 | `uptimeMs` | Sender `millis()` at construction |
| 14 | 1 | `flags` | Radar-alarm and output-intent bits |
| 15 | 1 | `targetIndex` | Target position in this LD2451 report |
| 16 | 1 | `angleDeg` | Signed radar-relative angle in whole degrees |
| 17 | 1 | `distanceM` | Range in whole metres |
| 18 | 1 | `speedKmh` | Speed magnitude in whole km/h |
| 19 | 1 | `snr` | LD2451 SNR field |
| 20 | 1 | `direction` | Unknown `0`, approach `1`, away `2` |
| 21 | 1 | `warningLevel` | None `0`, info `1`, danger `2`, emergency `3` |
| 22 | 2 | `durationMs` | Requested warning duration |
| 24 | 2 | `relatedSequence` | Original sequence acknowledged by an ACK |
| 26 | 2 | `crc16` | CRC over bytes 0 through 25 |

Integers use the native little-endian ESP32 representation. Consumers on other
architectures must decode fields by offset rather than casting arbitrary input
to an unpacked host structure.

## Flags

| Bit | Name | Meaning |
| ---: | --- | --- |
| 0 | `FLAG_RADAR_ALARM` | The LD2451 alarm byte was asserted |
| 1 | `FLAG_LOCAL_OUTPUT` | Radar node intended to activate its local output |
| 2 | `FLAG_REMOTE_OUTPUT` | Radar node intended remote output |
| 3-7 | Reserved | Must be ignored by protocol-v2 receivers |

Flags are metadata. A flashing node still validates message type, destination,
direction, warning level, and duration before activating.

## Message semantics

### Alert

`MSG_ALERT` carries one selected target and a duration. The target is the
highest-severity qualifying target in the report, using speed as the tie
breaker. The flashing node accepts only:

- direction `approach` or `away`;
- warning level `info` through `emergency`; and
- duration from 1 through 30,000 ms.

An accepted alert starts or replaces the current display/tone state and is
unicast-ACKed to the source MAC.

### Clear

`MSG_CLEAR` stops outputs immediately and is ACKed. The current radar firmware
normally relies on each bounded alert duration and on the heartbeat failsafe,
but the message is available for explicit cancellation.

### Heartbeat

`MSG_HEARTBEAT` has no target payload or duration. It advances the radar
sequence and refreshes the flashing node's liveness timer. The default transmit
interval is 2 seconds; the default stale timeout is 12 seconds.

This protocol heartbeat is different from the LD2451's zero-payload UART frame.

### ACK

`MSG_ACK` is sent from a flashing node to the source radio MAC. Its own
`sequence` belongs to the flashing node, while `relatedSequence` contains the
accepted alert or clear sequence. It targets the originating radar node ID.

ACKs provide delivery observability; the current radar node logs them but does
not retransmit or block local outputs when one is missing.

## Validation order

The flashing node performs these checks before output:

1. Receive callback length equals 28 bytes.
2. Magic, version, and type are known.
3. CRC matches bytes 0-25.
4. Target is broadcast `0` or this flashing node's ID.
5. Sequence is newer for this source.
6. Message-specific payload is valid.

Packets that fail before sequence acceptance do not advance liveness. A
well-formed heartbeat does.

## Sequence comparison and wraparound

Each sender has its own 16-bit sequence space. The sender skips zero for newly
allocated application messages, but the receiver's modular comparison also
handles a peer that wraps from `65535` to `0`.

The receiver casts the unsigned difference between the new and previous
sequence to signed 16-bit:

```text
delta > 0   newer; accept
delta <= 0  duplicate or stale; reject
```

This standard half-range rule is unambiguous when a source does not jump ahead
by 32,768 or more messages between accepted packets. The bounded tracker stores
up to eight sources and deterministically replaces a slot if that limit is
exceeded.

## CRC scope and test vector procedure

Before transmission:

1. Zero-initialize the entire 28-byte message.
2. Fill all semantic fields.
3. Calculate CRC over the first 26 bytes.
4. Store the result in little-endian `crc16`.

Tests verify a valid constructed message, then mutate a protected field and
confirm validation fails. CRC provides corruption detection only; it is not a
message authentication code.

## Compatibility and security

Receivers reject every version other than `2`. Additive meaning changes may use
reserved flag bits only when old receivers can safely ignore them. Layout,
units, enum, or behavior changes require version `3`.

The default commissioning transport uses the broadcast radio MAC and no ESP-NOW
encryption. Logical target IDs are routing, not security. Public deployment
requires site-specific unicast peers, link keys, key rotation/replacement
procedures, and physical MAC inventory.
