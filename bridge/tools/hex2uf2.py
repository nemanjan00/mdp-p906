#!/usr/bin/env python3
"""Intel HEX -> UF2 (nRF52840 family 0xADA52840), 256-byte payload blocks."""
import struct, sys

def read_hex(path):
    mem, base = {}, 0
    for line in open(path):
        line = line.strip()
        if not line.startswith(':'):
            continue
        b = bytes.fromhex(line[1:])
        n, addr, typ = b[0], b[1] << 8 | b[2], b[3]
        if typ == 0:
            for i in range(n):
                mem[base + addr + i] = b[4 + i]
        elif typ == 2:
            base = (b[4] << 8 | b[5]) << 4
        elif typ == 4:
            base = (b[4] << 8 | b[5]) << 16
    return mem

def to_uf2(mem, family=0xADA52840):
    pages = sorted({a & ~0xFF for a in mem})
    out = b''
    for i, p in enumerate(pages):
        data = bytes(mem.get(p + j, 0xFF) for j in range(256))
        hdr = struct.pack('<8I', 0x0A324655, 0x9E5D5157, 0x2000, p, 256, i, len(pages), family)
        out += hdr + data + b'\0' * (476 - 256) + struct.pack('<I', 0x0AB16F30)
    return out

if __name__ == '__main__':
    open(sys.argv[2], 'wb').write(to_uf2(read_hex(sys.argv[1])))
