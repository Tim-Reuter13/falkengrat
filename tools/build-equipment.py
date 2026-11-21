"""Sculpt the posed glove and build two self-contained, single-mesh glTF models."""
from pathlib import Path
import io
import json
import struct
import numpy as np
from PIL import Image, ImageChops

ASSETS = Path(__file__).resolve().parents[1] / "assets"
atlas = Image.open(ASSETS/"originals"/"equipment-surfaces.png").convert("RGB")
tiles=[]
for i in range(4):
    x=i%2*atlas.width//2
    y=i//2*atlas.height//2
    tile=atlas.crop((x+5,y+5,x+atlas.width//2-5,y+atlas.height//2-5)).resize((512,512),Image.Resampling.LANCZOS)
    # A narrow, reflected overlap prevents a bright seam in repeated material samples.
    shifted=ImageChops.offset(tile,256,256)
    iy,ix=np.indices((512,512))
    margin=np.minimum.reduce([ix,iy,511-ix,511-iy])
    tile=Image.composite(shifted,tile,Image.fromarray(np.uint8(255*np.clip(1-margin/40,0,1))))
    tiles.append(tile)
tiles[3].save(ASSETS/"raven-feathers.webp",quality=92,method=6)

def unit(v):
    return v/np.maximum(1e-12,np.linalg.norm(v,axis=-1,keepdims=True))

def strip_indices(rows,cols):
    faces=[]
    for j in range(rows-1):
        for i in range(cols-1):
            a=j*cols+i
            faces.extend([[a,a+1,a+cols],[a+1,a+cols+1,a+cols]])
    return np.asarray(faces)

class Model:
    def __init__(self,name,swatches):
        self.name=name
        self.swatches=swatches
        self.pos=[];self.norm=[];self.uv=[];self.shade=[];self.weights=[];self.faces=[]
        self.count=0

    def add(self,p,n,uv,faces,swatch,shade=.97,weight=0):
        p=np.asarray(p).reshape(-1,3)
        uv=np.asarray(uv).reshape(-1,2).copy()
        uv[:,0]=(swatch+.012+.976*uv[:,0])/len(self.swatches)
        uv[:,1]=.012+.976*uv[:,1]
        self.pos.append(p);self.norm.append(unit(np.asarray(n).reshape(-1,3)));self.uv.append(uv)
        self.shade.append(np.broadcast_to(shade,(len(p),)))
        self.weights.append(np.broadcast_to(weight,(len(p),)))
        self.faces.append(np.asarray(faces)+self.count)
        self.count+=len(p)

    def rings(self,rows,slot,shade=1,weights=None):
        p=np.asarray(rows)
        r,c,_=p.shape
        # Closed circumferential tangent, one-sided differences at either end of the loft.
        dr=np.gradient(p,axis=0)
        core=p[:,:-1]
        du=np.roll(core,-1,axis=1)-np.roll(core,1,axis=1)
        du=np.concatenate([du,du[:,:1]],axis=1)
        normals=unit(np.cross(du,dr))
        ij=np.meshgrid(np.linspace(0,1,c),np.linspace(0,1,r))
        self.add(p,normals,np.stack(ij,axis=-1),strip_indices(r,c),slot,shade,0 if weights is None else np.repeat(weights,c))

    def save(self):
        gl={"asset":{"version":"2.0","generator":"Falkengrat equipment sculpt"},"scene":0,"scenes":[{"nodes":[0]}],
            "bufferViews":[],"accessors":[],"images":[],"textures":[],"samplers":[{"magFilter":9729,"minFilter":9987,"wrapS":33071,"wrapT":33071}]}
        binary=bytearray()
        def view(data,target=None):
            while len(binary)%4:binary.append(0)
            index=len(gl["bufferViews"])
            entry={"buffer":0,"byteOffset":len(binary),"byteLength":len(data)}
            if target:entry["target"]=target
            gl["bufferViews"].append(entry);binary.extend(data)
            return index
        def accessor(data,dtype,kind,ctype,target=34962,bounds=False):
            a=np.ascontiguousarray(data,dtype=dtype)
            item={"bufferView":view(a.tobytes(),target),"componentType":ctype,"count":len(a),"type":kind}
            if bounds:item.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
            gl["accessors"].append(item)
            return len(gl["accessors"])-1
        positions=np.concatenate(self.pos)
        shades=np.concatenate(self.shade)
        attrs={"POSITION":accessor(positions,"<f4","VEC3",5126,bounds=True),
               "NORMAL":accessor(np.concatenate(self.norm),"<f4","VEC3",5126),
               "TEXCOORD_0":accessor(np.concatenate(self.uv),"<f4","VEC2",5126),
               "COLOR_0":accessor(np.repeat(shades[:,None],3,axis=1),"<f4","VEC3",5126)}
        index_type,index_component=("<u2",5123) if len(positions)<65536 else ("<u4",5125)
        face=accessor(np.concatenate(self.faces).ravel(),index_type,"SCALAR",index_component,34963)
        gl["nodes"]=[{"name":self.name,"mesh":0}]
        if self.name=="Hand":
            # Wrist joint is the pivot for the weighted sleeve and the glove cuff.
            wrist=np.array([.052,-.026,.033])
            w=np.concatenate(self.weights)
            joints=np.zeros((len(w),4),np.uint8);joints[:,1]=1
            attrs["JOINTS_0"]=accessor(joints,"u1","VEC4",5121)
            attrs["WEIGHTS_0"]=accessor(np.stack([1-w,w,w*0,w*0],axis=1),"<f4","VEC4",5126)
            binds=np.stack([np.eye(4),np.eye(4)]);binds[1,3,:3]=-wrist
            ibm=accessor(binds.reshape(2,16),"<f4","MAT4",5126,None)
            gl["nodes"][0].update(skin=0,children=[1])
            gl["nodes"].extend([{"name":"Griffhand","children":[2]},{"name":"Unterarm","translation":wrist.tolist()}])
            gl["skins"]=[{"joints":[1,2],"inverseBindMatrices":ibm,"skeleton":1}]
        gl["meshes"]=[{"name":self.name,"primitives":[{"attributes":attrs,"indices":face,"material":0}]}]
        maps=[[],[],[]]
        for kind,tint,metal,rough in self.swatches:
            rgb=np.asarray(tiles[kind],np.float32)/255
            lum=rgb@np.array([.24,.64,.12])
            if kind==2:
                rgb=np.clip(.74+(lum-lum.mean())[:,:,None]*.57,0,1)
                rgb=np.repeat(rgb,3,axis=2)
            base=np.uint8(np.clip(rgb*tint,0,1)*255)
            micro=np.stack([(np.roll(lum,1,1)-np.roll(lum,-1,1)),(np.roll(lum,-1,0)-np.roll(lum,1,0)),np.ones_like(lum)],axis=2)
            micro[:,:,:2]*=1.75 if kind==0 else .9
            normal=np.uint8((unit(micro)*.5+.5)*255)
            orm=np.uint8(np.clip(np.stack([np.ones_like(lum),rough+(lum-lum.mean())*.33,np.full_like(lum,metal)],axis=2),0,1)*255)
            for dest,src in zip(maps,[base,normal,orm]):dest.append(src)
        for channels in maps:
            output=io.BytesIO()
            Image.fromarray(np.concatenate(channels,axis=1)).save(output,format="JPEG",quality=93,subsampling=0)
            gl["images"].append({"bufferView":view(output.getvalue()),"mimeType":"image/jpeg"})
            gl["textures"].append({"sampler":0,"source":len(gl["images"])-1})
        gl["materials"]=[{"name":self.name+"-PBR","pbrMetallicRoughness":{"baseColorTexture":{"index":0},
            "metallicRoughnessTexture":{"index":2},"roughnessFactor":1,"metallicFactor":1},"normalTexture":{"index":1,"scale":.57}}]
        gl["buffers"]=[{"byteLength":len(binary)}]
        desc=json.dumps(gl,separators=(",",":")).encode()
        desc+=b" "*(-len(desc)%4);binary.extend(b"\0"*(-len(binary)%4))
        data=struct.pack("<4sII",b"glTF",2,28+len(desc)+len(binary))+struct.pack("<I4s",len(desc),b"JSON")+desc+struct.pack("<I4s",len(binary),b"BIN\0")+binary
        (ASSETS/(self.name.lower()+".glb")).write_bytes(data)
        print(self.name,len(positions),"vertices,",len(np.concatenate(self.faces)),"triangles")

def glove(model):
    # Sample the glove in grip space. Each finger follows its own metacarpal and three phalanges.
    step=.0028
    axes=[np.arange(lo,hi,step) for lo,hi in [(-.054,.104),(-.103,.095),(-.065,.102)]]
    grid=np.stack(np.meshgrid(*axes,indexing="ij"),axis=-1)
    def ell(center,radius):
        q=(grid-center)/radius
        return (np.linalg.norm(q,axis=-1)-1)*min(radius)
    def capsule(a,b,ra,rb):
        a,b=np.asarray(a),np.asarray(b)
        q=grid-a;delta=b-a
        t=np.clip((q@delta)/(delta@delta),0,1)
        return np.linalg.norm(q-t[:,:,:,None]*delta,axis=-1)-(ra+(rb-ra)*t)
    def blend(a,b,k):
        h=np.maximum(k-np.abs(a-b),0)/k
        return np.minimum(a,b)-h*h*k*.25
    field=ell([.032,-.006,.000],[.023,.053,.029])
    field=blend(field,ell([.046,-.020,.020],[.027,.035,.026]),.018)
    field=blend(field,capsule([.046,-.018,.020],[.071,-.038,.056],.028,.031),.014)
    for i,(height,r,long) in enumerate([(.033,.0119,1),(.010,.0122,1.07),(-.014,.0114,.99),(-.034,.0096,.88)]):
        curve=np.array([[.032,height+.002,-.014],[.016,height+.005,-.026],[-.005,height+.005,-.027],
                        [-.024*long,height+.003,-.015],[-.026*long,height+.001,.002],[-.016,height-.004,.016],[.000,height-.009,.020]])
        radii=r*np.array([1.13,1.08,1.03,1,.94,.89,.75])
        finger=np.full_like(field,1)
        for j in range(len(curve)-1):finger=blend(finger,capsule(curve[j],curve[j+1],radii[j],radii[j+1]),.0027)
        field=blend(field,finger,.0055)
    thumb=np.array([[.040,.002,.019],[.038,.022,.026],[.027,.038,.028],[.009,.040,.029],[-.009,.030,.026],[-.016,.019,.020]])
    radii=[.019,.016,.0148,.0134,.0113,.0092]
    thumb_field=np.full_like(field,1)
    for j in range(len(thumb)-1):thumb_field=blend(thumb_field,capsule(thumb[j],thumb[j+1],radii[j],radii[j+1]),.005)
    field=blend(field,thumb_field,.005)
    # Shallow stitched wrinkles across knuckle flexion zones, sculpted into the outer surface.
    x,y,z=np.moveaxis(grid,-1,0)
    mask=np.exp(-((x+.022)/.016)**2)*np.clip((.04-np.abs(y))/.014,0,1)
    field+=mask*.00065*np.sin(y*920+x*220+z*130)
    gradients=np.stack(np.gradient(field,step,edge_order=1),axis=-1)
    corners=np.array([[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]])
    slices=[tuple(slice(c,c+n-1) for c,n in zip(off,field.shape)) for off in corners]
    values=np.stack([field[s] for s in slices],axis=-1)
    cells=np.argwhere((values.min(axis=-1)<0)&(values.max(axis=-1)>=0))
    allpos=[];allnorm=[]
    for tet in [[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6],[0,5,1,6]]:
        cp=cells[:,None,:]+corners[tet]
        val=field[tuple(cp.transpose(2,0,1))]
        code=(val<0)@np.array([1,2,4,8])
        for case in range(1,15):
            cp1=cp[code==case]
            if not len(cp1):continue
            inner=[i for i in range(4) if case&(1<<i)]
            outer=[i for i in range(4) if i not in inner]
            edges=[(a,b) for a in inner for b in outer]
            idx=[0,1,2] if len(edges)==3 else [0,1,3,0,3,2]
            pts=[];ns=[]
            for a,b in edges:
                va=tuple(cp1[:,a].T);vb=tuple(cp1[:,b].T)
                t=(field[va]/(field[va]-field[vb]))[:,None]
                pts.append(grid[va]+t*(grid[vb]-grid[va]))
                ns.append(unit(gradients[va]+t*(gradients[vb]-gradients[va])))
            p=np.stack(pts,1)[:,idx].reshape(-1,3,3);n=np.stack(ns,1)[:,idx].reshape(-1,3,3)
            flip=(np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0])*n.mean(axis=1)).sum(axis=1)<0
            p[flip]=p[flip,::-1];n[flip]=n[flip,::-1]
            allpos.append(p);allnorm.append(n)
    p=np.concatenate(allpos);n=np.concatenate(allnorm)
    # Box unwrap with explicit seams. Smooth sculpt normals remain continuous at UV chart borders.
    for axis in range(3):
        use=np.argmax(np.abs(n.mean(axis=1)),axis=1)==axis
        tri=p[use].reshape(-1,3);norm=n[use].reshape(-1,3)
        unique,indices,faces=np.unique(np.round(tri,7),axis=0,return_index=True,return_inverse=True)
        uv=unique[:,[(axis+1)%3,(axis+2)%3]]*5+.49
        localAO=.90+.09*np.clip((np.abs(unique[:,0])+.55*np.abs(unique[:,2])-.018)/.021,0,1)
        model.add(unique,norm[indices],uv,faces.reshape(-1,3),0,localAO)
    # Glove gauntlet and gathered wool sleeve run from wrist to elbow.
    wrist=np.array([.052,-.026,.033]);direction=unit(np.array([.57,-.36,.74]))
    side=unit(np.cross(direction,[0,1,0]));up=np.cross(direction,side)
    angles=np.linspace(0,2*np.pi,65)
    for slot,profile in [(1,[(.042,.027),(.053,.032),(.064,.038),(.083,.041),(.14,.044),(.22,.052),(.34,.063),(.46,.065)]),
                         (0,[(-.007,.024),(.007,.030),(.021,.032),(.031,.034),(.043,.032),(.050,.036),(.057,.037),(.061,.035),(.0615,.031)])]:
        lengths=np.linspace(profile[0][0],profile[-1][0],85 if slot==1 else 32)
        rows=[]
        for s in lengths:
            rad=np.interp(s,*np.array(profile).T)
            fold=(.0026*np.sin(s*172+np.sin(angles*2.4+s*19)*3.5)+.0011*np.cos(angles*5+s*38))*(.9 if slot==1 else .33)
            r=rad+fold
            rows.append(wrist+direction*s+(np.cos(angles)[:,None]*side+np.sin(angles)[:,None]*up*.88)*r[:,None])
        # With this basis positive circumference crossed with the longitudinal tangent points outwards.
        model.rings(rows,slot,weights=np.clip((lengths+.008)/.065,0,1))

def sword(model):
    # Two sloped faces, shallow central fuller, eased shoulders and a sharp taper.
    heights=[(.057,.020,.0039),(.068,.024,.0043),(.097,.024,.0041),(.125,.023,.0039),
             (.26,.0215,.0036),(.45,.0195,.0032),(.62,.016,.0026),(.76,.0105,.0019),(.845,.00022,.00024)]
    cross=[(-1,.045),(-.80,.57),(-.29,1),(-.16,.80),(0,.76),(.16,.80),(.29,1),(.80,.57),(1,.045),
           (.80,-.57),(.29,-1),(.16,-.80),(0,-.76),(-.16,-.80),(-.29,-1),(-.8,-.57),(-1,.045)]
    for j in range(len(cross)-1):
        p=[];uv=[]
        for y,w,t in heights:
            for k in [j,j+1]:
                xx,zz=cross[k];p.append([xx*w,y,zz*t]);uv.append([.5+xx*.41,(y-.057)/.79])
        p=np.array(p);f=strip_indices(len(heights),2)
        ns=np.zeros_like(p)
        tri=p[f];fn=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0])
        for i in range(3):np.add.at(ns,f[:,i],fn)
        model.add(p,ns,uv,f,0)
    a=np.linspace(0,2*np.pi,65)
    # A tapering steel crossguard with bevelled quillons, a bound leather grip and wheel pommel.
    rows=[]
    for x in np.linspace(-.099,.099,51):
        end=abs(x/.099)
        h=.008*(1-.40*end)+.0025*end**8
        depth=.011*(1-.42*end)+.0025*end**9
        y=.059-.012*end**1.8
        c=np.sign(np.cos(a))*np.abs(np.cos(a))**.62
        s=np.sign(np.sin(a))*np.abs(np.sin(a))**.62
        rows.append(np.stack([a*0+x,y+c*h,s*depth],axis=1))
    model.rings(rows,2)
    for y,r in [(.058,.018),(-.095,.014)]:
        rows=[np.stack([np.cos(a)*r*k,a*0+y+dy,-np.sin(a)*r*.80*k],axis=1) for dy,k in [(-.002,.94),(-.001,1),(.001,1),(.002,.94)]]
        model.rings(rows,2)
    rows=[]
    for y in np.linspace(-.098,.059,154):
        t=(y+.098)/.157
        r=.0132+.0044*np.sin(np.pi*t)**.8+.0008*np.cos(t*2*np.pi*17+a)
        rows.append(np.stack([np.cos(a)*r,a*0+y,-np.sin(a)*r*.80],axis=1))
    model.rings(rows,1)
    rows=[]
    for y,k in [(-.144,.08),(-.143,.46),(-.139,.75),(-.131,.98),(-.119,1),(-.109,.88),(-.103,.62),(-.097,.42),(-.093,.38)]:
        rows.append(np.stack([np.cos(a)*.024*k,a*0+y,-np.sin(a)*.019*k],axis=1))
    model.rings(rows,2)

hand=Model("Hand",[(0,np.array([.99,1.04,1.03]),0,.86),(1,np.array([.97,1,1.04]),0,.97)])
glove(hand);hand.save()
blade=Model("Schwert",[(2,np.array([1.06,1.07,1.08]),.97,.19),(0,np.array([.57,.49,.45]),0,.83),(2,np.array([.53,.51,.48]),.85,.37)])
sword(blade);blade.save()
