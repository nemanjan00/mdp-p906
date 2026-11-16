# MDP-P906 (via MDP-M01) — live state (re-read this FIRST, especially after a compaction)

Keep this file short and current. Update the **Now** section before finishing each
step. Durable rig/tool details are in `mdp/SHARP_EDGES.md` and the project
`CLAUDE.md`; host-specific access (lab PC, keys, paths) is in the gitignored
`CLAUDE.local.md`.

Evidence tags: **[HW]** measured on the device · **[VM]** emulator only · **[INF]**
inferred / unverified. Untagged = process or tooling, not a claim about the device.
Keep tagging new claims.

## Now

- **2026-11-16 17:08–17:12 UTC: CONTROL WORKS [HW].**
  - `mdp pair --direct` (repeat assign while the P906 shows "Match RX Addr..")
    got `06 03 4F 4B 02` ("OK", model 2) → module committed; handshake on
    `E0 D3 C2 B1 A0` / ch 78 answered with ID, model 2 and calibration words.
  - `mdp status` [HW]: temperature 23.0 °C, output off, input ≈ 11.96 V,
    setpoints 9000 mV / "20" (current unit unconfirmed), measured ≈ 2 mV.
  - `mdp set-voltage 3300` with output off → next poll setVoltage = 3300 [HW].
- **Next:** owner confirms the screen (3.300 V; what the current limit shows →
  unit of `setCurrent`); then `set-current`, then `output on` into a safe load
  (owner approval per write). Also confirm `RX_ADDR.TXT` now exists on the drive.


- **2026-11-16 (end of session): radio link to the P906 works [HW], pairing not
  yet committed.** Bench (lab host — see CLAUDE.local.md): P906 on USB
  (USB mode = only a drive with `Q_SET.TXT` presets — no control channel), nice!nano
  (nRF52840) running `bridge/` firmware on /dev/ttyACM0.
  - [HW] P906 answers our type-0x05 beacon (FF×5, ch 78) with its ID; check byte,
    2 Mbps, CRC16, 5-byte address all confirmed.
  - [HW] Assign (type 0x06, `E0 D3 C2 B1 A0`, ch 78) answered "OK"+model 2, the
    P906 left its pairing screen — but its "Tx and Rx Addr" page still says
    "not set" and it does not answer on the new address.
- [HW] Later, with the P906 out of USB mode: a read-only scan (handshake 0x09 with
  its ID and with ID 0, poll 0x07) over channels 0–125 × both address byte orders
  got **no ACK and no reply** → the module holds no working address; pairing
  really did not commit.
- [HW] `mdp pair` run 1 got the ID but no assign confirmation within its short
  (60 ms × 1.5 s) window. `pair()` now uses the M01's timing: 300 ms reply
  window, 4 assign tries, fall back to beaconing (@0x80237DA). Not yet tried
  with SET pressed.
- [INF] M01 static check: after pairing it sends nothing special, just the 0x09
  handshake then 0x07 polls on the new address — `mdp pair` already matches.
  So the open question is P906-side: does it commit only if our ACK of its
  "OK" reply lands? (Watch for DUP retransmits of the 0x06 reply next time.)
- [HW] An owner SET press was wasted: the detached pairing listener had died
  (see SHARP_EDGES "Lab host"). Use the systemd-run recipe and verify it is alive.
- **[INF] Root-cause lead (P906 FW v3.01):** the P906 stores its address in a
  text file on its USB drive and reads it **only at boot**. So after a successful
  radio pairing it may need a power-cycle, or the file write may have failed.
  Cheapest next experiments, no SET press needed:
  1. Put the P906 in USB mode and list its drive (read-only): is an address file
     there after the earlier "OK"?
  2. Power-cycle it, then rerun the read-only channel/order scan.
  3. Finish the static read (file name, default address, 0x06 handler) — blocked
     by the IDA permission classifier on 2026-11-16.
- **[INF] Root cause found (P906 FW):** the P906 saves pairing only when its
  "OK" reply is ACKed (TX_DS). Our ACKs were very likely too early (~50 µs vs
  nRF24's ~130 µs TX→RX turnaround) → DUP retransmits → never saved.
  Bridge fixed: ACK delay 130 µs (`D`), DUP counter (`S`).
- [INF] Confirmed in P906 FW: ACK window 130–500 µs (SETUP_RETR 0x1A); without
  `RX_ADDR.TXT` the module ignores frames outside pairing (explains empty scans).
- **Two independent routes to a working link:**
  A) USB file (deterministic): P906 in USB mode → list drive → (owner OK) write
     `RX_ADDR.TXT` = `Addr=A0:B1:C2:D3:E0\r\nFreq[2405,2478]MHz=2478\r\n` →
     power-cycle → `mdp handshake --id <id>`.
  B) Radio pairing with the 130 µs ACK delay (below).
- [HW] Traced runs 2026-11-16 ~16:00 UTC (bridge ACK delay 130 µs):
  - On "Match RX Addr..": beacons ACKed by its radio; replies arrive later than
    60 ms → beacon listen now 300 ms (like the M01). Beacon reply received.
  - **After its beacon reply the module ACKed nothing for ~1.4 s** (4 assign
    tries over 1.2 s all ack=0; next beacon at +1.4 s ack=1) → assign retries
    extended to 16 × 300 ms (~5 s; module waits 7 s per P906 FW). Not yet tested
    with SET pressed.
  - Off the match screen: occasional hardware ACKs, never a reply.
- Correction [INF→checked]: the P906 radio-switch "delay" (`@0x8015C78`, arg 20)
  is ~80 loop iterations (µs), not 20 ms; the radio is interrupt-driven (EXTI9_5
  vector → `@0x801891A`). So the ~1.4 s deaf period after a beacon reply is
  **unexplained**. Owner confirms the module *was* on "Match RX Addr.." during
  the 16:02–16:05 run that got ACKs but no replies.
- New: `mdp pair --direct` skips the beacon and just repeats the assign — the
  assign handler needs only the match screen, and polls accept an all-zero ID
  (P906 `@0x80166D8`). Started 16:06 UTC, owner couldn't reach the module;
  2 assigns ACKed, no "OK" yet. **Run this first next time**:
  `systemd-run --user --unit=mdp-pair --working-directory=/tmp/mdp-host node bin/mdp.js pair --direct --window 600`
- **Next experiment (one variable = ACK delay):** owner presses SET, run
  `mdp pair` via systemd-run (verify alive!). Prediction: the 0x06 reply arrives
  without DUP, the P906 shows the new address in "Tx and Rx Addr", and an
  `RX_ADDR.TXT` with `Addr=A0:B1:C2:D3:E0` / `Freq[2405,2478]MHz=2478` appears
  on its drive. **Disproved if** the reply still repeats as DUP → try `D 200`,
  then look at ACK format instead of timing.
- **Next:** with the owner at the P906 (pairing screen → SET), run
  `node host/bin/mdp.js pair` — it now mimics the M01 fully: beacon → assign →
  keep beaconing 3 s → handshake on the new address (both byte orders worth
  trying via `--order`). If "not set" persists: look for what the M01 does after
  the OK (P906 may need the handshake/poll within a window, or a different
  channel byte meaning). Then `status`, then set-voltage with output OFF
  (owner approval needed for any set/output command).

## Backups on record (gitignored — never committed)

| Image | File | sha256 (first 8) | Device state when taken | Date |
|-------|------|------------------|-------------------------|------|
| P906 USB drive files | `p906_backups/2026-11-16_usbdrive/` | Q_SET `c7223403` | USB mode, unpaired | 2026-11-16 |
| P906 radio ID | `p906_backups/radio_id.txt` | — | from beacon reply | 2026-11-16 |

## Open questions

- What makes the P906 commit a pairing (it says OK, then stays "not set")?
- Does the P906 check `id[4]` in polls/handshake? (all-zero ID test settles it)
- On-air byte order of address vs. ESB prefix/base layout on nRF52840.
- Meaning of type-0x07 status bytes 2–11; units (mV/mA) of setpoints.
- Is a P906 that was never paired to an M01 sitting on a default address? (its
  "Tx and Rx Addr" page answers this).
- No P906 firmware in hand — module-side behaviour is inferred from the M01 only.

## Done (brief)

- Clean-room scaffold, gitignore, manifests for M01_FW_v2.03 and MDP_PC_V1.2.1.
- M01 nRF24 driver, frame format, checksum, pairing flow, command set → PROTOCOL.md [INF]
- nRF52840 bridge firmware (`bridge/`), host codec + CLI (`host/`) with tests
- First radio contact with a P906: beacon reply + assign "OK" [HW]
