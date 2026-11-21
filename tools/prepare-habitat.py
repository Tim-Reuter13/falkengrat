"""Pack 16 keyed habitat cards with padding and transparent margins."""
from pathlib import Path
import numpy as np
from PIL import Image

ASSETS=Path(__file__).resolve().parents[1]/"assets"
SIZE=512
atlas=Image.new("RGBA",(SIZE*4,SIZE*4))

for row,source in enumerate(("woodland-habitat.png","stream-habitat.png")):
    sheet=Image.open(ASSETS/"originals"/source).convert("RGB")
    for i in range(8):
        x,y=i%4,i//4
        tile=sheet.crop((x*sheet.width//4,y*sheet.height//2,(x+1)*sheet.width//4,(y+1)*sheet.height//2))
        rgb=np.asarray(tile,dtype=np.float32)/255
        r,g,b=np.moveaxis(rgb,-1,0)
        magenta=np.maximum(0,np.minimum(r,b)-g)
        alpha=1-np.clip((magenta-.095)/.57,0,1)*np.clip((np.minimum(r,b)-.36)/.42,0,1)
        spill=np.clip(magenta-.055,0,1)*np.clip((magenta-.09)/.46,0,1)
        rgba=np.stack((r-spill*.95,g,b-spill*.95,alpha),axis=-1)
        rgba[alpha<.024]=0
        cutout=Image.fromarray(np.uint8(np.clip(rgba,0,1)*255+.5))
        box=cutout.getchannel("A").point(lambda value:255 if value>64 else 0).getbbox()
        if not box:raise ValueError(f"No plant in {source}, tile {i}")
        cutout=cutout.crop(box).resize((SIZE-30,SIZE-30),Image.Resampling.LANCZOS)
        atlas.paste(cutout,(x*SIZE+15,(row*2+y)*SIZE+15))

atlas.save(ASSETS/"habitat-atlas.webp",quality=94,method=6,alpha_quality=100)
