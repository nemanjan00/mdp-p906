# File Manifest — M01_FW_v2.03

> SHA-256 of every vendor input this analysis is based on. The files are **not** in
> the repo (gitignored `triage/`, `processed/`). Hash your own copy and confirm it
> matches before trusting findings that cite this version.

## Identity

- **Component:** MDP-M01 display/controller firmware (vendor update package)
- **Version:** v2.03 (build `.001`)
- **Source archive:** `triage/MDP_M01_v2.03.zip` — sha256 `e2f28817b8d18c9d15675876673d753a018ed75401b5a6996e8f7896c2a06c77`
- **Local path:** `processed/M01_FW_v2.03/MDP_M01_v2.03/`
- **Analyzed:** 2026-11-16 (identification only)

## Hashes

| File | Size | Note | SHA-256 |
|------|------|------|---------|
| `MDP_M01_v2.03.001.bin` | 205715 | raw image, load addr 0x08008000 | `1cf05964e207feb245ca5fc5bf2e5d09fd158813773797e638456af6828f46f6` |
| `MDP_M01_v2.03.001-2/MDP_M01_v2.03.001_1.hex` | 288064 | Intel HEX, part 1 of split update | `50ce4b4f7d04a56aaa9521a73afbfad85252e068da897ed6613ad4a9cd35f93f` |
| `MDP_M01_v2.03.001-2/MDP_M01_v2.03.001_2.hex` | 290652 | Intel HEX, part 2 of split update | `fc23dd8b95faa5e0956e2b2218167f74d182e2f29f97d16de7f82fc46c3c5018` |
| `MDP_ADR.ADR` | 10 | ASCII load address for .bin update | `d65ed36063be1c9b6446f13ef2f594f255e9d28e4b03257cc2f9e8c434c0fe97` |
| `readme.txt` | 1875 | vendor update instructions (CN/EN) | `cffc560e940d95a02581bf0f2b14a2cd6e7764e3a9aa90fdc5b93543aa76b618` |
| `MDP_M01_v2.03.001-2/分割hex文件的升级方法.txt` | 1015 | split-hex update instructions | `90a10ad583355b8cfb2c39fb65bc9eccefbcc68ff89484c0f66f7ae22de3f606` |

## Facts from identification pass

- `.bin` is a Cortex-M image: initial SP 0x2000A360, reset vector 0x080396A1,
  linked at 0x08008000 (0x8000 below is the vendor bootloader), image ends
  0x0803A393. [INF — read from vector table, not run]
- `MDP_ADR.ADR` holds the ASCII string `0x08008000` — the .bin load address the
  bootloader's mass-storage DFU uses. [INF]
- Strings show an nRF24L01 radio driver and names `MDP-M01`, `MDP_P90X` → the M01
  talks to P90x power modules over nRF24. [INF]
