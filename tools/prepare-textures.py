"""Prepare texture sheets generated for Falkengrat with built-in ImageGen."""
from pathlib import Path
from math import hypot
import sys

from PIL import Image, ImageChops, ImageFilter, ImageOps

root = Path(__file__).resolve().parents[1]
out = root / "assets"
out.mkdir(exist_ok=True)
inputs = sys.argv[1:] or [out / "originals" / "plants.png", out / "originals" / "materials.png"]
plants = Image.open(inputs[0]).convert("RGBA")
materials = Image.open(inputs[1]).convert("RGB")

subjects = {
    "fir": (102, 0, 515, 843),
    "spruce": (660, 0, 1250, 843),
    "fern": (0, 856, 625, 1254),
    "grass": (631, 851, 1254, 1254),
}

for name, box in subjects.items():
    plant = plants.crop(box)
    pixels = []
    for r, g, b, a in plant.getdata():
        chroma = max(r, g, b) - min(r, g, b)
        green = g - b
        strength = max((green - 4) / 16, (chroma - 13) / 32 * (204 - max(r,g,b)) / 125)
        alpha = min(1, max(0, strength)) * min(1, a / 171)
        if alpha > .018:
            haze = max(0, min(.57, (min(r,g,b)-105) / 181)) * (.65 if name in ("fir","spruce") else 1)
            color = tuple(max(0, round(c*(1-haze))) for c in (r,g,b))
            pixels.append((*color, round(alpha * 255)))
        else:
            pixels.append((0,0,0,0))
    plant.putdata(pixels)
    plant.thumbnail((544, 768) if name in ("fir", "spruce") else (512, 360), Image.Resampling.LANCZOS)
    plant.save(out / f"{name}.webp", quality=88, method=6)

def seamless(image, feather=54):
    """Crossfade a half-tile offset through the original seams."""
    width, height = image.size
    wrap = ImageChops.offset(image, width // 2, height // 2)
    weights = Image.new("L", image.size)
    weights.putdata([
        round(255 * (1 - min(1, min(x,y,width-1-x,height-1-y) / feather)) ** 2)
        for y in range(height) for x in range(width)
    ])
    return Image.composite(wrap, image, weights)

def normal_map(color, strength):
    height = ImageOps.grayscale(color)
    soft = height.filter(ImageFilter.GaussianBlur(.85))
    dx = ImageChops.subtract(ImageChops.offset(soft, -1, 0), ImageChops.offset(soft, 1, 0), offset=128)
    dy = ImageChops.subtract(ImageChops.offset(soft, 0, -1), ImageChops.offset(soft, 0, 1), offset=128)
    pixels = []
    for x, y in zip(dx.getdata(), dy.getdata()):
        nx, ny = (x-128)*strength/64, (y-128)*strength/64
        scale = hypot(hypot(nx, ny), 1)
        pixels.append((round(127.5+127.5*nx/scale),round(127.5+127.5*ny/scale),round(127.5+127.5/scale)))
    result = Image.new("RGB",color.size)
    result.putdata(pixels)
    return result

half = materials.width // 2
for i, name in enumerate(("earth", "moss", "granite", "bark")):
    x, y = i % 2 * half, i // 2 * half
    tile = materials.crop((x+18, y+18, x+half-18, y+half-18)).resize((512,512), Image.Resampling.LANCZOS)
    tile = seamless(tile)
    tile.save(out / f"{name}.jpg", quality=90, optimize=True)
    if name in ("earth", "granite", "bark"):
        normal_map(tile, {"earth": 1.3, "granite": 1.65, "bark": 1.8}[name]).save(out / f"{name}-normal.png", optimize=True)
