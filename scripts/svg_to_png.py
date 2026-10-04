"""
Rasterises the generated face SVG to PNG, so the face can be inspected visually.

Why this exists: neither Edge nor Chromium can run headlessly in the development sandbox (both die
at Chromium's named-pipe IPC, see docs/ENVIRONMENT.md), and no SVG library is installed. PIL is,
so this file implements a rasteriser for the small subset of SVG that `src/renderer/face.ts`
emits: paths, rects, circles, lines and text, plus `<use>` references into the glyph sprite.

It deliberately parses the **real generated SVG** rather than re-deriving the geometry, so what it
draws is genuine renderer output. It is an inspection aid, not a source of truth: the tests and the
browser preview in the user's own browser remain authoritative.

**It does not implement SVG, and it must not be the only thing that has looked at a change.** What it
can no longer do is disagree with the renderer about *colour*: the palette is read out of the SVG's own
`<style>` block (`parse_stylesheet`) instead of being transcribed into this file a second time. That
mattered, because the transcription is how a previous colour pass could have been "reviewed" against an
image drawn in the old palette. Geometry, stroke joins, the CSS cascade, `mix-blend-mode` and text
metrics beyond a single monospace face are still approximations.

Usage: python scripts/svg_to_png.py <input.svg> <output.png> [scale] [--label TEXT]

`--label` is a review watermark. It stamps the text across the top band in a **real system font**
drawn by PIL, *after* the SVG has been rasterised — so unlike anything inside the SVG, the label cannot
be affected by a rendering fault in the SVG itself. That matters: the digits on the face once came out
blank in a real browser while this rasteriser drew them perfectly, so a reviewer needs a marker that is
independent of the thing under review. The text is sized from the image, so it stays legible at any
scale.

The wrapping is deliberate. A long label is broken onto multiple lines inside the top band rather than
being clipped, because a truncated label is exactly as useless as no label.
"""
import re
import sys
from xml.etree import ElementTree as ET

from PIL import Image, ImageDraw, ImageFont

SVG_NS = "{http://www.w3.org/2000/svg}"

# The draw order for a character's eight parts. The sprite defines them as `seg-<name>`.
SEGMENTS = ["a", "b", "c", "d", "e", "f", "g", "dp"]

# CSS custom properties used by the **page chrome** this tool draws around the face, which the face's
# stylesheet does not carry. The face's own colours are never listed here: they are parsed out of the
# SVG's <style> block (see `parse_stylesheet`), so this tool cannot drift from what the renderer emits.
PAGE_TOKENS = {
    "page-bg": "#0c0e0b",
}


def parse_stylesheet(text):
    """Reads the face's own stylesheet out of the SVG and returns (tokens, class styles).

    ## Why this replaced a hard-coded table

    This tool used to mirror the theme twice — a `TOKENS` dict and a `CLASS_STYLE` dict — by hand, in
    Python. That made it a **third** copy of the colour model, after `theme.ts` and the preview CSS, and
    the copies silently disagreed the moment a colour pass changed one of them: the rasteriser would keep
    drawing the old palette while reporting on the new artefact. A verification tool that reimplements
    the thing it verifies cannot catch a fault in that thing, and this project has already paid for that
    lesson once with the sprite lookup.

    So the table is not maintained any more; it is *parsed*. `renderFace()` embeds `themeCss()` in a
    `<style>` block, which is exactly the appearance a renderer receives, so reading it means the image
    is derived from the artefact under review rather than from a parallel transcription of it.

    Handles the subset actually emitted: `:root, .watch { --token: value; }` for the custom properties,
    and `.watch .class { fill: ...; opacity: n }` for the rules. `stroke` and `stroke-width` are read
    too: the case seam, the pushers, the screws and the subdial's ring are all strokes, so a tool that
    ignored them would draw those parts as shapeless fills and misreport the case's appearance.
    """
    tokens = dict(PAGE_TOKENS)
    for name, value in re.findall(r"--([\w-]+)\s*:\s*([^;}]+)", text):
        tokens[name] = value.strip()

    styles = {}
    for selector, body in re.findall(r"([^{}]+)\{([^{}]*)\}", text):
        fill = re.search(r"fill\s*:\s*([^;}]+)", body)
        stroke = re.search(r"stroke\s*:\s*([^;}]+)", body)
        if not fill and not stroke:
            continue
        opacity = 1.0
        op = re.search(r"(?<!stroke-)opacity\s*:\s*([\d.]+)", body)
        if op:
            opacity = float(op.group(1))
        width = re.search(r"stroke-width\s*:\s*([\d.]+)", body)
        font_size = re.search(r"font-size\s*:\s*([\d.]+)", body)
        entry = {
            "fill": fill.group(1).strip() if fill else None,
            "stroke": stroke.group(1).strip() if stroke else None,
            "width": float(width.group(1)) if width else 1.0,
            "font-size": float(font_size.group(1)) if font_size else None,
            "opacity": opacity,
        }
        for cls in re.findall(r"\.([a-zA-Z][\w-]*)", selector):
            styles[cls] = entry
    return tokens, styles


def text_size_for(element, styles):
    """A text element's font size, from the most specific class rule that declares one.

    The renderer sizes text by class rather than by attribute, so reading it from the stylesheet is the
    only way to draw the face's text at the size a browser would. Without this every label came out at
    one default size, which made the bezel lettering and the 9px indicators equally large.
    """
    classes = classes_of(element)
    # Later classes in the list win, matching the order the renderer emits them.
    for name in reversed(classes):
        rule = styles.get(name)
        if rule and rule["font-size"]:
            return rule["font-size"]
    return 13.0


def resolve_colour(value, tokens, opacity):
    """Turns a `fill` value into an RGBA tuple, following `var(--token)` into the parsed tokens."""
    value = value.strip()
    var = re.match(r"var\(\s*--([\w-]+)\s*\)", value)
    if var:
        value = tokens.get(var.group(1))
        if value is None:
            return None
        value = value.strip()
    if not value.startswith("#") or len(value) != 7:
        return None
    return hex_to_rgb(value) + (int(255 * opacity),)


def hex_to_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def classes_of(element):
    return (element.get("class") or "").split()


def resolve_paint(element):
    """An element's paint, from an inline `fill` attribute first and then from its classes.

    The inline attribute takes precedence because that is the SVG cascade: a presentation attribute is
    overridden by a stylesheet rule, but this tool has no full CSS cascade, so the attribute is all it
    can honour. Honouring it matters more than it sounds — a probe written with an inline `fill` was
    silently rasterised in the token colour instead, which made a correct glyph look wrong.
    """
    inline = element.get("fill")
    if inline and inline.startswith("#") and len(inline) == 7:
        return (inline, 1.0)
    return None


def style_for(element, styles):
    """Resolves an element's paint from an inline attribute first, then from its classes."""
    inline = resolve_paint(element)
    if inline is not None:
        return {"fill": inline, "stroke": None, "width": 1.0, "opacity": 1.0}

    names = classes_of(element)
    # `in-band` is a modifier, not a colour of its own: land inside the lit band is drawn in the LCD's
    # lit colour so it stays readable against the band (requirement MAP-6).
    if "in-band" in names:
        return {"fill": "var(--lcd-lit)", "stroke": None, "width": 1.0, "opacity": 0.9}
    for name in names:
        if name in styles:
            return styles[name]
    return {"fill": None, "stroke": None, "width": 1.0, "opacity": 1.0}


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


def load_font(size):
    """A real TrueType face, falling back to PIL's bitmap font only if Windows has none.

    `consola.ttf` first because it is monospaced, which makes a label's digits line up with the
    watch's own — then `arial.ttf`, then the default. PIL's default font is a 1980s bitmap face that
    cannot scale, so it is a last resort rather than a preference.
    """
    for name in ("consola.ttf", "arial.ttf", "segoeui.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def wrap_to_width(draw, text, font, max_width):
    """Greedy word wrap, so a long label is never clipped."""
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def stamp_label(image, label):
    """Draws the review watermark: one band across the top, in a real font.

    Sized from **both** dimensions. Sizing from width alone is what the first version did, and on a wide,
    short image — a probe sheet of one glyph row — it produced a font big enough that the band consumed
    the entire picture. A watermark that hides the thing it is labelling is worse than none.

    Only the **top** band is drawn. The first version also drew a bottom band, which meant every labelled
    image had a strip of the case print hidden under a solid rectangle, including the `10 YEAR BATTERY`
    line the label was often describing. The top-left corner of these images carries nothing but case
    material, so it is the one place a band costs no information.
    """
    width, height = image.size
    draw = ImageDraw.Draw(image, "RGBA")
    padding = max(4, int(min(width, height) * 0.02))

    # Shrink until the wrapped label fits in a band no taller than a third of the image.
    size = max(10, int(width / 40))
    lines = []
    while size >= 10:
        font = load_font(size)
        lines = wrap_to_width(draw, label, font, int(width - padding * 2))
        line_height = size + max(2, int(size * 0.2))
        if len(lines) * line_height + padding * 2 <= height * 0.34:
            break
        size = int(size * 0.85)

    font = load_font(size)
    line_height = size + max(2, int(size * 0.2))
    band_height = len(lines) * line_height + padding * 2

    draw.rectangle([0, 0, width, band_height], fill=(12, 14, 11, 240))
    draw.line([0, band_height - 1, width, band_height - 1], fill=(201, 161, 90, 255), width=max(1, size // 8))

    y = padding
    for line in lines:
        text_width = draw.textlength(line, font=font)
        draw.text(((width - text_width) / 2, y), line, font=font, fill=(216, 216, 216, 255))
        y += line_height

    return image


def main():
    args = [a for a in sys.argv[1:]]
    label = None
    if "--label" in args:
        index = args.index("--label")
        if index + 1 >= len(args):
            print("--label needs a value", file=sys.stderr)
            return 1
        label = args[index + 1]
        del args[index : index + 2]

    if len(args) < 2:
        print(__doc__)
        return 1

    src, dst = args[0], args[1]
    scale = float(args[2]) if len(args) > 2 else 2.0

    tree = ET.parse(src)
    root = tree.getroot()
    view_box = [float(v) for v in root.get("viewBox").split()]
    width = int(view_box[2] * scale)
    height = int(view_box[3] * scale)

    # The face's appearance is read from the stylesheet it carries, not from a table in this file.
    style_text = "".join(node.text or "" for node in root.iter(f"{SVG_NS}style"))
    tokens, styles = parse_stylesheet(style_text)
    if "segment-on" not in tokens:
        # Fail loudly rather than drawing a face in substituted colours: a silent substitution is
        # exactly how this tool spent a whole project agreeing with itself instead of the browser.
        print(f"no stylesheet found in {src} - it must carry its own tokens", file=sys.stderr)
        return 1

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
        """A resolved `fill` value to an RGBA tuple, following `var()` into the parsed tokens."""
        if name is None:
            return None
        return resolve_colour(name, tokens, opacity)

    # Walk the tree in document order, which is also z-order.
    for element in root.iter():
        tag = element.tag.replace(SVG_NS, "")
        style = style_for(element, styles)
        colour = fill_of(style["fill"], style["opacity"])
        stroke = fill_of(style["stroke"], style["opacity"])
        stroke_px = max(1, int(style["width"] * scale))

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
            for segment in SEGMENTS:
                shape = segment_shapes.get(segment)
                if not shape:
                    continue
                rule = styles["lit" if segment in lit else "off"]
                seg_colour = fill_of(rule["fill"], rule["opacity"])
                for polygon in parse_path(shape):
                    scaled = [(x + px * w / 60.0, y + py * h / 100.0) for px, py in polygon]
                    draw.polygon(scaled, fill=seg_colour)
        elif tag == "rect":
            x = float(element.get("x") or 0) * scale
            y = float(element.get("y") or 0) * scale
            w = float(element.get("width") or 0) * scale
            h = float(element.get("height") or 0) * scale
            if w > 0 and h > 0:
                draw.rectangle(
                    [x, y, x + w, y + h],
                    fill=colour,
                    outline=stroke,
                    width=stroke_px if stroke else 0,
                )
        elif tag == "circle":
            cx = float(element.get("cx") or 0) * scale
            cy = float(element.get("cy") or 0) * scale
            r = float(element.get("r") or 0) * scale
            if r > 0:
                draw.ellipse(
                    [cx - r, cy - r, cx + r, cy + r],
                    fill=colour,
                    outline=stroke,
                    width=stroke_px if stroke else 0,
                )
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
            for polygon in parse_path(element.get("d", "")):
                scaled = [(px * scale, py * scale) for px, py in polygon]
                # A closed polygon with a stroke and no fill is a line drawing rather than a shape:
                # the seam and the screw slots are emitted that way, and filling them would hide them.
                filled = colour if colour and style["fill"] is not None else None
                if filled or stroke:
                    draw.polygon(scaled, fill=filled, outline=stroke, width=stroke_px if stroke else 1)
        elif tag == "text":
            content = (element.text or "").strip()
            if not content:
                continue
            x = float(element.get("x") or 0) * scale
            y = float(element.get("y") or 0) * scale
            anchor = element.get("text-anchor") or "start"
            # Text carries its size in the stylesheet, not in the element, so each class needs its own
            # font: the bezel lettering and the 9px indicators are visibly different sizes.
            size = int(text_size_for(element, styles) * scale)
            try:
                text_font = ImageFont.truetype("consola.ttf", size)
            except OSError:
                text_font = font
            # No fallback colour: an unstyled text element is a fault in the face, not something to
            # paper over with a default that would make the image look plausible while being wrong.
            text_colour = colour or (255, 0, 255, 255)
            box = draw.textbbox((0, 0), content, font=text_font)
            text_w = box[2] - box[0]
            if anchor == "middle":
                x -= text_w / 2
            elif anchor == "end":
                x -= text_w
            draw.text((x, y - size * 0.8), content, font=text_font, fill=text_colour)

    # The watermark is applied *after* the SVG is drawn and before the single save, so there is no
    # window in which an unlabelled image could be mistaken for a labelled one.
    if label:
        stamp_label(image, label)

    image.save(dst)
    # ASCII only in the terminal line: this runs under a Windows console whose code page mangles an
    # em dash into a replacement character, and a garbled confirmation is a bad first impression.
    print(f"wrote {dst} ({width}x{height}){f' - label: {label}' if label else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
