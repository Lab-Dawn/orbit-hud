"""Builds the blog/project cover (1600x1000) from the widget's own pixel art."""
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

DOCS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(DOCS, "raw")
W, H = 1600, 1000
BG_TOP = (14, 20, 29)
BG_BOTTOM = (6, 9, 14)
CYAN = (92, 225, 245)
INK = (230, 237, 243)
SUB = (125, 138, 153)


def pixel_text(text, size, color, scale):
    """Malgun Gothic with no smoothing, enlarged pixel by pixel: the widget's lettering."""
    font = ImageFont.truetype("malgun.ttf", size)
    probe = ImageDraw.Draw(Image.new("L", (1, 1)))
    box = probe.textbbox((0, 0), text, font=font)
    img = Image.new("RGBA", (box[2] - box[0] + 2, box[3] - box[1] + 2), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    dr.fontmode = "1"
    dr.text((-box[0] + 1, -box[1] + 1), text, font=font, fill=color + (255,))
    return img.resize((img.width * scale, img.height * scale), Image.NEAREST)


def crop_card(name):
    """The card alone from a widget picture: the columns left of the gap before the core."""
    shot = Image.open(os.path.join(RAW, f"{name}.png")).convert("RGBA")
    px = shot.load()
    w, h = shot.size
    busy = [any(px[x, y][3] > 40 for y in range(0, h, 2)) for x in range(w)]
    x = w - 1
    while x > 0 and not busy[x]:
        x -= 1
    while x > 0 and busy[x]:  # the core
        x -= 1
    while x > 0 and not busy[x]:  # the gap
        x -= 1
    right = x + 1
    rows = [y for y in range(h) if any(px[c, y][3] > 40 for c in range(0, right, 2))]
    cols = [c for c in range(right) if busy[c]]
    card = shot.crop((min(cols), min(rows), right + 6, max(rows) + 6))
    # The widget draws cards solid; the picture's soft alpha would let the backdrop through.
    r, g, b, a = card.split()
    a = a.point(lambda v: 255 if v > 8 else 0)
    return Image.merge("RGBA", (r, g, b, a))


def drop_shadow(card, offset=10, blur=18, alpha=150):
    pad = blur * 2
    shadow = Image.new("RGBA", (card.width + pad * 2, card.height + pad * 2), (0, 0, 0, 0))
    mask = Image.new("L", card.size, alpha)
    shadow.paste((0, 0, 0, 255), (pad + offset, pad + offset), mask)
    return shadow.filter(ImageFilter.GaussianBlur(blur)), pad


def main():
    # Backdrop: a dark vertical gradient with a faint pixel grid of dots.
    base = Image.new("RGB", (W, H))
    dr = ImageDraw.Draw(base)
    for y in range(H):
        t = y / H
        dr.line([(0, y), (W, y)], fill=tuple(int(BG_TOP[i] * (1 - t) + BG_BOTTOM[i] * t) for i in range(3)))
    canvas = base.convert("RGBA")
    dots = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dots)
    for y in range(20, H, 40):
        for x in range(20, W, 40):
            dd.rectangle([x, y, x + 2, y + 2], fill=(125, 138, 153, 26))
    canvas = Image.alpha_composite(canvas, dots)

    # The core, large, with a soft cyan halo and a dotted orbit around it.
    cx, cy, k = 1152, 500, 13
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    for r, a in ((330, 22), (250, 34), (190, 46)):
        hd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=CYAN + (a,))
    canvas = Image.alpha_composite(canvas, halo.filter(ImageFilter.GaussianBlur(70)))

    orbit = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(orbit)
    for radius, step, alpha in ((300, 4, 70), (380, 6, 40)):
        for deg in range(0, 360, step):
            a = math.radians(deg)
            x = round((cx + radius * math.cos(a)) / 6) * 6
            y = round((cy + radius * math.sin(a)) / 6) * 6
            od.rectangle([x, y, x + 5, y + 5], fill=CYAN + (alpha,))
    # Three satellites riding the inner orbit: the sessions.
    for deg, color in ((240, (180, 155, 255)), (300, (74, 222, 128)), (25, CYAN)):
        a = math.radians(deg)
        x = round((cx + 300 * math.cos(a)) / 6) * 6
        y = round((cy + 300 * math.sin(a)) / 6) * 6
        od.rectangle([x - 12, y - 12, x + 17, y + 17], fill=(6, 9, 13, 255))
        od.rectangle([x - 6, y - 6, x + 11, y + 11], fill=color + (255,))
        od.rectangle([x, y, x + 5, y + 5], fill=(242, 255, 255, 255))
    canvas = Image.alpha_composite(canvas, orbit)

    core = Image.open(os.path.join(RAW, "core-working-2.png")).convert("RGBA")
    core = core.resize((32 * k, 32 * k), Image.NEAREST)
    canvas.alpha_composite(core, (cx - core.width // 2, cy - core.height // 2))

    # The cards that slide out of it: a question and a finished task.
    question = crop_card("question")
    question = question.resize((question.width // 2, question.height // 2), Image.NEAREST)
    notice = crop_card("notice")
    notice = notice.resize((notice.width // 2, notice.height // 2), Image.NEAREST)
    # The question stands beside the core as the widget shows it; the notice below.
    for card, (x, y) in ((question, (470, cy - 146)), (notice, (930, cy + 32 * k // 2 + 84))):
        shadow, pad = drop_shadow(card)
        canvas.alpha_composite(shadow, (x - pad, y - pad))
        canvas.alpha_composite(card, (x, y))

    # Title block, in the widget's pixel lettering.
    title = pixel_text("Orbit HUD", 15, INK, 6)
    canvas.alpha_composite(title, (96, 96))
    accent = Image.new("RGBA", (84, 8), CYAN + (255,))
    canvas.alpha_composite(accent, (104, 96 + title.height + 26))
    line1 = pixel_text("Claude Code 세션을", 13, SUB, 3)
    line2 = pixel_text("코어 하나로 지켜본다", 13, SUB, 3)
    canvas.alpha_composite(line1, (100, 96 + title.height + 62))
    canvas.alpha_composite(line2, (100, 96 + title.height + 62 + line1.height + 14))

    # What it does, one line each, with a small square in each state's colour.
    y = 96 + title.height + 62 + line1.height * 2 + 14 + 70
    for color, text in ((CYAN, "작업 중인 세션은 코어가 빛나고"), ((180, 155, 255), "질문은 위젯에서 바로 답하고"),
                        ((245, 184, 65), "컨텍스트는 게이지 한 번에 압축"), ((74, 222, 128), "끝나면 알림이 잠깐 나온다")):
        mark = Image.new("RGBA", (10, 10), color + (255,))
        canvas.alpha_composite(mark, (104, y + 9))
        line = pixel_text(text, 11, (197, 206, 216), 2)
        canvas.alpha_composite(line, (128, y))
        y += line.height + 18

    out = os.path.join(DOCS, "cover.jpg")
    canvas.convert("RGB").save(out, quality=92, optimize=True)
    print(out, canvas.size, os.path.getsize(out))


if __name__ == "__main__":
    main()
