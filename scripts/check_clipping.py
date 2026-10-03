"""Checks that nothing on the rendered face is clipped by the LCD's bottom edge.

The LCD's foot is the tightest constraint on the layout, and a clipped glyph is obvious in a
picture but invisible in the markup, so this measures the actual rendered ink.
"""
import sys

from PIL import Image

SCALE = 2.0
LCD = {"x": 55, "y": 96, "width": 340, "height": 326}

image = Image.open(sys.argv[1] if len(sys.argv) > 1 else "dist/preview/face-0.png")
pixels = image.load()

# The LCD's foot is inside the image, but only just: 422 units at scale 2 is 844 px against an
# 842 px tall image, because the case is 421 units tall. Clamp, and report the true lowest ink so
# a clipped glyph cannot hide behind an empty range.
lcd_bottom_px = min(int((LCD["y"] + LCD["height"]) * SCALE), image.size[1] - 1)

print(f"image size    : {image.size}")
print(f"LCD bottom px : {lcd_bottom_px} (clamped to the image)")

lowest_ink = None
for y in range(image.size[1] - 1, -1, -1):
    row_has_ink = False
    for x in range(image.size[0]):
        if sum(pixels[x, y][:3]) < 250:
            row_has_ink = True
            break
    if row_has_ink:
        lowest_ink = y
        break

print(f"lowest ink row: {lowest_ink}")

below = 0
for y in range(lcd_bottom_px, image.size[1]):
    for x in range(int(LCD["x"] * SCALE), int((LCD["x"] + LCD["width"]) * SCALE)):
        if sum(pixels[x, y][:3]) < 250:
            below += 1

print(f"dark pixels below the LCD foot: {below}")
print("verdict:", "CLEAN" if below == 0 else "CLIPPING")
