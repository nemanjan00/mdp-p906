# mdp-p906 — open control for Miniware MDP-P906 power supplies

Goal: control MDP-P906 (P90x) power modules from our own code (Linux, no vendor
app), via a clean-room reimplementation of the vendor protocols.

## Conventions (read first)

- **Clean-room** — follow `/home/nemanjan00/.claude/skills/clean-room-reversing`.
  Vendor bytes (firmware, PC app, manuals, dumps, decompiler output) never enter git.
- **Layout = convention A + gitignored drops:**
  - `mdp/` — TRACKED findings for this target (PROTOCOL.md, FIRMWARE.md, …).
  - `mdp/manifests/<COMPONENT_VERSION>.md` — SHA-256 of every vendor input
    (identical hash = don't re-reverse).
  - `triage/` raw vendor zips, `processed/<COMPONENT_VERSION>/` unpacked — GITIGNORED.
  - `docs/` — GITIGNORED local reference (manuals, datasheets).
  - `*_backups/` — GITIGNORED device dumps (M01 flash, config, pairing data).
- **Evidence tags on every claim:** [HW] measured · [VM] emulator only · [INF] inferred.
- **Before RE work:** read `mdp/STATE.md` (resume point — re-read after compaction)
  and `mdp/SHARP_EDGES.md`.
- **Document first, implement from the doc** (`binary → mdp/*.md → code`).
- JS implementation work **always** goes through the `/implement-js` skill
  (CommonJS, tabs, promises, jest, eslint, yarn).
- Ask the owner before any write to a real device (M01 flash, P906 config, pairing).

## System (as understood so far — [INF])

```
PC ──USB CDC (VCP)──> MDP-M01 (STM32, display/controller) ──nRF24L01 2.4 GHz──> P906 module(s)
```

Two possible control paths: (1) PC→M01 USB serial protocol, (2) talk nRF24 to the
P906 directly, bypassing the M01. See `mdp/STATE.md` for which is being pursued.

## Code

- `bridge/` — nRF52840 (nice!nano) firmware, PlatformIO + Adafruit core. Turns
  USB serial lines into nRF24-compatible ESB packets. Build: `pio run`, then
  `python3 tools/hex2uf2.py .pio/build/nicenano/firmware.hex fw.uf2` and copy
  to the NICENANO drive (send `B` to the running bridge to get the drive).
- `host/` — Node CLI `bin/mdp.js` (pair, handshake, status, set-voltage,
  set-current, output, listen, raw). `yarn test`, `yarn lint`.
- Lab access details: `CLAUDE.local.md` (gitignored).

## Vendor inputs on record

- `mdp/manifests/M01_FW_v2.03.md` — M01 firmware v2.03
- `mdp/manifests/MDP_PC_V1.2.1.md` — PC "Upper Computer" software V1.2.1
