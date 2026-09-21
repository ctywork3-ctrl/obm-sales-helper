"""Generate the PWA icons for the OBM Sales Helper app.

A store keeper installs this to their home screen, so the icon has to be
recognisable at 48px on a phone launcher: a teal tile with a white fish hook,
which reads as "fishing business" at any size.

Run from `backend/` (Pillow is already a dependency):
    python make_pwa_icons.py
Writes into `../frontend/public/`.
"""

import math
import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "public")

TEAL = (15, 110, 86, 255)      # #0F6E56 — the app's primary
WHITE = (255, 255, 255, 255)


def hook_geometry(size: int, scale: float) -> dict:
    """Geometry for a fish hook, in pixels, for a canvas of `size`.

    Kept explicit rather than inline so the eyelet, shank and barb stay clearly
    separated — at 48px a merged blob just reads as a random squiggle.
    """
    s = scale * size
    cx = cy = size / 2

    eye_r = 0.030 * s
    eye_y = cy - 0.29 * s
    stroke = 0.060 * s

    # A real gap below the eyelet, otherwise the two merge into one blob.
    shank_top = eye_y + eye_r + stroke * 0.55
    bend_y = cy + 0.15 * s
    bend_r = 0.125 * s
    bend_cx = cx + 0.015 * s - bend_r

    return {
        "cx": cx,
        "cy": cy,
        "stroke": stroke,
        "eye": (cx + 0.015 * s, eye_y, eye_r),
        "shank_top": (cx + 0.015 * s, shank_top),
        "bend_y": bend_y,
        "bend_cx": bend_cx,
        "bend_r": bend_r,
        "barb_height": 0.11 * s,
    }


def hook_points(geo: dict) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = [geo["shank_top"]]
    points.append((geo["shank_top"][0], geo["bend_y"]))

    # The bend: a semicircle sweeping left and back up.
    for step in range(1, 41):
        angle = math.radians(180 * step / 40)
        points.append((
            geo["bend_cx"] + geo["bend_r"] * math.cos(angle),
            geo["bend_y"] + geo["bend_r"] * math.sin(angle),
        ))

    # Short rise on the left, then the barb spiking up and outward.
    barb_x = geo["bend_cx"] - geo["bend_r"]
    rise_top = geo["bend_y"] - geo["barb_height"]
    points.append((barb_x, rise_top))
    points.append((barb_x + 0.055 * geo["stroke"] * 1.6, rise_top - 0.035 * geo["stroke"] * 1.6))
    return points


def draw_hook(draw: ImageDraw.ImageDraw, size: int, scale: float) -> None:
    geo = hook_geometry(size, scale)
    stroke = int(geo["stroke"])
    points = hook_points(geo)

    draw.line(points, fill=WHITE, width=stroke, joint="curve")

    # Pillow's thick lines have butt caps; round every vertex so ends and
    # corners look right at small sizes.
    for x, y in (points[0], points[-1], points[-2]):
        r = stroke / 2
        draw.ellipse([x - r, y - r, x + r, y + r], fill=WHITE)

    ex, ey, eye_r = geo["eye"]
    draw.ellipse(
        [ex - eye_r, ey - eye_r, ex + eye_r, ey + eye_r],
        outline=WHITE,
        width=int(stroke * 0.60),
    )


def make_icon(size: int, *, maskable: bool = False) -> Image.Image:
    # Work at 4x and downsample: Pillow has no antialiasing for lines.
    super_size = size * 4
    image = Image.new("RGBA", (super_size, super_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if maskable:
        # Full bleed — the platform applies its own mask, and only the inner
        # 80% is guaranteed visible, so the hook is drawn smaller.
        draw.rectangle([0, 0, super_size, super_size], fill=TEAL)
        scale = 0.60
    else:
        radius = int(super_size * 0.22)
        draw.rounded_rectangle([0, 0, super_size - 1, super_size - 1], radius=radius, fill=TEAL)
        scale = 0.82

    draw_hook(draw, super_size, scale)

    return image.resize((size, size), Image.LANCZOS)


FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0F6E56"/>
  <path d="M34 18 V42 a8 8 0 0 1 -16 0 V36"
        fill="none" stroke="#fff" stroke-width="5"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="34" cy="13" r="3.6" fill="none" stroke="#fff" stroke-width="3.2"/>
  <path d="M18 36 l3.4 -4.6" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
</svg>
"""


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, False),
        ("favicon-64.png", 64, False),
    ]

    for filename, size, maskable in targets:
        path = os.path.join(OUT_DIR, filename)
        make_icon(size, maskable=maskable).save(path, "PNG", optimize=True)
        print(f"  + {filename} ({size}x{size}{', maskable' if maskable else ''})")

    with open(os.path.join(OUT_DIR, "favicon.svg"), "w", encoding="utf-8") as handle:
        handle.write(FAVICON_SVG)
    print("  + favicon.svg")

    print(f"\nWrote icons to {os.path.normpath(OUT_DIR)}")


if __name__ == "__main__":
    main()
