"""
Rasterises the generated face SVG to PNG, so the face can be inspected visually.

Why this exists: neither Edge nor Chromium can run headlessly in the development sandbox (both die
at Chromium's named-pipe IPC, see docs/ENVIRONMENT.md), and no SVG library is installed. PIL is,
so this file implements a rasteriser for the small subset of SVG that `src/renderer/face.ts`
emits: paths, rects, circles, lines and text, plus `<use>` references into the glyph sprite.

It deliberately parses the **real generated SVG** rather than re-deriving the geometry, so what it
draws is genuine renderer output. It is an inspection aid, not a source of truth: the tests and the
browser preview in the user's own browser remain authoritative.

Usage: python scripts/svg_to_png.py <input.svg> <output.png> [scale]
"""
import re
import sys
from xml.etree import ElementTree as ET

from PIL import Image, ImageDraw, ImageFont

SVG_NS = "{http://www.w3.org/2000/svg}"

# The theme tokens, mirrored from src/shared/theme.ts. Kept in sync by hand because they are only
# needed for this inspection tool; a mismatch shows up immediately as wrong colours.
TOKENS = {
    "lcd-background": "#cfd8a0",
    "lcd-texture": "#bcc886",
    "segment-off": "#b6c184",
    "segment-on": "#1b2410",
    "map-band": "#3d4a22",
    "map-land": "#1b2410",
    "case-body": "#141414",
    "case-seam": "#000000",
    "case-edge": "#2a2a2a",
    "case-accent": "#c9a15a",
    "case-text": "#d8d8d8",
    "lcd-bezel": "#0b0b0b",
    "illumination": "#ffb347",
    "dial-ring": "#1b2410",
    "dial-hub": "#1b2410",
}

# Class -> (fill token, opacity). Mirrors src/renderer/preview-css.ts.
CLASS_STYLE = {
    "off": ("segment-off", 0.35),
    "lit": ("segment-on", 1.0),
    "case-body": ("case-body", 1.0),
    "case-seam": ("case-seam", 1.0),
    "pusher": ("case-edge", 1.0),
    "case-print": ("case-text", 1.0),
    "accent": ("case-accent", 1.0),
    "battery-value": ("lcd-background", 0.85),
    "lcd-bezel": ("lcd-bezel", 1.0),
    "lcd-glass": ("lcd-background", 1.0),
    "map-band": ("map-band", 1.0),
    "map-land": ("map-land", 0.85),
    "dial-face": ("lcd-background", 1.0),
    "dial-ring": ("dial-ring", 0.55),
    "dial-tick": ("dial-ring", 1.0),
    "dial-numeral": ("dial-ring", 0.8),
    "dial-hub": ("dial-hub", 1.0),
    "mute-icon": ("segment-on", 1.0),
    "illumination": ("illumination", 0.22),
}


def hex_to_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def classes_of(element):
    return (element.get("class") or "").split()


def style_for(element):
    """Resolves an element's fill and opacity from its classes."""
    names = classes_of(element)
    # `in-band` is a modifier, not a colour of its own: it overrides the base land colour.
    if "in-band" in names:
        for name in names:
            if name in CLASS_STYLE and name != "in-band":
                return ("lcd-background", 0.9)
    for name in names:
        if name in CLASS_STYLE:
            return CLASS_STYLE[name]
    return (None, 1.0)


def parse_path(d):
    """Extracts polygons from the path subset this renderer emits.

    Every segment outline is a uniform `M x y L x y L x y ... Z`, so the coordinates pair up
    directly in order. A hand-rolled command state machine was tried first and silently produced
    nothing, because no `L` ever closed the previous pair; pairing the numbers is both simpler and
    exactly right for this input.

    The decimal point is emitted as an arc, whose parameters are also numbers and would be
    misread as coordinates, so those paths are skipped.
    """
    if "a" in d or "A" in d:
        return []
    numbers = [float(n) for n in re.findall(r"-?\d*\.?\d+(?:[eE]-?\d+)?", d)]
    pairs = [(numbers[i], numbers[i + 1]) for i in range(0, len(numbers) - 1, 2)]
    return [pairs] if len(pairs) >= 3 else []


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1

    src, dst = sys.argv[1], sys.argv[2]
    scale = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0

    tree = ET.parse(src)
    root = tree.getroot()
    view_box = [float(v) for v in root.get("viewBox").split()]
    width = int(view_box[2] * scale)
    height = int(view_box[3] * scale)

    # Collect the sprite: segment path shapes, and which segments each character lights.
    segment_shapes = {}
    symbol_segments = {}
    for defs in root.iter(f"{SVG_NS}defs"):
        for child in defs:
            tag = child.tag.replace(SVG_NS, "")
            if tag == "path" and child.get("id", "").startswith("seg-"):
                segment_shapes[child.get("id")[4:]] = child.get("d")
            elif tag == "symbol":
                lit = []
                for use in child.iter(f"{SVG_NS}use"):
                    href = use.get("href") or use.get("{http://www.w3.org/1999/xlink}href") or ""
                    seg = href.lstrip("#").replace("seg-", "")
                    if "lit" in classes_of(use):
                        lit.append(seg)
                symbol_segments[child.get("id", "").replace("ch-", "")] = lit

    image = Image.new("RGB", (width, height), hex_to_rgb("#0c0e0b"))
    draw = ImageDraw.Draw(image, "RGBA")

    try:
        font = ImageFont.truetype("consola.ttf", max(8, int(13 * scale)))
    except OSError:
        font = ImageFont.load_default()

    def fill_of(name, opacity):
        if name is None:
            return None
        rgb = hex_to_rgb(TOKENS[name])
        return rgb + (int(255 * opacity),)

    # Walk the tree in document order, which is also z-order.
    for element in root.iter():
        tag = element.tag.replace(SVG_NS, "")
        fill_name, opacity = style_for(element)
        colour = fill_of(fill_name, opacity)

        if tag == "path" and element.get("id", "").startswith("seg-"):
            continue  # sprite definitions are not drawn in place
        if tag == "use":
            href = element.get("href") or element.get("{http://www.w3.org/1999/xlink}href") or ""
            char_id = href.lstrip("#").replace("ch-", "")
            lit = symbol_segments.get(char_id)
            if lit is None:
                continue
            x = float(element.get("x") or 0) * scale
            y = float(element.get("y") or 0) * scale
            w = float(element.get("width") or 0) * scale
            h = float(element.get("height") or 0) * scale
            if w <= 0 or h <= 0:
                continue
            # Rebuild the character from the sprite: each of the eight parts is drawn lit or unlit.
            for segment in ["a", "b", "c", "d", "e", "f", "g", "dp"]:
                shape = segment_shapes.get(segment)
                if not shape:
                    continue
                name, op = CLASS_STYLE["lit" if segment in lit else "off"]
                seg_colour = fill_of(name, op)
                for polygon in parse_path(shape):
                    scaled = [(x + px * w / 60.0, y + py * h / 100.0) for px, py in polygon]
                    draw.polygon(scaled, fill=seg_colour)
        elif tag == "rect":
            x = float(element.get("x") or 0) * scale
            y = float(element.get("y") or 0) * scale
            w = float(element.get("width") or 0) * scale
            h = float(element.get("height") or 0) * scale
            if colour and w > 0 and h > 0:
                draw.rectangle([x, y, x + w, y + h], fill=colour)
        elif tag == "circle":
            cx = float(element.get("cx") or 0) * scale
            cy = float(element.get("cy") or 0) * scale
            r = float(element.get("r") or 0) * scale
            if colour and r > 0:
                draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=colour)
        elif tag == "line":
            x1 = float(element.get("x1") or 0) * scale
            y1 = float(element.get("y1") or 0) * scale
            x2 = float(element.get("x2") or 0) * scale
            y2 = float(element.get("y2") or 0) * scale
            if colour:
                width_px = 3
                if "hour" in classes_of(element):
                    width_px = 5
                elif "minute" in classes_of(element):
                    width_px = 3
                draw.line([x1, y1, x2, y2], fill=colour, width=max(1, int(width_px * scale / 2)))
        elif tag == "path":
            if colour:
                for polygon in parse_path(element.get("d", "")):
                    draw.polygon([(px * scale, py * scale) for px, py in polygon], fill=colour)
        elif tag == "text":
            content = (element.text or "").strip()
            if not content:
                continue
            x = float(element.get("x") or 0) * scale
            y = float(element.get("y") or 0) * scale
            anchor = element.get("text-anchor") or "start"
            size = int(13 * scale)
            try:
                text_font = ImageFont.truetype("consola.ttf", size)
            except OSError:
                text_font = font
            text_colour = fill_of(fill_name, opacity) or (216, 216, 216, 255)
            box = draw.textbbox((0, 0), content, font=text_font)
            text_w = box[2] - box[0]
            if anchor == "middle":
                x -= text_w / 2
            elif anchor == "end":
                x -= text_w
            draw.text((x, y - size * 0.8), content, font=text_font, fill=text_colour)

    image.save(dst)
    print(f"wrote {dst} ({width}x{height})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
