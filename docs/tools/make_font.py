"""Packs Galmuri's bitmap fonts (BDF) into small scripts the widget draws from.

Browsers smooth every font they draw, which fills the one-pixel gaps a pixel font
relies on (the strokes of 제 run together). Drawing the font's own bitmaps instead
keeps every glyph exactly as designed, the same on Windows and macOS.

    python docs/tools/make_font.py <galmuri dist folder>

The galmuri npm package has the .bdf files in dist/. Galmuri is under the SIL Open
Font License 1.1 (app/fonts/Galmuri-OFL.txt); this is a format conversion of it.
"""
import base64
import os
import re
import struct
import sys

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "app", "fonts")


def pack(bdf_path, name):
    text = open(bdf_path, encoding="utf-8", errors="replace").read()
    ascent = int(re.search(r"^FONT_ASCENT (\d+)", text, re.M).group(1))
    descent = int(re.search(r"^FONT_DESCENT (\d+)", text, re.M).group(1))
    out = bytearray()
    count = 0
    for block in re.finditer(r"STARTCHAR.*?\nENCODING (-?\d+)\n(.*?)ENDCHAR", text, re.S):
        cp = int(block.group(1))
        body = block.group(2)
        if cp < 0:
            continue
        dwidth = int(re.search(r"DWIDTH (-?\d+)", body).group(1))
        w, h, xo, yo = (int(v) for v in re.search(r"BBX (-?\d+) (-?\d+) (-?\d+) (-?\d+)", body).groups())
        rows = body.split("BITMAP\n", 1)[1].split()
        per_row = (w + 7) // 8
        bits = bytearray()
        for row in rows[:h]:
            bits += int(row, 16).to_bytes(len(row) // 2, "big")[:per_row].ljust(per_row, b"\0")
        # code point (3 bytes), advance, width, height, x offset, y offset, then the rows
        out += cp.to_bytes(3, "big") + struct.pack("BBBbb", max(0, dwidth), w, h, xo, yo) + bits
        count += 1
    data = base64.b64encode(bytes(out)).decode()
    path = os.path.join(OUT, f"{name}.js")
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"// Galmuri ({name}), bitmap glyphs packed by docs/tools/make_font.py. SIL OFL 1.1, see Galmuri-OFL.txt.\n")
        f.write(f"window.GalmuriFonts = window.GalmuriFonts || {{}}\n")
        f.write(f"window.GalmuriFonts[{name!r}] = {{ ascent: {ascent}, descent: {descent}, data: '{data}' }}\n")
    print(name, count, "glyphs", os.path.getsize(path), "bytes")


if __name__ == "__main__":
    dist = sys.argv[1]
    pack(os.path.join(dist, "Galmuri11.bdf"), "galmuri11")
    pack(os.path.join(dist, "Galmuri14.bdf"), "galmuri14")
