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

## System

```
PC ──USB serial──> nRF52840 bridge (bridge/) ──nRF24 ESB 2.4 GHz──> P906 module(s)
     host/ (mdp CLI)
```

The direct-radio path is the one in use: it replaces the vendor MDP-M01 display
unit, and pairing, status, set-voltage and output on/off work [HW]. The M01 (and
its PC→M01 USB protocol) is only a reference — its firmware was the first source
for `mdp/PROTOCOL.md`. A clean-room P906 firmware is being explored from static
analysis (`mdp/HARDWARE.md`, [INF]).

## Code

- `bridge/` — nRF52840 Pro Micro clone (nice!nano-compatible) firmware, PlatformIO + Adafruit core. Turns
  USB serial lines into nRF24-compatible ESB packets. Build: `pio run`, then
  `python3 tools/hex2uf2.py .pio/build/nicenano/firmware.hex fw.uf2` and copy
  to the NICENANO drive (send `B` to the running bridge to get the drive).
- `host/` — Node CLI `bin/mdp.js` (pair, handshake, status, set-voltage,
  set-current, output, listen, raw). `yarn test`, `yarn lint`.
- Lab access details: `CLAUDE.local.md` (gitignored).

## Vendor inputs on record

- `mdp/manifests/M01_FW_v2.03.md` — M01 firmware v2.03
- `mdp/manifests/MDP_PC_V1.2.1.md` — PC "Upper Computer" software V1.2.1
- `mdp/manifests/P906_FW_v3.01.md` — P906 module firmware v3.01
