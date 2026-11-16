# MDP M01 ↔ P90x radio protocol

Source: static analysis of M01 firmware v2.03 (`mdp/manifests/M01_FW_v2.03.md`),
loaded at 0x08008000. Function addresses below are in that image so the work can be
re-checked; names are ours. **Nothing here has been seen on air yet** — every claim
is [INF] until a capture or a live exchange upgrades it.

## 0. Confirmed on hardware (2026-11-16)

- **[HW]** An unpaired P906 in pairing mode ("Tx and Rx Addr" → SET; its page shows
  "not set", 2.478 GHz) answers our type-0x05 beacon sent on `FF FF FF FF FF`,
  ch 78, 2 Mbps, CRC16, from an nRF52840 (bridge firmware in `bridge/`). Reply:
  `05 04 <id0..id3> <check>` — type 0x05, len 4, the module's 4-byte ID, and the
  check byte verified as XOR of the rest ^ 0x88. (Real ID kept out of git — see
  `p906_backups/`.) Frame format, checksum and PHY settings are therefore confirmed.
- **[HW]** The module's packet-control field has length bits `110011` (S0 byte
  0xCC–0xCF, low 2 bits = PID cycling 0–3), not 32 — don't trust that field;
  receive with a fixed 32-byte payload.
- **[HW]** ACKs: the module accepts an ACK that echoes its own S0 header byte
  (zero payload); with the first ACK format (length bits 0) it kept
  retransmitting. Its ACKs to us are received with a fixed zero-length layout.
- **[HW]** Assign (type 0x06, `E0 D3 C2 B1 A0`, ch 78) was answered with
  `06 03 4F 4B 02 8B` = "OK" + model 2 (P906 = model 2). The module then left its
  pairing screen early. But its "Tx and Rx Addr" page still read "not set" and it
  did not answer handshakes on the new address — pairing is **not complete**.
  Leading hypothesis [INF]: like the M01, keep beaconing after the OK and then
  start normal polling; the module may commit only then.
- **[HW]** Beacon replies are timing-sensitive: listening only 30 ms after each
  beacon over a USB-serial round trip caught them in 2 of 4 sessions.

## 0b. P906 side — from P906 firmware v3.01 (`mdp/manifests/P906_FW_v3.01.md`)

- The P906 keeps its radio address/frequency **in a text file on its own USB
  drive**, not just in internal flash. Writer `@0x800F880`, reader called from the
  boot routine `@0x8010ED0`. [INF]
- File content written by the P906 (our words for the printf layout):
  `Addr=` + the 5 address bytes as hex, **MSB first** (`a[4]:a[3]:a[2]:a[1]:a[0]`),
  `\r\n`, then `Freq[2405,2478]MHz=` + (2400 + channel), `\r\n`. [INF]
- The file is read **at boot**. On read failure the module falls back to a 5-byte
  default address stored in its image (`@0x802CCB4`, value not yet read). [INF]
- Consistent with what we saw: the owner's P906 drive held only `Q_SET.TXT`
  (no address file) and the menu said "not set". [HW for the drive contents]
- **Default address with no file = `FF FF FF FF FF`** (same as the pairing
  address) — read from the image. [INF]
- Reader parses the frequency as `(MHz − 96)` truncated to a byte, i.e.
  2478 → 78 = channel. [INF]
- The address-file writer has one caller, `@0x8017034` (presumably the type-0x06
  handler) — not yet decompiled.
- Owner's emails: the P906 drive normally also holds `<ID>.CFG` and `<ID>.PRM`
  (calibration/config), named by the same 4-byte ID the radio reports. [HW per
  owner, 2023]
- **[HW]** Read-only scan, P906 powered and not in USB mode: handshake/poll on
  `FF×5`, all channels 0–125 → no ACK, no reply. So outside its pairing screen it
  is not listening on the default address either.
- File name: **`RX_ADDR.TXT`** (drive root). [INF]
- **Pairing commits only after the module's own reply is ACKed.** The handler
  `@0x8017034` runs when the module is in the "assign received" state *and* its
  radio status shows TX_DS (0x20 — its type-0x06 "OK" reply got an ACK). Only
  then does it adopt the new address, retune the radio, leave pairing and write
  `RX_ADDR.TXT`. No ACK → nothing is saved. [INF]
- The module's TX setup (`@0x801882C`) uses SETUP_RETR 0x1A: it waits **500 µs**
  for an ACK and retries 10×. nRF24 TX→RX turnaround is ~130 µs, so an ACK must
  land roughly 130–500 µs after the module's packet. [INF]
- Radio IRQ (`@0x801891A`): on RX_DR it processes the frame, but answers in normal
  mode **only if the "address loaded from RX_ADDR.TXT" flag is set** (boot reader
  `@0x8010ED0`). No file → silent outside the pairing screen (matches the empty
  scans). On TX_DS it records 0x20 (what the pairing commit waits for); on
  MAX_RT it records 0x10. [INF]
- `RX_ADDR.TXT` parse (`@0x800F76C`), our words: split on `=`, then four `:`-
  separated hex bytes fill address bytes 4,3,2,1, the byte before `\r\n` fills
  byte 0; after the next `=` the number is MHz, stored as `(MHz − 96) & 0xFF`
  (= MHz − 2400). So `Addr=A0:B1:C2:D3:E0` + `Freq[2405,2478]MHz=2478` →
  SPI-order address `E0 D3 C2 B1 A0`, channel 78 — what the host tools use. [INF]
- The module's RX setup (`@0x80188A8`) matches the M01's: EN_AA pipe 0, RF_SETUP
  0x0F, RX_PW_P0 32, CONFIG 0x0F. [INF]

## 0c. After pairing — P906 side (FW v3.01), cross-checked with the M01

Requests (handler `@0x80166D8`): type 0x07/0x08 accepted if `id[4]` equals the
module's ID **or is all zero**. Body len < 7 → plain poll; else `code` at body
offset 6: `0x02` current limit (3 bytes → BCD5, else BCD4), `0x03` voltage
setpoint BCD5, `0x0C` output on/off byte. [INF]

Replies:
- **Status 0x07** (`@0x8016D1C`): len 28 after a plain poll (with setpoint
  echoes), **len 22 after a set-voltage/current** (no echoes). An output command
  (0x0C) does not rebuild the reply — expect the previous status. Layout (frame
  offsets): 2,3 state bytes; 4–5 temperature ×10 °C (byte 4 = value/100, byte 5
  BCD of value%100); 6 output state (0xFF possible); 7–9 BCD5 (likely input
  voltage, mV); 10–11 BCD4 (unknown); 12–23 four samples `v12,i12` packed
  `v>>4 | (v&F)<<4 | i>>8 | i&FF`; 24–26 voltage setpoint BCD5; 27–29 current
  setpoint BCD5. [INF]
- **Handshake 0x09** (`@0x8016EFA`): len 14: `id[4]`, state, four big-endian
  calibration words (v_off, v_gain, i_off, i_gain), model `2`. Factory defaults
  in the image: 0x0037, 0xC256, 0x0013, 0x78E5. [INF]
- **0x08** samples reply (`@0x8016EB0`), **0x04** (`@0x8016DD6`) — not decoded yet.

## 1. PHY — nRF24L01 settings the M01 programs

M01 MCU drives an nRF24L01(-compatible) over SPI1 (STM32F1-family peripheral map).
Register writes made when entering TX (`nrf_tx_mode` @0x8024EC8) / RX
(`nrf_rx_mode` @0x8024F44): [INF]

| Register | Value | Meaning |
|---|---|---|
| SETUP_AW | not written (reset 0x03) | 5-byte addresses |
| TX_ADDR, RX_ADDR_P0 | same 5-byte address | auto-ACK on pipe 0 |
| EN_AA | 0x01 | auto-ACK on pipe 0 |
| EN_RXADDR | 0x01 | only pipe 0 |
| SETUP_RETR | 0x1A | ARD 500 µs, 10 retransmits |
| RF_CH | per link (see §2) | 2400 + ch MHz |
| RF_SETUP | 0x0F | **2 Mbps**, 0 dBm, LNA high |
| RX_PW_P0 | 0x20 | **fixed 32-byte payload** |
| FEATURE / DYNPD | not written | no dynamic payload length, no ACK payloads |
| CONFIG | 0x0E TX / 0x0F RX | CRC enabled, **2-byte CRC**, powered up |

So the link is classic Enhanced ShockBurst, static 32-byte payload, 2 Mbps, CRC16.
An nRF52840 can speak this (RADIO `Nrf_2Mbit` + Nordic ESB in fixed-length mode).
[INF]

### Half-duplex request/response

The M01 is the master. For each exchange it [INF]:
1. switches to PTX on the slot's address/channel, sends one 32-byte frame
   (auto-ACKed by the module);
2. on TX_DS, switches to PRX on the **same** address/channel and waits for one
   32-byte reply frame from the module;
3. on MAX_RT (no ACK) it counts a miss; after ~20 consecutive misses the slot is
   marked offline (more tolerated for the selected slot in some modes).

The M01 polls up to 6 slots round-robin, favouring the slot currently selected on
its screen.

## 2. Addresses and channels

| Use | Address (bytes in SPI write order = LSB first) | Channel |
|---|---|---|
| Pairing ("auto match") | `FF FF FF FF FF` | 78 (2478 MHz) |
| Normal, slot *n* | `[k, D3, C2, B1, A0]`, *k* = lowest unused byte ≥ 0xE0 | configurable, default 78 |

- The pairing address and the base `E0 D3 C2 B1 A0` come from the M01's
  initialised-RAM image (RW data at 0x20000000, decompressed by the C runtime at
  boot). Channel default 78 is also there. [INF]
- As a 40-bit number (nRF24 convention, LSB sent last on air but written first):
  normal slot 0 is typically `0xA0B1C2D3E0`. [INF]
- The M01 stores per-slot address + frequency in `RX_ADDR.TXT` on its USB drive,
  one entry per slot (`Addr<n>=..:..:..:..:..` and `Freq<n>...MHz=...`). The
  P906's own menu page **"Tx and Rx Addr"** shows the address/frequency the module
  is using, which is what the "manual" pairing mode asks you to copy into
  RX_ADDR.TXT. [INF — from UI strings]

## 3. Frame format (both directions)

All frames are 32 bytes on air; unused tail bytes are zero.

```
off  size  field
0    1     type
1    1     len  = number of bytes in body
2    len   body
2+len 1    check = XOR(byte[0] .. byte[len+1]) XOR 0x88
```

The receiver recomputes `check` and drops frames that don't match (`@0x8022288`
computes it). [INF]

### Numeric encodings

- **BCD, 5 digits in 3 bytes** (`b0` is a plain 0–9 ten-thousands digit, then two
  packed-BCD bytes): `12345` → `01 23 45`. Used for voltage (and current on
  P906). [INF]
- **BCD, 4 digits in 2 bytes**: `1234` → `12 34`. Used for current on model 1. [INF]
- **BCD, 6 digits in 3 bytes**: `123456` → `12 34 56` (electronic-load
  resistance). [INF]
- Units presumed **mV / mA** (P906 max 30000 / 10000 fits the field widths). [INF]

## 4. Model codes

Learned from the module during pairing/handshake: `1` = 5 A supply (P905?),
`2` = 10 A supply (P906 — measured current is scaled ×2 vs model 1), `3` = a
different device class with extra modes (likely the L1060 electronic load). [INF]

## 5. Messages M01 → module

Common header for addressed messages (body bytes 0–5):
`id[4]` (module's 4-byte ID learned at pairing), `slot` (0–5), `selected` (1 if
this slot is the one shown on the M01 screen).

| type | len | body | purpose |
|---|---|---|---|
| 0x05 | 1 | `4D` ('M') | pairing beacon on the pairing address |
| 0x06 | 6 | `addr[5]`, `channel` | pairing: assign the module its address/channel |
| 0x07 | 6 | header | status poll, models 1/2 |
| 0x0A | 6 | header | status poll, model 3 |
| 0x09 | 8 | header, `u16 BE` per-slot value from M01 table | handshake / identify (sent until the module has been identified) |
| 0x07 / 0x0A | 9–20 | header, `code`, `nbytes`, `value[nbytes]` | poll + set one parameter |

Set-parameter codes seen in the builder (`@0x80232A8`): [INF]

| code | nbytes | value | presumed meaning |
|---|---|---|---|
| 0x03 | 3 | BCD5 | set voltage |
| 0x02 | 2 (model 1) / 3 (others) | BCD4 / BCD5 | set current limit |
| 0x0C | 1 | 0/1 | output off/on |
| 0x0B | 1 | byte | mode (model 3 only) |
| 0x0D | 3 | raw 24-bit | model 3 only |
| 0x0E | 3 | BCD6 | model 3 only (resistance?) |
| 0x0F, 0x11, 0x12 | 1 | `01` | model-3 triggers |
| 0x10 | 12 | four values | model-3 (list/sequence?) |
| 0x13 | 3 | BCD5 | model-3 |

## 6. Messages module → M01

Dispatched by type in `@0x80231F8` (only after the check byte verifies). [INF]

| type | body | M01 action |
|---|---|---|
| 0x05 | `id[4]` | pairing reply: M01 records the ID, picks a free slot address, replies with type 0x06 |
| 0x06 | len 3: `"OK"` (4F 4B) + `model` (body[2]); len 2 → model 1 | pairing done: slot marked present, `RX_ADDR.TXT` rewritten |
| 0x09 | `id[4]` (frame 2–5), `state` (6), then by len: 14 → four BE u16 calibration words (7–14) + `model` (15); 6 → `model` (7); 5 or 13 → model 1 | handshake reply; ID adopted if the slot had none, else must match |
| 0x07 | status, see below | live status (models 1/2) |
| 0x08 | `state`, raw samples | streaming samples |
| 0x0A | status for model 3 | live status (model 3) |

Handshake calibration words (type 0x09, len 14), in order: `v_off`, `v_gain`,
`i_off`, `i_gain`. [INF]

Type 0x07 status body (byte offsets inside the frame): [INF — meanings of 2..11 not
yet tied to the UI]

| off | size | content |
|---|---|---|
| 2 | 1 | unknown flag/state |
| 3 | 1 | unknown flag/state |
| 4 | 2 | BCD4 value (temperature?) |
| 6 | 1 | output state (0/0xFF = off, else on) |
| 7 | 3 | BCD5 value (input voltage?) |
| 10 | 2 | BCD4 value |
| 12 | 12 | 4 raw samples, 3 bytes each: `v12 = b0<<4 | b1>>4`, `i12 = (b1&0xF)<<8 | b2` |
| 24 | 3 | BCD5 voltage setpoint echo (frames with len ≥ 0x17) |
| 27 | 3/2 | current setpoint echo (BCD5 if len = 28, else BCD4) |

Raw sample → engineering value (`@0x8022904`): [INF]
- `V = round((v12·16 − v_off) · v_gain / 100000)` (0 if below offset)
- `I = round((i12·4 − i_off) · i_gain / 100000)`, ×2 for model 2

## 7. Pairing flow (as the M01 does it)

1. User puts the module in pairing: long-press MENU → "Tx and Rx Addr" → SET.
2. M01 transmits type 0x05 `4D` on `FF FF FF FF FF` / ch 78, then listens.
3. Module answers type 0x05 with its 4-byte ID.
4. M01 assigns a slot address `[k, D3, C2, B1, A0]` + channel and sends type 0x06
   (still on the pairing address).
5. Module answers type 0x06 with its model code. M01 saves the slot, then moves to
   normal polling on the new address.

6. Leaving pairing (`@0x8014EA4`, menu exit) just clears the pairing-mode flag
   and resumes normal polling — no special "commit" frame is sent. Every slot
   starts with its "needs handshake" flag set (RAM init), so the first frame on
   the new address is the type-0x09 handshake with the slot word (`5A 73` for
   slot 0), then type-0x07 polls. [INF]
7. The M01 can also take slot addresses/channels from the PC over USB (a
   per-slot record of slot, address[5], channel — `@0x8034312`, `@0x80343F6`),
   skipping radio pairing entirely; the module must then already use that
   address. [INF]

Implication for M01-less control: we can play the M01's role and pair modules to
an address of our choosing, or read the address the module already uses from its
"Tx and Rx Addr" page. [INF]

## Open

- Byte order on air vs. ESB library address layout (prefix/base) — verify with the
  first live exchange.
- Exact meaning of status bytes 2–11 and of the per-slot value in type 0x09.
- Whether the module checks `id[4]` in polls (an all-zero ID handshake would let us
  discover it without pairing).
