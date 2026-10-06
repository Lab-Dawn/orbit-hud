"""Crops the widget snapshots for the README and builds the animated core strip, for
each README language (docs/<lang>/), plus the ring strip every language shares."""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
BG = (21, 24, 29)  # the snapshot's backdrop, #15181D
PAD = 28


LANGS = ("en", "ko", "ja")
CORE_LABELS = {
    "en": ("Idle", "Working", "Asking"),
    "ko": ("대기", "작업 중", "질문"),
    "ja": ("待機中", "作業中", "質問"),
}


def crop(lang, name):
    shot = Image.open(os.path.join(RAW, lang, f"{name}.png")).convert("RGBA")
    img = Image.new("RGBA", shot.size, BG + (255,))
    img.alpha_composite(shot)
    img = img.convert("RGB")
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
    os.makedirs(os.path.join(ROOT, lang), exist_ok=True)
    out.save(os.path.join(ROOT, lang, f"{name}.png"), optimize=True)
    print(lang, name, out.size)


def core_strip(lang):
    k = 6
    cell = 32 * k
    gap = 56
    labels = list(zip(("idle", "working", "ask"), CORE_LABELS[lang]))
    width = gap + len(labels) * (cell + gap)
    height = gap // 2 + cell + 64
    font = label_font(22, lang)
    frames = []
    for f in range(12):
        sheet = Image.new("RGB", (width, height), BG)
        dr = ImageDraw.Draw(sheet)
        dr.fontmode = "1"
        for i, (mode, label) in enumerate(labels):
            core = Image.open(os.path.join(RAW, lang, f"core-{mode}-{f}.png")).convert("RGBA")
            core = core.resize((cell, cell), Image.NEAREST)
            x = gap + i * (cell + gap)
            sheet.paste(core, (x, gap // 2), core)
            tw = dr.textlength(label, font=font)
            dr.text((x + (cell - tw) / 2, gap // 2 + cell + 18), label, font=font, fill=(125, 138, 153))
        frames.append(sheet.convert("P", palette=Image.ADAPTIVE, colors=128))
    path = os.path.join(ROOT, lang, "core.gif")
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=110, loop=0, optimize=False, disposal=1)
    print(lang, "core.gif", frames[0].size, os.path.getsize(path))


def label_font(size, lang="en"):
    # A system font that has the language's letters: Windows first, then macOS.
    names = {
        "ja": ("YuGothM.ttc", "meiryo.ttc", "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"),
        "ko": ("malgun.ttf", "/System/Library/Fonts/AppleSDGothicNeo.ttc"),
    }.get(lang, ())
    for name in names + ("segoeui.ttf", "malgun.ttf", "/System/Library/Fonts/AppleSDGothicNeo.ttc", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def ring_strip():
    # The ring filling with the 5-hour usage; digits only, so every README shares it.
    levels = [(20, (92, 225, 245)), (45, (92, 225, 245)), (70, (245, 184, 65)), (92, (255, 92, 108))]
    k = 5
    cell = 32 * k
    gap = 48
    width = gap + len(levels) * (cell + gap)
    height = gap // 2 + cell + 60
    sheet = Image.new("RGB", (width, height), BG)
    dr = ImageDraw.Draw(sheet)
    font = label_font(26)
    for i, (pct, color) in enumerate(levels):
        core = Image.open(os.path.join(RAW, f"ring-{pct}.png")).convert("RGBA").resize((cell, cell), Image.NEAREST)
        x = gap + i * (cell + gap)
        sheet.paste(core, (x, gap // 2), core)
        text = f"{pct}%"
        tw = dr.textlength(text, font=font)
        dr.text((x + (cell - tw) / 2, gap // 2 + cell + 14), text, font=font, fill=color)
    path = os.path.join(ROOT, "ring.png")
    sheet.save(path, optimize=True)
    print("ring.png", sheet.size)


for lang in LANGS:
    for name in ("question", "panel-chat", "notice"):
        crop(lang, name)
    core_strip(lang)
ring_strip()
