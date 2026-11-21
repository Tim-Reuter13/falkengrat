"""Build chroma-keyed sprites and tileable materials from the bundled source art."""
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageFilter, ImageOps

assets = Path(__file__).resolve().parents[1] / "assets"
sources = assets / "originals"


def smooth(lower, upper, value):
    t = np.clip((value - lower) / (upper - lower), 0, 1)
    return t*t*(3-2*t)


def key_magenta(image):
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255
    r, g, b = np.moveaxis(rgb, -1, 0)
    chroma = np.maximum(0, np.minimum(r, b)-g)
    alpha = 1-smooth(.095,.59,chroma)*smooth(.30,.71,np.minimum(r,b))
    spill = np.maximum(0,chroma-.035)*smooth(.07,.26,chroma)
    corrected = np.stack((r-spill*.93,g,b-spill*.92,alpha),axis=-1)
    corrected[alpha<.015] = 0
    return Image.fromarray(np.uint8(np.clip(corrected,0,1)*255+.5),"RGBA")


for original, target in (("alps","alps"),("foothills","foothills"),("fir-branch","fir-branch")):
    path=sources / f"{original}.png"
    if not path.exists():
        continue
    subject = key_magenta(Image.open(path))
    if original=="fir-branch":
        subject.thumbnail((2304,1024),Image.Resampling.LANCZOS)
    subject.save(assets / f"{target}.webp",quality=91,method=6,alpha_quality=100)

props = key_magenta(Image.open(sources / "forest-props.png"))
tile = 384
atlas = Image.new("RGBA",(tile*3,tile*2))
for index in range(6):
    x0, x1 = (index%3)*props.width//3, (index%3+1)*props.width//3
    y0, y1 = (index//3)*props.height//2, (index//3+1)*props.height//2
    piece=props.crop((x0,y0,x1,y1))
    piece=piece.crop(piece.getbbox(alpha_only=True))
    piece.thumbnail((tile-14,tile-14),Image.Resampling.LANCZOS)
    atlas.paste(piece,((index%3)*tile+(tile-piece.width)//2,(index//3)*tile+(tile-piece.height)//2))
atlas.save(assets / "forest-props.webp",quality=91,method=6,alpha_quality=100)

materials = Image.open(sources / "forest-surfaces.png").convert("RGB")
size=704
grid=np.indices((size,size))
distance=np.minimum.reduce([grid[0],grid[1],size-grid[0]-1,size-grid[1]-1])
seam=Image.fromarray(np.uint8((1-smooth(0,72,distance))*255),"L")

for index, name in enumerate(("meadow","woodland-turf","needle-bed","limestone")):
    x0, x1 = (index%2)*materials.width//2, (index%2+1)*materials.width//2
    y0, y1 = (index//2)*materials.height//2, (index//2+1)*materials.height//2
    surface=materials.crop((x0+12,y0+12,x1-12,y1-12)).resize((size,size),Image.Resampling.LANCZOS)
    surface=Image.composite(ImageChops.offset(surface,size//2,size//2),surface,seam)
    surface.save(assets / f"{name}.jpg",quality=92,optimize=True)

    if name in ("meadow","limestone"):
        scan=ImageOps.grayscale(surface).filter(ImageFilter.GaussianBlur(.77))
        height=np.asarray(scan,dtype=np.float32)/255
        nx=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))*2.55
        ny=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))*2.55
        normal=np.stack([nx,ny,np.ones_like(nx)],axis=-1)
        normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
        Image.fromarray(np.uint8((normal*.5+.5)*255+.5),"RGB").save(
            assets / f"{name}-normal.webp",quality=95,method=6)
