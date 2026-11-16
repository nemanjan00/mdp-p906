# MDP-P906 — live state (re-read this FIRST, especially after a compaction)

Keep this file short and current. Update the **Now** section before finishing each
step. Durable rig/tool details are in `mdp/SHARP_EDGES.md` and the project
`CLAUDE.md`; host-specific access (lab PC, keys, paths) is in the gitignored
`CLAUDE.local.md`.

Evidence tags: **[HW]** measured on the device · **[VM]** emulator only · **[INF]**
inferred / unverified. Untagged = process or tooling, not a claim about the device.
Keep tagging new claims.

## Now

Direct-radio control works: PC → nRF52840 bridge → P906, no M01 [HW].

- **2026-11-16 17:08–17:12 UTC [HW]:**
  - `mdp pair --direct` (repeat assign while the P906 shows "Match RX Addr..")
    got `06 03 4F 4B 02` ("OK", model 2). The module committed; a handshake on
    `E0 D3 C2 B1 A0` / ch 78 answered with ID, model 2 and calibration words.
  - `mdp status`: temperature 23.0 °C, output off, input ≈ 11.96 V, setpoints
    9000 mV / 20 mA, measured ≈ 2 mV.
  - `mdp set-voltage 3300` with output off → next poll setVoltage = 3300.
- **Output on/off verified with an independent meter [HW]** (Rigol DM858E, DC
  volts only, probes on the P906 output, no load): off 0.23 mV → `output on`
  (set 3.300 V) → **3.30405 V** on the DMM, P906 reports 3299 mV, outputOn true
  → `output off` → outputOn false; voltage decays 3.03→0.96 V over ~15 s (output
  caps into the meter's 10 MΩ, no bleeder). Owner rule: **never measure current
  with the DMM** (probes sit across the output — that would short it).
- **Next (hardware, owner approval per write):**
  1. One `set-current` (unit now known: mA) and re-poll.
  2. Confirm `RX_ADDR.TXT` now exists on the P906 USB drive (read-only listing).
  3. Optional: pair a second module on `E1 D3 C2 B1 A0` (multi-PSU, untested).

## Firmware reimplementation track (started 2026-11-16)

- `mdp/HARDWARE.md` [INF, static only]: STM32F103 HD class; setpoints = TIM8 PWM
  (CCR2 V, CCR1 I) + DAC ch1/ch2 fine, 300 mV / 100 mA segments with correction
  tables; calibration = `<ID>.CFG` (measured points) + `<ID>.PRM` (10 derived
  params); display = 128×32 SSD1306-family OLED on bit-banged I²C PB6/PB7 @0x3C,
  init apparently done by the vendor bootloader; W25Q64 on SPI2 = USB drive.
- Next static: Method3 math (`@0x800B15C`), CFG field order, ADC channel map,
  the PB10/PB11 I²C device. Nothing flashed; bootloader must stay untouched.

## How we got here (2026-11-16, condensed)

- M01 firmware static → frame format, checksum, pairing flow, command set
  (`PROTOCOL.md` §1–7) [INF]; bridge + host built from that doc.
- First contact [HW]: the P906 answered our beacon and said "OK" to an assign,
  but stayed "not set"; a read-only scan of all channels × both byte orders got
  nothing → the pairing had not committed.
- P906 firmware static found why: it saves the address (`RX_ADDR.TXT` on its USB
  drive, read at boot) only once its "OK" reply is ACKed, and ignores frames
  outside pairing without that file. Our ACKs were too early → bridge ACK delay
  set to 130 µs and the header echoed in the ACK.
- The module ACKs nothing for ~1.4 s after a beacon reply (still unexplained
  [HW]), so `pair --direct` skips the beacon and just repeats the assign (16 ×
  300 ms). That committed on the first try with the owner on the match screen.
- Pitfalls hit on the way (listener dying, serial latency, timing) → `SHARP_EDGES.md`.

## Backups on record (gitignored — never committed)

| Image | File | sha256 (first 8) | Device state when taken | Date |
|-------|------|------------------|-------------------------|------|
| P906 USB drive files | `p906_backups/2026-11-16_usbdrive/` | Q_SET `c7223403` | USB mode, unpaired | 2026-11-16 |
| P906 radio ID | `p906_backups/radio_id.txt` | — | from beacon reply | 2026-11-16 |

## Open questions

- Meaning of type-0x07 status bytes 2–3 and the BCD4 at 10–11.
- Why the module is deaf for ~1.4 s after a beacon reply.
- Multiple modules on one bridge (protocol supports it, untested).
- Does an all-zero ID work? P906 FW says polls accept it (`@0x80166D8`) [INF];
  every hardware run so far passed the real ID.

## Answered

- Pairing commits only when the "OK" reply is ACKed (TX_DS) [HW+INF].
- Address byte order on the nRF52840 (PREFIX/BASE mapping in `PROTOCOL.md` §0) [HW].
- Voltage setpoint unit is mV [HW].
- Current setpoint unit is mA [HW]: the P906 screen showed 3.300 V / 0.020 A
  (output off) while our poll read setVoltage 3300 / setCurrent 20
  (owner photo, `images/setup.jpg`). `set-current` itself not yet tried.
- P906 firmware is now in hand (manifest `P906_FW_v3.01.md`).
