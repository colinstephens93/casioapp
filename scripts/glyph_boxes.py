"""Lists every glyph instance in a generated face with its box, for layout diagnosis.

An inspection aid, like `svg_to_png.py`: it reads the real generated markup, so what it reports is
what the renderer actually emitted rather than a re-derivation. The boxes come straight from the
`<use>` attributes, so this is the same geometry the overlap and bounds tests assert on.
"""
import re
import sys

PATTERN = re.compile(
    r'<use href="#ch-([^"]+)" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"'
)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: glyph_boxes.py <face.svg> [lcd-x lcd-y lcd-w lcd-h]", file=sys.stderr)
        return 2

    svg = open(sys.argv[1], encoding="utf-8").read()
    instances = PATTERN.findall(svg)

    bounds = None
    if len(sys.argv) >= 7:
        bounds = tuple(float(value) for value in sys.argv[2:6])

    print(f"{len(instances)} glyph instance(s) in {sys.argv[1]}")
    for char, x, y, w, h in instances:
        x, y, w, h = float(x), float(y), float(w), float(h)
        note = ""
        if bounds:
            lx, ly, lw, lh = bounds
            if x < lx or y < ly or x + w > lx + lw or y + h > ly + lh:
                note = "  <-- OUTSIDE THE LCD"
        print(f"  {char:8} x={x:8.2f} y={y:8.2f} w={w:6.2f} h={h:6.2f} right={x + w:8.2f} bottom={y + h:8.2f}{note}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
