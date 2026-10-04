"""Crops the widget snapshots for the README and builds the animated core strip."""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
BG = (21, 24, 29)  # the snapshot's backdrop, #15181D
PAD = 28


def crop(name):
    img = Image.open(os.path.join(RAW, f"{name}.png")).convert("RGB")
    px = img.load()
    w, h = img.size
    xs, ys = [], []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            if abs(r - BG[0]) + abs(g - BG[1]) + abs(b - BG[2]) > 12:
                xs.append(x)
                ys.append(y)
    box = (max(0, min(xs) - PAD), max(0, min(ys) - PAD), min(w, max(xs) + PAD), min(h, max(ys) + PAD))
    out = img.crop(box)
    out.save(os.path.join(ROOT, f"{name}.png"), optimize=True)
    print(name, out.size)


def core_strip():
    k = 6
    cell = 32 * k
    gap = 56
    labels = [("idle", "대기"), ("working", "작업 중"), ("ask", "질문")]
    width = gap + len(labels) * (cell + gap)
    height = gap // 2 + cell + 64
    font = ImageFont.truetype("malgun.ttf", 22)
    frames = []
    for f in range(12):
        sheet = Image.new("RGB", (width, height), BG)
        dr = ImageDraw.Draw(sheet)
        dr.fontmode = "1"
        for i, (mode, label) in enumerate(labels):
            core = Image.open(os.path.join(RAW, f"core-{mode}-{f}.png")).convert("RGBA")
            core = core.resize((cell, cell), Image.NEAREST)
            x = gap + i * (cell + gap)
            sheet.paste(core, (x, gap // 2), core)
            tw = dr.textlength(label, font=font)
            dr.text((x + (cell - tw) / 2, gap // 2 + cell + 18), label, font=font, fill=(125, 138, 153))
        frames.append(sheet.convert("P", palette=Image.ADAPTIVE, colors=128))
    path = os.path.join(ROOT, "core.gif")
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=110, loop=0, optimize=False, disposal=1)
    print("core.gif", frames[0].size, os.path.getsize(path))


for name in ("question", "panel-chat", "notice"):
    crop(name)
core_strip()
