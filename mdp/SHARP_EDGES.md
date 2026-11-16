# MDP-P906 (via MDP-M01) — sharp edges (read BEFORE working)

Rig- and tool-specific gotchas that already cost time. Each entry: **symptom → real
cause → fix.** Append the moment one bites, with an evidence tag ([HW]/[VM]/[INF]).
The pitfalls that generalize to other targets go in `METHODOLOGY.md` instead.

## Vendor update / pairing

- **M01 firmware update path is a mass-storage DFU** (hold A while plugging USB,
  copy .hex; renamed to .rdy on success). Vendor notes say crossing v1.20/1.21→1.22+
  needs the M01 USB drive reformatted and the **wireless address re-paired** —
  treat any firmware change as able to wipe pairing/config. Back up the M01's USB
  drive contents first. [INF — from vendor readme, untested]

## Static analysis

- **M01 .bin is linked at 0x08008000, not 0x08000000** — load it there in IDA or
  every pointer is off by 0x8000. (`MDP_ADR.ADR` states the same address.) [INF]
- **Load the M01 image as ARMv7-M (32-bit Thumb), not plain "arm"** — the plain
  ARM processor choice gave an AArch64 database with zero functions. Also set T=1
  and seed functions from the vector table. [HW — tool behaviour]
- **RW-data constants (pairing address, default channel) aren't in the image
  verbatim** — the C runtime LZ-decompresses them into RAM at 0x20000000 at boot.
  Decode the scatter-load table (handler-relative entries) first; don't grep the
  .bin for `FF FF FF FF FF`. [INF]
- **PC app is Enigma-Virtual-Box packed** — the 100 MB EXE embeds Qt DLLs/assets;
  unpack before analysis or you'll be reading the loader. [INF]

## Radio

- **nRF24 addresses are written LSB first over SPI** — the bytes `E0 D3 C2 B1 A0`
  in firmware are the address 0xA0B1C2D3E0. ESB libraries on nRF52 split it into
  prefix (LSB) + base; get this wrong and nothing ACKs. [INF]
- **Fixed 32-byte payload, no DPL** — configure ESB fixed-length; a DPL-mode
  sender's packet control field won't match. [INF]
- **Pairing can overwrite a module's stored address** — read its "Tx and Rx Addr"
  page and record it before any pairing attempt. [INF]

## Bridge (nice!nano / nRF52840)

- **Board wedged, USB dead** — a busy-wait timed with `micros()` while
  interrupts were off never ended (micros doesn't advance then) and froze USB too.
  **Fix:** cycle counter for timing, every wait capped, 2 s hardware watchdog. [HW]
- **Getting back to the bootloader without hands:** send `B` (calls
  `enterUf2Dfu()`). The 1200-baud touch did *not* work — it reset into the app. [HW]
- **`uhubctl -a cycle` on the lab hub hung** and left the port powered but not
  enumerating for minutes; it recovered on its own. Prefer `B` or ask the owner. [HW]
- **The module's ACK must look like its own header** — echo its S0 byte (length
  bits `110011` + PID), zero payload. With length bits 0 it kept retransmitting.
  Receive its ACKs with a fixed zero-length layout, not dynamic length. [HW]
- **ACK sent too early (current hypothesis, [INF])** — an nRF24 PTX needs ~130 µs
  after its packet to be in RX; the nRF52 fast ramp-up put our ACK on air ~50 µs
  after the packet, so the module never saw it, retransmitted (DUP) and — since
  it commits pairing only on TX_DS — never saved the address. Bridge now waits
  `D` µs (default 130) before each ACK; `S` reports received/duplicate counts.
- **Pairing replies are timing-sensitive** — the module answers a beacon only
  sometimes; a 30 ms listen window via USB round trips caught it in 2 of 4
  sessions. [HW]

## Host (node)

- **node-serialport 13 on Node 26 delivered each read only on the next write**
  (replies ~500 ms late → every command timed out). **Fix:** open the tty with
  O_NONBLOCK, `stty raw`, read via `tty.ReadStream`. A blocking `fs` read stream
  instead hangs `process.exit`. [HW]
- **First write after open can be dropped** by the CDC link — `open()` pings
  `?` until it gets a real `OK`. [HW]

## Lab host

- **A listener started with `nohup … &` (or `setsid`) over SSH died** — once at
  session close, once immediately — so the beacon wasn't running when the owner
  pressed SET. **Fix:** run long jobs as a transient user unit:
  `systemd-run --user --unit=mdp-pair --working-directory=/tmp/mdp-host node bin/mdp.js pair --window 3600`,
  watch with `journalctl --user -u mdp-pair -f`. Always check it is still alive
  before telling the owner to act. [HW]

## Test / measurement

- **A lost ACK ≠ not written** — read back before deciding.
- **Liveness = a real reply** (serial/voltage reading), never "the port opened".
