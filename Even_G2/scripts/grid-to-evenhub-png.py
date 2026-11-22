#!/usr/bin/env python3
"""Convert a 12x12 pixel grid into Even Hub's 24x24 white PNG icon."""

from pathlib import Path
import struct
import zlib


ROOT = Path(__file__).resolve().parents[1]
grid_path = ROOT / "icons/custom/Capri Terminal 24.grid"
output_path = ROOT / "icon.png"
rows = grid_path.read_text(encoding="utf-8").splitlines()

if len(rows) != 12 or any(len(row) != 12 for row in rows):
    raise SystemExit("Expected exactly 12 rows of 12 cells")
if any(cell not in ".#" for row in rows for cell in row):
    raise SystemExit("Grid may contain only '.' and '#' characters")

pixels = []
for row in rows:
    expanded = []
    for cell in row:
        rgba = (244, 244, 244, 255) if cell == "#" else (0, 0, 0, 0)
        expanded.extend([rgba, rgba])
    pixels.extend([expanded, expanded])


def chunk(kind: bytes, payload: bytes) -> bytes:
    body = kind + payload
    return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


scanlines = b"".join(b"\x00" + b"".join(bytes(pixel) for pixel in row) for row in pixels)
png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">2I5B", 24, 24, 8, 6, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(scanlines, 9))
    + chunk(b"IEND", b"")
)
output_path.write_bytes(png)
print(f"Wrote {output_path} ({len(png)} bytes)")
