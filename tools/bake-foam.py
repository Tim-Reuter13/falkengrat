"""Bake periodic bubble films and patch breakup into a linear, mipmapped texture."""
from pathlib import Path
import numpy as np
from PIL import Image

SIZE=2048
target=Path(__file__).resolve().parents[1]/"assets"/"foam-cells.webp"
rng=np.random.default_rng(12831)

def bubbles(cells):
    coord=(np.arange(SIZE,dtype=np.float32)+.5)*cells/SIZE
    px,pz=np.meshgrid(coord,coord)
    ix,iz=px.astype(np.int32),pz.astype(np.int32)
    x,z=px-ix,pz-iz
    offsets=rng.uniform(.10,.90,(cells,cells,2)).astype(np.float32)
    closest=np.full_like(px,999)
    second=closest.copy()
    for dz in range(-1,2):
        for dx in range(-1,2):
            local=offsets[(iz+dz)%cells,(ix+dx)%cells]
            d=(local[:,:,0]+dx-x)**2+(local[:,:,1]+dz-z)**2
            second=np.minimum(second,np.maximum(closest,d))
            closest=np.minimum(closest,d)
    gutter=np.sqrt(second)-np.sqrt(closest)
    rim=np.clip(1-gutter/.148,0,1)
    return rim*rim*(3-2*rim)

# Separate films at two scales and a broad field that opens holes in dense foam.
film=bubbles(37)
micro=bubbles(102)
breakup=bubbles(11)
data=np.uint8(np.stack((film,micro,breakup),axis=2)*255+.5)
Image.fromarray(data).save(target,quality=91,method=6,lossless=False)
print(target)
