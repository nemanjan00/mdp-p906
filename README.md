# mdp-p906

Open, clean-room tooling to control Miniware MDP-P906 programmable power supplies
from Linux — no MDP-M01 display unit and no vendor Windows software needed.

The P906 is normally driven by the M01 over a 2.4 GHz nRF24 link. This project
replaces the M01 with a cheap nRF52840 board acting as a radio bridge, and a
Node CLI on the PC.

```
PC ──USB serial──> nRF52840 bridge ──2.4 GHz (nRF24 ESB, 2 Mbps)──> P906
     host/ (mdp CLI)     bridge/
```

## Status

Tested on one P906 (firmware v3.01):

| Feature | State |
|---|---|
| Pairing (`pair --direct`) | works |
| Read status (temperature, output state, input voltage, setpoints, V/I readings) | works |
| Set voltage | works — confirmed by poll |
| Output on/off | works — confirmed with an external DMM |
| Set current limit | implemented, unit not yet confirmed on hardware |
| Multiple modules | supported by the protocol (one address per module), untested |

Details and open questions: `mdp/STATE.md`.

## Hardware

- An nRF52840 board with the Adafruit UF2 bootloader (tested: nice!nano).
- The P906 itself. Its USB port is only needed for firmware updates and for its
  own USB drive; control happens over the radio.

## Setup

### Bridge firmware

```sh
cd bridge
pio run
python3 tools/hex2uf2.py .pio/build/nicenano/firmware.hex firmware.uf2
# double-tap reset on the board, then copy firmware.uf2 to the NICENANO drive
```

Once running, the bridge can be put back into the bootloader by sending `B` over
its serial port, so later updates need no button presses.

### Host CLI

```sh
cd host
yarn install
yarn test                # protocol codec tests
```

## Usage

### Pair a P906 (once per module)

1. Start pairing on the PC:
   ```sh
   node bin/mdp.js pair --direct --window 600
   ```
2. On the P906: long-press **MENU**, scroll to **TX and RX Addr**, press **SET**.
   The screen shows "Match RX Addr..".
3. The CLI reports `module confirmed address` and a handshake with the module's
   calibration. The P906 stores the address in `RX_ADDR.TXT` on its USB drive.

Default address is `E0 D3 C2 B1 A0` on channel 78 (2478 MHz), the same as the
M01's first slot. Pair additional modules with their own address, e.g.
`--addr e1d3c2b1a0`.

### Control

```sh
node bin/mdp.js status                # temperature, output, setpoints, readings
node bin/mdp.js set-voltage 3300      # millivolts
node bin/mdp.js set-current 1000      # milliamps (unit still being confirmed)
node bin/mdp.js output on
node bin/mdp.js output off
```

Options: `--port /dev/ttyACM0`, `--addr <hex5>`, `--ch <n>`, `--id <hex4>`
(optional — the module also accepts an all-zero ID).

Notes:
- A set command is answered with a short status; poll `status` to confirm the
  new setpoint.
- `output on/off` doesn't refresh the reply — poll `status` to see the new state.
- `mdp addr-file` prints the `RX_ADDR.TXT` contents for an address/channel —
  an alternative to radio pairing is to copy it onto the P906's USB drive and
  power-cycle it.

## Repository layout

| Path | Contents |
|---|---|
| `mdp/` | Protocol and firmware findings (evidence-tagged), live state, pitfalls, vendor file hashes |
| `bridge/` | nRF52840 bridge firmware (PlatformIO, Arduino/Adafruit core) |
| `host/` | Node CLI and protocol codec, jest tests on synthetic frames |
| `METHODOLOGY.md` | How the findings were derived and how to reproduce them |

## Legal note

This repository contains only facts we extracted (protocol framing, field layouts,
hashes) written in our own words, and our own original code. No vendor firmware,
software, manuals or device dumps are distributed. To reproduce the findings, obtain
the vendor files yourself and check them against the hashes in `mdp/manifests/`.
See `METHODOLOGY.md` for how each finding was derived.
