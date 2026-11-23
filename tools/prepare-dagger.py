import bpy,sys,numpy as np
from mathutils import Matrix
a=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a[0])
ms=[o for o in bpy.data.objects if o.type=='MESH']
for o in bpy.data.objects: o.select_set(o.type=='MESH')
bpy.context.view_layer.objects.active=ms[0]
if len(ms)>1: bpy.ops.object.join()
o=bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM'); bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
for e in [x for x in bpy.data.objects if x.type=='EMPTY']: bpy.data.objects.remove(e)
P=np.array([v.co[:] for v in o.data.vertices]); c=P.mean(0); Q=P-c
w,V=np.linalg.eigh(Q.T@Q); ax=V[:,2]; side=V[:,1]
t=Q@ax; L=t.max()-t.min()
def width(lo,hi):
    sel=Q[(t>lo)&(t<hi)]; return np.ptp(sel@side) if len(sel) else 0
lo,hi=t.min(),t.max()
wa=width(lo+.05*L,lo+.25*L); wb=width(hi-.25*L,hi-.05*L)
print('len',L,'widths',wa,wb)
# grip end = narrower end; blade towards the other end (+Y in Blender = forward; we want blade along +Z Blender -> +Y glTF)
blade_dir = ax if wb>wa else -ax
grip_end = c + (lo if wb>wa else hi)*ax
grip = grip_end + blade_dir*0.22*L
R=np.eye(4)
z=blade_dir/np.linalg.norm(blade_dir); y=side-np.dot(side,z)*z; y/=np.linalg.norm(y); x=np.cross(y,z)
M=Matrix([[*x,0],[*y,0],[*z,0],[0,0,0,1]])
s=0.30/L
o.data.transform(Matrix.Translation(-__import__('mathutils').Vector(grip)))
o.data.transform(M); o.data.transform(Matrix.Scale(s,4))
bpy.ops.export_scene.gltf(filepath=a[1],export_format='GLB',export_image_format='JPEG',export_jpeg_quality=88)
P=np.array([v.co[:] for v in o.data.vertices]); print('bounds',P.min(0).round(3),P.max(0).round(3))
