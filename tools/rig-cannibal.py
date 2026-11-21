"""Rig a Pixal3D T-pose character onto the Animation Studio's Mixamo skeleton and export it with clips.

blender -b -P rig.py -- character.glb out.glb ref_clip.glb clip1.glb clip2.glb ...
  - ref_clip gives the reference rest skeleton R (T-pose, faces -Y, Blender Z-up)
  - the mesh is oriented (front -Y), scaled, the skeleton fitted to its limbs (F), bound with automatic weights,
    posed back into R's bone directions and applied, then rebound to G = R directions with the mesh's bone lengths,
    so every clip's rotations transfer exactly.
"""
import bpy, sys, math, bmesh
from mathutils import Vector, Matrix
import numpy as np

a = sys.argv[sys.argv.index('--') + 1:]
mesh_path, out_path, ref_path, clips = a[0], a[1], a[2], a[3:]
HEIGHT = float(__import__('os').environ.get('RIG_HEIGHT', '1.78'))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def objs_after(fn):
    before = set(bpy.data.objects)
    fn()
    return [o for o in bpy.data.objects if o not in before]


def set_active(o):
    for x in bpy.data.objects:
        try:
            x.select_set(False)
        except RuntimeError:
            pass
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


# ---------- reference skeleton
new = objs_after(lambda: bpy.ops.import_scene.gltf(filepath=ref_path))
ref = [o for o in new if o.type == 'ARMATURE'][0]
for o in new:
    if o.type == 'MESH':
        bpy.data.objects.remove(o)
set_active(ref)
bpy.ops.object.mode_set(mode='EDIT')
R = {}
order = []
for eb in ref.data.edit_bones:
    R[eb.name] = dict(head=ref.matrix_world @ eb.head, tail=ref.matrix_world @ eb.tail, roll=eb.roll,
                      parent=eb.parent.name if eb.parent else None, connect=eb.use_connect)
    order.append(eb.name)
bpy.ops.object.mode_set(mode='OBJECT')
ref_actions = list(bpy.data.actions)
bpy.data.objects.remove(ref)
for act in ref_actions:
    bpy.data.actions.remove(act)
ref_top = max(v['tail'].z for v in R.values()) + .10   # top of the head
print('REF top', round(ref_top, 3))

# ---------- character mesh
new = objs_after(lambda: bpy.ops.import_scene.gltf(filepath=mesh_path))
meshes = [o for o in new if o.type == 'MESH']
for o in new:
    if o.type == 'EMPTY':
        pass
set_active(meshes[0])
for o in meshes:
    o.select_set(True)
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.data.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o)


def verts():
    return np.array([v.co[:] for v in body.data.vertices])


def transform(m):
    body.data.transform(m)
    body.data.update()


V = verts()
ext = V.max(0) - V.min(0)
print('MESH extent', ext.round(3))
# Up axis = the longest extent among Y/Z for a standing T-pose is Z (height ~ arm span); after glTF import it is Z.
# Arms along X? If Y extent > X extent the arms run along Y: turn 90 degrees.
if ext[1] > ext[0] * 1.15:
    transform(Matrix.Rotation(math.radians(90), 4, 'Z'))
V = verts()
lo, hi = V.min(0), V.max(0)
s = HEIGHT / (hi[2] - lo[2])
transform(Matrix.Scale(s, 4))
V = verts()
lo, hi = V.min(0), V.max(0)
c = (lo + hi) / 2
transform(Matrix.Translation((-c[0], 0, -lo[2])))
V = verts()
# Centre on the torso in Y (depth) at hip height.
H = HEIGHT
band = V[(V[:, 2] > .45 * H) & (V[:, 2] < .6 * H) & (np.abs(V[:, 0]) < .15 * H)]
transform(Matrix.Translation((0, -band[:, 1].mean(), 0)))
V = verts()
# Front must face -Y: toes stick out to the front of the shins.
feet = V[V[:, 2] < .035 * H]
shins = V[(V[:, 2] > .08 * H) & (V[:, 2] < .16 * H)]
front_sign = np.sign(feet[:, 1].mean() - shins[:, 1].mean())
print('toes offset', round(float(feet[:, 1].mean() - shins[:, 1].mean()), 3))
if front_sign > 0:
    transform(Matrix.Rotation(math.pi, 4, 'Z'))
    V = verts()

# ---------- fit: uniform scale of R, then measured limbs
k = H / ref_top
F = {n: dict(head=d['head'] * k, tail=d['tail'] * k) for n, d in R.items()}


def slice_mean(mask):
    sel = V[mask]
    return sel.mean(0) if len(sel) else None


def move_chain(names, fn):
    for n in names:
        F[n]['head'] = fn(F[n]['head'])
        F[n]['tail'] = fn(F[n]['tail'])


# Torso depth: spine joints follow the body centre line (y) at their height.
for n in ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']:
    full = 'mixamorig:' + n
    for end in ('head', 'tail'):
        p = F[full][end]
        m = slice_mean((np.abs(V[:, 2] - p.z) < .03 * H) & (np.abs(V[:, 0]) < .12 * H))
        if m is not None:
            F[full][end] = Vector((0, float(m[1]), p.z))
# keep connected joints consistent
for n in order:
    p = R[n]['parent']
    if p and R[n]['connect']:
        F[n]['head'] = F[p]['tail'].copy()

for side, sign in (('Left', 1), ('Right', -1)):
    # legs: x and depth of the thigh / shin at their heights
    for n in ['UpLeg', 'Leg', 'Foot', 'ToeBase']:
        full = f'mixamorig:{side}{n}'
        for end in ('head', 'tail'):
            p = F[full][end]
            if n in ('Foot', 'ToeBase') and end == 'tail' or n == 'ToeBase':
                continue
            m = slice_mean((np.abs(V[:, 2] - p.z) < .025 * H) & (np.sign(V[:, 0]) == sign) & (np.abs(V[:, 0]) < .2 * H))
            if m is not None:
                F[full][end] = Vector((float(m[0]), float(m[1]), p.z))
    dx = F[f'mixamorig:{side}Foot']['head'].x - k * R[f'mixamorig:{side}Foot']['head'].x
    dy = F[f'mixamorig:{side}Foot']['head'].y - k * R[f'mixamorig:{side}Foot']['head'].y
    for n in ['Foot', 'ToeBase']:
        full = f'mixamorig:{side}{n}'
        for end in ('head', 'tail'):
            p = k * R[full][end]
            F[full][end] = Vector((p.x + dx, p.y + dy, p.z))
    F[f'mixamorig:{side}Leg']['tail'] = F[f'mixamorig:{side}Foot']['head'].copy()
    F[f'mixamorig:{side}UpLeg']['tail'] = F[f'mixamorig:{side}Leg']['head'].copy()
    # arms: the arm line from the shoulder to the finger tips
    sh = F[f'mixamorig:{side}Arm']['head']
    arm = V[(V[:, 0] * sign > abs(sh.x) + .02 * H) & (V[:, 2] > .55 * H)]
    tip = float(np.abs(arm[:, 0]).max())
    ref_tip = max(abs(F[n]['tail'].x) for n in F if n.startswith(f'mixamorig:{side}Hand'))
    sx = (tip - abs(sh.x)) / (ref_tip - abs(sh.x))

    def line_at(x):
        sel = arm[np.abs(np.abs(arm[:, 0]) - abs(x)) < .02 * H]
        if len(sel) < 5:
            return None
        return Vector((x, float(np.median(sel[:, 1])), float((sel[:, 2].min() + sel[:, 2].max()) / 2)))

    chain = [n for n in F if n.startswith(f'mixamorig:{side}Arm') or n.startswith(f'mixamorig:{side}ForeArm')
             or n.startswith(f'mixamorig:{side}Hand')]
    for n in chain:
        for end in ('head', 'tail'):
            p = F[n][end]
            x = sh.x + (p.x - sh.x) * sx
            q = line_at(x)
            ref_line = line_at(sh.x + (F[f'mixamorig:{side}Hand']['head'].x - sh.x) * sx)
            if n.startswith(f'mixamorig:{side}Hand') and ref_line is not None and q is None:
                q = ref_line
            if q is None:
                q = Vector((x, p.y, p.z))
            # fingers keep their offsets from the hand line
            off = (p - k * R[f'mixamorig:{side}Hand']['head']) if 'Hand' in n else Vector()
            off.x = 0
            F[n][end] = Vector((x, q.y + off.y, q.z + off.z))
    for n in order:
        p = R[n]['parent']
        if p and n in chain and R[n]['connect']:
            F[n]['head'] = F[p]['tail'].copy()
    # shoulder bone ends at the arm head
    F[f'mixamorig:{side}Shoulder']['tail'] = F[f'mixamorig:{side}Arm']['head'].copy()

print('FIT hips', F['mixamorig:Hips']['head'], 'Lhand', F['mixamorig:LeftHand']['head'], 'Lfoot', F['mixamorig:LeftFoot']['head'])


def make_armature(name, joints, rolls):
    arm_data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, arm_data)
    scene.collection.objects.link(arm)
    set_active(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    for n in order:
        eb = arm_data.edit_bones.new(n)
        eb.head, eb.tail = joints[n]['head'], joints[n]['tail']
        eb.roll = rolls[n]
    for n in order:
        if R[n]['parent']:
            arm_data.edit_bones[n].parent = arm_data.edit_bones[R[n]['parent']]
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


# Rolls for F: keep R's roll (the direction is close to R's).
fitted = make_armature('Fit', F, {n: R[n]['roll'] for n in order})
for b in fitted.data.bones:
    if any(f in b.name for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky')):
        b.use_deform = False      # mitten hands: the hand bone carries the whole hand
# Weights from the distance to each bone segment, softly blended over ~3 cm, 4 influences.
deform = [n for n in order if not any(f in n for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky'))]
P = np.array([v.co[:] for v in body.data.vertices])
D = np.zeros((len(P), len(deform)))
for j, n in enumerate(deform):
    h = np.array(F[n]['head'][:]); t = np.array(F[n]['tail'][:])
    if n.endswith('Hand'):
        t = h + (t - h) / max(1e-6, np.linalg.norm(t - h)) * .17 * H / 1.78   # whole mitten hand
    seg = t - h; L2 = max(1e-9, seg @ seg)
    u = np.clip(((P - h) @ seg) / L2, 0, 1)
    D[:, j] = np.linalg.norm(P - (h + u[:, None] * seg), axis=1)
# Arms must not grab the torso and legs must not cross: penalise bones on the wrong side of the body.
for j, n in enumerate(deform):
    if 'Left' in n: D[P[:, 0] < -.02, j] += 1
    if 'Right' in n: D[P[:, 0] > .02, j] += 1
    if 'Arm' in n or 'Hand' in n:
        D[np.abs(P[:, 0]) < abs(F[n]['head'].x) - .03, j] += .2 if 'ForeArm' in n or 'Hand' in n else 0
dmin = D.min(1, keepdims=True)
W = np.exp(-(D - dmin) / .028)
W[D - dmin > .12] = 0
idx = np.argsort(-W, 1)[:, 4:]
np.put_along_axis(W, idx, 0, 1)
W /= W.sum(1, keepdims=True)
groups = [body.vertex_groups.new(name=n) for n in deform]
for j, g in enumerate(groups):
    nz = np.nonzero(W[:, j] > 1e-3)[0]
    for i in nz:
        g.add([int(i)], float(W[i, j]), 'REPLACE')
body.parent = fitted
am = body.modifiers.new('Armature', 'ARMATURE'); am.object = fitted
print('WEIGHTS done', len(deform), 'bones')

# ---------- pose F into R's directions and bake that pose into the mesh
set_active(fitted)
bpy.ops.object.mode_set(mode='POSE')
for n in order:
    pb = fitted.pose.bones[n]
    bpy.context.view_layer.update()
    head = pb.head.copy()
    cur = (pb.tail - pb.head).normalized()
    want = (R[n]['tail'] - R[n]['head']).normalized()
    rot = cur.rotation_difference(want).to_matrix().to_4x4()
    pb.matrix = Matrix.Translation(head) @ rot @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()
G = {}
for n in order:
    pb = fitted.pose.bones[n]
    length = (F[n]['tail'] - F[n]['head']).length
    d = (R[n]['tail'] - R[n]['head']).normalized()
    G[n] = dict(head=pb.head.copy(), tail=pb.head + d * length)
bpy.ops.object.mode_set(mode='OBJECT')
set_active(body)
mod = [m for m in body.modifiers if m.type == 'ARMATURE'][0]
bpy.ops.object.modifier_apply(modifier=mod.name)
body.parent = None
bpy.data.objects.remove(fitted)

rig = make_armature('Kannibale', G, {n: R[n]['roll'] for n in order})
for b in rig.data.bones:
    if any(f in b.name for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky')):
        b.use_deform = False
body.parent = rig
m = body.modifiers.new('Armature', 'ARMATURE')
m.object = rig
body.name = 'KannibaleKoerper'
hips_ratio = G['mixamorig:Hips']['head'].z / R['mixamorig:Hips']['head'].z
print('hips ratio', round(hips_ratio, 3))

# ---------- clips
rig.animation_data_create()
names = []
for path in clips:
    new = objs_after(lambda: bpy.ops.import_scene.gltf(filepath=path))
    acts = set()
    for o in new:
        if o.animation_data and o.animation_data.action:
            acts.add(o.animation_data.action)
    for o in new:
        bpy.data.objects.remove(o)
    act = list(acts)[0]
    name = path.replace('\\', '/').split('/')[-1][:-4]
    act.name = name
    act.use_fake_user = True
    keep_root = name == 'f_death_fall'
    fcs = act.fcurves if hasattr(act, 'fcurves') else None
    if fcs is None or len(fcs) == 0:
        fcs = act.layers[0].strips[0].channelbags[0].fcurves
    for fc in list(fcs):
        dp = fc.data_path
        if dp.endswith('.location'):
            bone = dp.split('"')[1]
            if bone != 'mixamorig:Hips':
                fcs.remove(fc)
                continue
            for kp in fc.keyframe_points:
                kp.co.y *= hips_ratio
                kp.handle_left.y *= hips_ratio
                kp.handle_right.y *= hips_ratio
            # bone-local x / z of the hips are horizontal: keep only for the death fall
            if fc.array_index in (0, 2) and not keep_root:
                fcs.remove(fc)
        elif dp.endswith('.scale'):
            fcs.remove(fc)
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, int(act.frame_range[0]), act)
    names.append(name)
    print('CLIP', name, act.frame_range[:], len(fcs))
rig.animation_data.action = None

# ---------- look: pale, filthy skin with dried blood (graded in texture space)
def blur(a, r):
    k = np.exp(-np.linspace(-2, 2, 2 * r + 1) ** 2); k /= k.sum()
    for ax in (0, 1):
        a = np.apply_along_axis(lambda m: np.convolve(np.pad(m, r, mode='wrap'), k, 'valid'), ax, a)
    return a
for mat in body.data.materials:
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf or not bsdf.inputs['Base Color'].links:
        continue
    img = bsdf.inputs['Base Color'].links[0].from_node.image
    w, h = img.size
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)
    rgb = px[..., :3]
    rng = np.random.default_rng(7)
    def small(n, r):
        g = blur(rng.random((n, n)), r)
        g = np.vstack([g, g[:1]]); g = np.hstack([g, g[:, :1]])          # wrap for interpolation
        ys = np.linspace(0, n, h, endpoint=False); xs = np.linspace(0, n, w, endpoint=False)
        y0 = ys.astype(int); x0 = xs.astype(int); fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
        a_ = g[y0][:, x0]; b_ = g[y0][:, x0 + 1]; c_ = g[y0 + 1][:, x0]; d_ = g[y0 + 1][:, x0 + 1]
        return (a_ * (1 - fx) + b_ * fx) * (1 - fy) + (c_ * (1 - fx) + d_ * fx) * fy
    lum = rgb @ np.array([.2126, .7152, .0722])
    rgb = rgb * .62 + lum[..., None] * .38                       # bleached, sickly
    rgb *= np.array([.86, .84, .80])                              # cold, dead skin
    dirt = .58 + .42 * np.clip((small(64, 3) - .3) * 2.2, 0, 1)   # caked mud
    grime = .82 + .18 * np.clip(small(256, 2) * 1.4, 0, 1)
    rgb *= (dirt * grime)[..., None]
    mud = np.clip((small(96, 3) - .62) * 5, 0, 1)[..., None]
    rgb = rgb * (1 - mud * .55) + np.array([.11, .085, .06]) * mud * .55
    blood = np.clip((small(128, 2) - .70) * 6, 0, 1)[..., None]
    rgb = rgb * (1 - blood * .7) + np.array([.16, .035, .025]) * blood * .7
    # Game lighting shows albedo as it is: lift the skin (upper quartile) to a pale ~0.58 sRGB.
    lumg = rgb @ np.array([.2126, .7152, .0722])
    p75 = float(np.percentile(lumg[lumg > .02], 75))
    gain = min(2.6, max(1.0, .58 / max(p75, 1e-3)))
    print('GAIN', round(p75, 3), round(gain, 2))
    rgb = rgb * gain
    px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px.ravel())
    img.update()
    print('GRADED', img.name, w, h)

# ---------- export
set_active(rig)
body.select_set(True)
bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', use_selection=True, export_animation_mode='NLA_TRACKS',
                          export_image_format='JPEG', export_jpeg_quality=88, export_skins=True, export_yup=True,
                          export_apply=False, export_force_sampling=True, export_optimize_animation_size=True,
                          export_def_bones=False)
print('RIG_OK', out_path, names)
