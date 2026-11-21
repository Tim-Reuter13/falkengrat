"""Prepare material layers, end grain and cutouts from the three source atlases."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageFilter

ASSETS=Path(__file__).resolve().parents[1]/"assets"
SOURCE=ASSETS/"originals"
TILE=512

def cells(image,cols,rows,margin=0):
    for j in range(rows):
        for i in range(cols):
            yield image.crop((i*image.width//cols+margin,j*image.height//rows+margin,
                              (i+1)*image.width//cols-margin,(j+1)*image.height//rows-margin))

def normals(image,amplitude):
    height=np.asarray(image.convert("L").filter(ImageFilter.GaussianBlur(.7)),dtype=np.float32)/255
    dy,dx=np.gradient(height)
    n=np.stack((-amplitude*dx,amplitude*dy,np.ones_like(height)),axis=-1)
    n/=np.linalg.norm(n,axis=-1,keepdims=True)
    return Image.fromarray(np.uint8(np.clip(n*.5+.5,0,1)*255+.5))

def cyclic(image):
    # Move source borders into the center and soften the former tile boundaries.
    shifted=ImageChops.offset(image,TILE//2,TILE//2)
    y,x=np.indices((TILE,TILE))
    seam=np.minimum(np.abs(x-TILE//2),np.abs(y-TILE//2))
    mask=np.clip((52-seam)/52,0,1)
    return Image.composite(image,shifted,Image.fromarray(np.uint8(mask*mask*(3-2*mask)*255)))

def cutout(image):
    rgb=np.asarray(image.convert("RGB"),dtype=np.float32)/255
    r,g,b=np.moveaxis(rgb,-1,0)
    magenta=np.maximum(0,np.minimum(r,b)-g)
    alpha=1-np.clip((magenta-.075)/.50,0,1)*np.clip((np.minimum(r,b)-.36)/.39,0,1)
    spill=np.clip(magenta-.055,0,1)*np.clip((magenta-.09)/.46,0,1)
    rgba=np.stack((r-spill*.95,g,b-spill*.95,alpha),axis=-1)
    rgba[alpha<.022]=0
    return Image.fromarray(np.uint8(np.clip(rgba,0,1)*255+.5))

source=Image.open(SOURCE/"soil-swatches.png").convert("RGB")
base=Image.new("RGB",(TILE*4,TILE*2))
relief=Image.new("RGB",base.size)
for i,cell in enumerate(cells(source,4,2,6)):
    tile=cyclic(cell.resize((TILE,TILE),Image.Resampling.LANCZOS))
    xy=(i%4*TILE,i//4*TILE)
    base.paste(tile,xy)
    relief.paste(normals(tile,2.4 if i<4 else 3.8),xy)
base.save(ASSETS/"soil-swatches.webp",quality=95,method=6)
relief.save(ASSETS/"soil-normal.webp",quality=94,method=6)

wood=Image.open(SOURCE/"endgrain.png").convert("RGB").resize((1024,1024),Image.Resampling.LANCZOS)
wood.save(ASSETS/"endgrain.webp",quality=93,method=6)
normals(wood,2.6).save(ASSETS/"endgrain-normal.webp",quality=92,method=6)

size=384
props=Image.new("RGBA",(4*size,4*size))
old=Image.open(ASSETS/"forest-props.webp").convert("RGBA")
new=cutout(Image.open(SOURCE/"river-clutter.png"))
for i,tile in enumerate([*cells(old,3,2),*cells(new,4,2)]):
    tile=tile.crop(tile.getbbox(alpha_only=True))
    tile.thumbnail((size-24,size-24),Image.Resampling.LANCZOS)
    props.paste(tile,(i%4*size+(size-tile.width)//2,i//4*size+(size-tile.height)//2))
props.save(ASSETS/"woodland-clutter.webp",quality=93,method=6,alpha_quality=100)
