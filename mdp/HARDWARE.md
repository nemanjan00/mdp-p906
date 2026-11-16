# MDP-P906 — hardware map (from firmware v3.01)

Static analysis of `MDP_P906_v3.01.bin` (manifest: `mdp/manifests/P906_FW_v3.01.md`),
loaded at 0x08008000. Addresses `@0x…` are in that image. **Everything here is
[INF]** — read from code, not yet measured on a board. Goal: enough to judge and
start a clean-room firmware reimplementation.

## MCU

- STM32F103 high-density class (or a register-compatible clone): the firmware
  uses DAC, TIM8, ADC3, DMA2, FSMC-range addresses and GPIOE → 100-pin
  package likely (e.g. F103VC/VE). Exact part to be confirmed (chip marking or
  DBGMCU_IDCODE).
- Vendor bootloader occupies 0x08000000–0x08007FFF (not in the update package);
  application at 0x08008000. Keep the bootloader → DFU-drive recovery stays.

## Peripheral map

| Function | Peripheral / pins | Code |
|---|---|---|
| Voltage setpoint, coarse | TIM8 CCR2 (PWM, 0–1800 scale) | `@0x8017424` |
| Voltage setpoint, fine | DAC channel 1 (DHR12R1) | `@0x8017424` → `@0x801D55C` |
| Current-limit setpoint, coarse | TIM8 CCR1 | `@0x8017544` |
| Current-limit setpoint, fine | DAC channel 2 (DHR12R2) | `@0x8017544` → `@0x801D564` |
| Fan | TIM4 CCR2, duty from temperature | `@0x80179F8` |
| Measurements | ADC1/2/3 with DMA1/DMA2 | `@0x80142AC`, `@0x80144E8`, `@0x8014634` |
| Radio (nRF24L01) | SPI1, CE/CSN on GPIOD/GPIOA bit-band | `@0x8014750`, `@0x801882C` |
| USB-drive storage | SPI2 (PB12 CS, PB13 SCK, PB14 MISO, PB15 MOSI) → W25Q64, 8 MB, JEDEC ID check 0xEF16 | `@0x8014896`, `@0x8010CF0` |
| Display | bit-banged I²C bus 0: PB6 SCL, PB7 SDA | `@0x801C4BA`–`@0x801C5D0` |
| Second I²C device (unknown) | bit-banged I²C bus 1: PB10 SCL, PB11 SDA | same routines, bus flag 1 |
| Boot-mode buttons | PB8 / PB9 held at power-up → CALIBRATE / CHECK mode | `@0x801114C` |
| USB device (drive) | USB FS + FAT on the W25Q64 | `@0x801C6F4`… |

## Output stage — how a setpoint is produced

Each setpoint drives two outputs: a coarse PWM (filtered to an analog level) and
a fine DAC value. In our words, for voltage `mV`:

1. `v = mV + zero_offset` (clamped at 0).
2. Segment `s = v / 300` (300 mV segments); remainder `r = v % 300`.
3. Coarse PWM count = `pwm_base + table[s] + 300·(1750 − pwm_base)·s / K`,
   written to TIM8 CCR2 scaled from the 0–1800 range to the timer period.
4. Fine DAC value interpolates `r` within the segment using the DAC offset and
   DAC gain (12-bit, top at 3840).

Current works the same with `mA/2` and 50-count (100 mA) segments, TIM8 CCR1 and
DAC channel 2. `table[]` is a per-segment int16 correction table; `pwm_base`,
`K`, DAC offset/gain and zero offset come from the calibration parameters.

Whether regulation is closed in analog hardware (the PWM/DAC just set the
reference) or in firmware is not settled yet — no firmware control loop has been
identified so far, which points to an analog loop with digital references. [INF]

## Calibration

Two text files on the USB drive, named after the module ID (`%08X`), each line
`Name=value` with CRLF; parsers read values in order and ignore the names.

- **`<ID>.CFG`** — the factory measurement points (~32 values). Reader
  `@0x80088A0` range-checks the key ones; a copy is kept in internal flash
  (`Fix_Balance_StmFlash_Data`). The factory procedure (`@0x800D074`, driven by
  a test rig via `CALIBRATE_*` commands) measures: output voltage at 10 mV,
  299 mV, 27 V, 28 V; output current at 10 mA, 98 mA, 5000 mA; input voltage at
  30 V; then self-checks output V/I and short-circuit.
- **`<ID>.PRM`** — the derived parameters, 10 values (reader `@0x800E8F0`):
  per channel (voltage, then current) `pwm_base` (<1801), `K` (decimal `a.b`),
  DAC offset (<4096), DAC gain (decimal), zero offset (V ±64 mV, I ±16 mA).
  Computed from the CFG points by "Method3" (`@0x800B15C`).
- Handshake reply calibration words (radio type 0x09) are separate: they convert
  the raw ADC samples in status frames to mV/mA (see `PROTOCOL.md`).
- Holding PB8 or PB9 at power-up enters CALIBRATE / CHECK mode
  (`@0x801114C`) — the vendor's recalibration path (owner used it in 2023).

## Display

- 128×32 monochrome OLED, SSD1306-family command set: page address
  `0xB0 + page` (4 pages), column `0x10 | col>>4`, `col & 0x0F`.
- I²C address 0x78 (8-bit; 7-bit 0x3C), control byte 0x00 = command,
  0x40 = data. Bit-banged on PB6/PB7.
- Framebuffer 128×4 bytes in RAM; flush (`@0x8010366`) reverses bit order and
  page order → panel is mounted rotated 180°.
- Fonts: 6×8 and 8×16 ASCII (0x20–0x7E), plus image glyphs for translated UI.
- **No init sequence found in the application** — likely done by the vendor
  bootloader (it already shows the DFU screen). A reimplementation must send its
  own init; start from a standard 128×32 SSD1306 init and verify on the board.

## Open

- Exact MCU part; TIM8/DAC output filter and the analog loop (needs the board or
  a schematic photo).
- The second I²C device on PB10/PB11 (USB-PD controller? current-sense ADC?).
- CFG field names/order and the Method3 math in detail (`@0x800B15C`).
- Measurement chain: which ADC channels are output V, output I, input V, temp.
