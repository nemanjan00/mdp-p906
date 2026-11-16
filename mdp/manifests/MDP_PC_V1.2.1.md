# File Manifest — MDP_PC_V1.2.1

> SHA-256 of the vendor PC-software drop. Files are **not** in the repo.

## Identity

- **Component:** "MDP Upper Computer" PC control software + STM32 VCP driver installers
- **Version:** V1.2.1 (manual V1.2)
- **Source archive:** `triage/MDPUpperV1.2.zip` — sha256 `4f9e2eec597d936f74cb6039146218d1811399ec02d6551a59293843b201d2e8`
- **Local path:** `processed/MDP_PC_V1.2.1/`
- **Analyzed:** 2026-11-16 (identification only)

## Hashes

| File | Size | Note | SHA-256 |
|------|------|------|---------|
| `MDP_Software_V1_2_1.exe` | 99921920 | PE32 i386, Qt5, Enigma Virtual Box sections | `a5696cc8bbddb3f301fa4b32e4afad761ec37baf23b0effa9c23ce75a68cf8b0` |
| `MDP Upper Computer Instructions V1.2 EN.pdf` | 1008125 | user manual EN | `4133523850e119b30252b8221fdde2ec86d798aa728776c2117750d28afb7a6a` |
| `MDP上位机软件使用说明 V1.2 CN.pdf` | 1015524 | user manual CN | `e592a050096c36a6660b228b6b4cb33eb8067822d53e14c0d7fae6cd5d162aa0` |
| `driver/VCP_V1.5.0_Setup_W7_x64.exe` (= `_64bits`) | 6906109 | ST VCP driver | `3bb8e1288d4c82f8c96a98cb38e15d216415913618da0ef273563a1fb8229929` |
| `driver/VCP_V1.5.0_Setup_W7_x86.exe` (= `_32bits`) | 6906109 | ST VCP driver | `26ea340dc1aea31e1581675bc6719ff10c3b55989415c48726354c0fcccb14ce` |
| `driver/VCP_V1.5.0_Setup_W8_x64.exe` (= `_64bits`) | 6906109 | ST VCP driver | `118c6d6171bafd75c70043fa92581661909e924355e45e6d5ca5d6e89b49df9e` |
| `driver/VCP_V1.5.0_Setup_W8_x86.exe` (= `_32bits`) | 6906109 | ST VCP driver | `cb03daa4903b9e73405bc3de28d34a98d751d937b02d218963d30ebc0a7187fb` |

Duplicate-named driver installers are byte-identical pairs — analyze neither; it is
the stock ST virtual-COM-port driver (Linux uses `cdc_acm`, no driver needed). [INF]

## Facts from identification pass

- The app talks to the M01 over a USB CDC virtual COM port (hence the ST VCP
  driver). [INF]
- `.enigma1/.enigma2` sections = Enigma Virtual Box packing: Qt DLLs and assets are
  embedded in the EXE. Unpack (e.g. evbunpack) into `processed/` before static work. [INF]
