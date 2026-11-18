from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "build/GOLD-3Po/assets")
OUT.mkdir(parents=True, exist_ok=True)

GOLD = (244, 183, 55)
PALE_GOLD = (255, 225, 137)
DARK = (10, 12, 15)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        [r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf"]
        if bold else
        [r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"]
    )
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def gold_gradient(size: tuple[int, int], top=(255, 231, 150), bottom=(166, 94, 10)) -> Image.Image:
    w, h = size
    image = Image.new("RGB", size)
    px = image.load()
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return image


def draw_emblem(size: int = 512) -> Image.Image:
    scale = size / 512
    def s(v: float) -> int:
        return round(v * scale)

    base = Image.new("RGB", (size, size), DARK)
    pix = base.load()
    for y in range(size):
        for x in range(size):
            dx = (x - size * .5) / (size * .65)
            dy = (y - size * .48) / (size * .65)
            glow = max(0.0, 1.0 - dx * dx - dy * dy)
            edge = min(1.0, max(0.0, (1.0 - math.sqrt(dx * dx + dy * dy)) * 2.4))
            pix[x, y] = (
                int(10 + 18 * glow + 3 * edge),
                int(12 + 11 * glow + 2 * edge),
                int(15 + 4 * glow),
            )

    glow_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow_layer)
    # Broad orbital gold crescent, kept behind the bars.
    gd.arc((s(64), s(55), s(448), s(460)), start=195, end=515, fill=(255, 175, 34, 220), width=s(13))
    gd.arc((s(79), s(69), s(433), s(446)), start=198, end=512, fill=(255, 215, 112, 130), width=s(3))
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(s(13)))
    base = Image.alpha_composite(base.convert("RGBA"), glow_layer)

    art = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)
    d.arc((s(64), s(55), s(448), s(460)), start=195, end=515, fill=(199, 126, 24, 255), width=s(7))
    d.arc((s(69), s(60), s(443), s(455)), start=198, end=512, fill=(255, 222, 131, 255), width=s(2))

    # Three exchange-style candlesticks with metallic gold faces.
    bars = [
        (184, 213, 224, 301, 173),
        (250, 126, 294, 260, 96),
        (316, 180, 358, 287, 149),
    ]
    for x1, y1, x2, y2, wick_top in bars:
        d.rectangle((s(x1 + 17), s(wick_top), s(x1 + 19), s(y1)), fill=(255, 216, 105, 255))
        d.rectangle((s(x1 + 17), s(y2), s(x1 + 19), s(y2 + 38)), fill=(237, 166, 42, 255))
        d.rectangle((s(x1), s(y1), s(x2), s(y2)), fill=(217, 146, 29, 255), outline=(255, 222, 132, 255), width=s(2))
        d.line((s(x1 + 3), s(y1 + 3), s(x2 - 3), s(y1 + 3)), fill=(255, 244, 199, 255), width=s(2))
        d.line((s(x1 + 4), s(y1 + 8), s(x1 + 4), s(y2 - 6)), fill=(255, 222, 141, 190), width=s(2))

    # Bid/ask-inspired pixel footprint beneath the candles.
    center_x, baseline = 256, 350
    heights = [12, 21, 32, 49, 27, 17, 39, 59, 34, 20, 43, 30, 15]
    for i, height in enumerate(heights):
        x = center_x + (i - len(heights) // 2) * 15
        for row in range(height // 10):
            yy = baseline + row * 11
            alpha = max(85, 230 - row * 26)
            d.rounded_rectangle((s(x - 4), s(yy), s(x + 4), s(yy + 6)), radius=s(1), fill=(246, 174, 37, alpha))

    art = art.filter(ImageFilter.GaussianBlur(s(0.25)))
    base = Image.alpha_composite(base, art)

    # Thin bright highlights and vignette finish.
    highlight = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    hd.arc((s(64), s(55), s(448), s(460)), start=203, end=292, fill=(255, 244, 193, 230), width=s(2))
    hd.arc((s(64), s(55), s(448), s(460)), start=18, end=98, fill=(255, 205, 92, 210), width=s(2))
    base = Image.alpha_composite(base, highlight)
    return base.convert("RGB")


emblem = draw_emblem(512)
# Multi-resolution Windows application icon.
icon = emblem.resize((256, 256), Image.Resampling.LANCZOS)
icon.save(OUT / "GOLD-3Po.ico", format="ICO",
          sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# Compact logo for the top-right of the setup wizard.
small = emblem.resize((55, 55), Image.Resampling.LANCZOS)
small.save(OUT / "WizardSmallImage.bmp", format="BMP")

# Tall setup wizard brand panel (Inno Setup standard dimensions: 164 x 314).
W, H = 164, 314
panel = Image.new("RGB", (W, H), DARK)
pd = panel.load()
for y in range(H):
    for x in range(W):
        dx = (x - W * .52) / (W * .8)
        dy = (y - H * .38) / (H * .7)
        g = max(0.0, 1.0 - dx * dx - dy * dy)
        pd[x, y] = (int(10 + 10 * g), int(12 + 7 * g), int(15 + 3 * g))

mark = emblem.resize((148, 148), Image.Resampling.LANCZOS)
panel.paste(mark, (8, 35))
draw = ImageDraw.Draw(panel)
draw.line((27, 207, 137, 207), fill=(171, 119, 35), width=1)
title = "GOLD-3Po"
f_title = font(14, True)
box = draw.textbbox((0, 0), title, font=f_title)
draw.text(((W - box[2] + box[0]) / 2, 224), title, font=f_title, fill=(244, 190, 79))
subtitle = "MARKET LAB"
f_sub = font(8, False)
box = draw.textbbox((0, 0), subtitle, font=f_sub)
draw.text(((W - box[2] + box[0]) / 2, 248), subtitle, font=f_sub, fill=(162, 165, 171))
draw.rectangle((0, 0, W - 1, H - 1), outline=(58, 49, 31), width=1)
panel.save(OUT / "WizardImage.bmp", format="BMP")

print(f"Generated installer branding assets in {OUT}")
