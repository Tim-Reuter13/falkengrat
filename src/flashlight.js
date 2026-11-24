import * as T from 'three';
import { altitude, clamp, mix, smooth } from './math.js';

// Hand torch (placeholder Maglite-style model). F switches it, the mouse wheel turns the head
// from a wide flood (~60 deg) to a tight spot (~11 deg) like a twist-focus torch.
//  - SpotLight in candela with inverse-square fall-off and a projected beam profile:
//    flood = broad with the dark centre hole of a defocused reflector, spot = hot core, a
//    bright ring at its edge, faint reflector rings and a dim spill
//  - the same luminous flux at every focus: a tighter beam is brighter in the centre
//  - shadows from trunks and branches, a little bounce light where the beam lands
//  - the lamp lags the view and sways with breath and steps; the eye adapts to what is lit
//  - a volumetric pass marches the beam through mist against the lamp's shadow map
const FLUX = 14;                                    // scene-scale luminous flux
const COLOR = new T.Color('#fff2e0');              // ~5000 K LED

export function createFlashlight({ scene, camera, collision }) {
  // ---------- model (child of the camera, bottom left)
  const holder = new T.Group();
  camera.add(holder);
  const lamp = new T.Group();
  holder.add(lamp);
  const metal = new T.MeshStandardMaterial({ color: '#17181a', roughness: .42, metalness: .85 });
  const grip = new T.MeshStandardMaterial({ color: '#101113', roughness: .7, metalness: .6 });
  const rubber = new T.MeshStandardMaterial({ color: '#0c0c0c', roughness: .95, metalness: 0 });
  const lensMat = new T.MeshStandardMaterial({ color: '#fdf3e3', emissive: '#fff2e0', emissiveIntensity: 0, roughness: .1, metalness: 0 });
  const part = (geo, mat, z, rot = true) => { const m = new T.Mesh(geo, mat); if (rot) m.rotation.x = Math.PI / 2; m.position.z = z; m.castShadow = false; m.receiveShadow = false; lamp.add(m); return m; };
  part(new T.CylinderGeometry(.0165, .0165, .17, 24), grip, .045);                 // barrel
  for (let i = 0; i < 9; i++) part(new T.TorusGeometry(.0168, .0012, 6, 24), metal, -.005 + i * .012, false); // knurling rings
  part(new T.CylinderGeometry(.018, .017, .02, 24), rubber, .135);                 // tail cap
  const head = new T.Group(); lamp.add(head);
  const headBody = new T.Mesh(new T.CylinderGeometry(.026, .018, .055, 28), metal); headBody.rotation.x = Math.PI / 2; head.add(headBody);
  const bezel = new T.Mesh(new T.TorusGeometry(.0255, .0035, 8, 32), metal); bezel.position.z = -.028; head.add(bezel);
  const lens = new T.Mesh(new T.CircleGeometry(.022, 32), lensMat); lens.position.z = -.0285; lens.rotation.y = Math.PI; head.add(lens);
  const ribs = new T.Mesh(new T.CylinderGeometry(.0262, .0262, .02, 12, 1, true), grip); ribs.rotation.x = Math.PI / 2; ribs.position.z = .004; head.add(ribs);
  head.position.z = -.068;
  lamp.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.material.fog = false; } });
  holder.visible = false;

  // ---------- light
  const light = new T.SpotLight(COLOR, 0, 0, .5, .08, 2);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = .2; light.shadow.camera.far = 55;
  light.shadow.bias = -.0005; light.shadow.normalBias = .03; light.shadow.radius = 2.5;
  light.shadow.autoUpdate = true;
  light.visible = false;
  scene.add(light, light.target);
  const bounce = new T.PointLight(COLOR, 0, 7, 2);
  bounce.castShadow = false; bounce.visible = false;
  scene.add(bounce);

  // ---------- beam profile (projected through the spot's frustum)
  const size = 256, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx2d = canvas.getContext('2d');
  const profile = new T.CanvasTexture(canvas);
  profile.colorSpace = T.SRGBColorSpace;
  profile.wrapS = profile.wrapT = T.ClampToEdgeWrapping;
  light.map = profile;
  // Relative brightness at r = angle / outer half-angle (0..1), focus f 0 = flood .. 1 = spot.
  function beam(r, f) {
    const spot = Math.exp(-((r / mix(.42, .2, f)) ** 2));
    const hotRing = mix(.05, .24, f) * Math.exp(-(((r - mix(.48, .29, f)) / mix(.09, .035, f)) ** 2));
    const hole = 1 - mix(.62, 0, smooth(0, .38, f)) * Math.exp(-((r / .17) ** 2));   // defocused: dark centre
    const flood = (1 - smooth(.5, .98, r)) * mix(.62, .1, f);
    const spill = mix(.12, .05, f) * (1 - smooth(.3, 1, r)) * (1 + .18 * Math.sin(r * 58) * (1 - r));   // reflector rings
    return Math.max(0, (spot * mix(.55, 1, f) + flood) * hole + hotRing + spill);
  }
  let profileFocus = -1;
  function drawProfile(f) {
    const img = ctx2d.createImageData(size, size), data = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (x + .5) / size * 2 - 1, dy = (y + .5) / size * 2 - 1, r = Math.hypot(dx, dy);
      const v = r >= 1 ? 0 : beam(r, f);
      // LED colour: a slightly yellow-green ring at the hotspot edge, cool spill
      const edge = Math.exp(-(((r - mix(.5, .3, f)) / .05) ** 2)) * .18;
      const cool = smooth(.4, 1, r) * .12;
      const k = (y * size + x) * 4;
      data[k] = clamp(v * (1 + edge * .4 - cool * .5) * 255, 0, 255);
      data[k + 1] = clamp(v * (1 + edge * .5 - cool * .15) * 255, 0, 255);
      data[k + 2] = clamp(v * (1 - edge * .6 + cool) * 255, 0, 255);
      data[k + 3] = 255;
    }
    ctx2d.putImageData(img, 0, 0);
    profile.needsUpdate = true;
    profileFocus = f;
  }

  // ---------- state
  let on = false, focus = .55, focusTarget = .55, power = 0;
  const aim = new T.Quaternion(), camQ = new T.Quaternion(), tmpQ = new T.Quaternion(), localQ = new T.Quaternion();
  const origin = new T.Vector3(), dir = new T.Vector3(), tmp = new T.Vector3(), hit = new T.Vector3();
  const halfAngle = () => T.MathUtils.degToRad(mix(31, 5.6, focus));
  const centreCandela = () => FLUX / (2 * Math.PI * (1 - Math.cos(halfAngle() * .55))) * beam(0, focus) * power;
  let hitDistance = 60, adaptation = 1, swayT = 0, aimInit = false;

  function setFocus(v) { focusTarget = clamp(v, 0, 1); }
  function toggle(value = !on) { on = value; holder.visible = true; }

  // Distance to whatever the beam axis hits (trunks, rocks, terrain), for bounce and adaptation.
  function castAxis() {
    tmp.copy(origin).addScaledVector(dir, 60);
    const solid = collision.blocked(origin, tmp);
    let d = solid ? solid.distance : 60;
    for (let s = .5; s < d; s += s < 8 ? .25 : .75) {
      const x = origin.x + dir.x * s, z = origin.z + dir.z * s, y = origin.y + dir.y * s;
      if (altitude(x, z) > y) { d = s; break; }
    }
    return d;
  }

  function update(dt, { bob = 0, stride = 0, motion = 1, walking = 0 } = {}) {
    // Power fades in/out over a few frames (LED driver soft start).
    power = clamp(power + (on ? 1 : -1) * dt * 14, 0, 1);
    if (!on && power === 0) { light.visible = bounce.visible = false; lensMat.emissiveIntensity = 0; holder.visible = false; adaptation = mix(adaptation, 1, 1 - Math.exp(-dt / .9)); return; }
    holder.visible = true;
    focus = mix(focus, focusTarget, 1 - Math.exp(-dt * 7));
    if (Math.abs(focus - profileFocus) > .015) drawProfile(focus);
    // Twist of the head and its travel along the barrel (focus ring).
    head.rotation.z = focus * Math.PI * 1.6;
    head.position.z = -.068 - focus * .006;
    // The lamp follows the view with inertia, breath sway and step bob.
    camera.getWorldQuaternion(camQ);
    if (!aimInit) { aim.copy(camQ); aimInit = true; }
    aim.slerp(camQ, 1 - Math.exp(-dt * 11));
    swayT += dt;
    const sway = .006 * motion, step = .012 * stride * motion;
    tmpQ.setFromEuler(new T.Euler(Math.sin(swayT * 1.3) * sway + Math.cos(bob * 2) * step * .6,
      Math.sin(swayT * .9 + 1) * sway + Math.sin(bob) * step, 0));
    localQ.copy(camQ).invert().multiply(aim).multiply(tmpQ);
    // Bottom left of the view, aimed a little in towards the centre.
    holder.position.set(-.19, -.16, -.36);
    holder.quaternion.copy(localQ);
    lamp.rotation.set(.04, -.09, 0);
    holder.updateMatrixWorld(true);
    lens.getWorldPosition(origin);
    dir.set(0, 0, -1).applyQuaternion(lamp.getWorldQuaternion(tmpQ)).normalize();
    // Light.
    const half = halfAngle();
    light.visible = true;
    light.position.copy(origin).addScaledVector(dir, .02);
    light.target.position.copy(origin).addScaledVector(dir, 10);
    light.target.updateMatrixWorld();
    light.angle = half;
    light.penumbra = .06;
    light.intensity = FLUX / (2 * Math.PI * (1 - Math.cos(half * .55))) * power;   // map carries the shape
    light.shadow.focus = 1;
    lensMat.emissiveIntensity = 3.2 * power;
    // Bounce where the beam lands, and the eye adapting to it.
    hitDistance = castAxis();
    const E = centreCandela() / Math.max(.6, hitDistance * hitDistance);
    hit.copy(origin).addScaledVector(dir, Math.max(.3, hitDistance - .45));
    bounce.visible = hitDistance < 25;
    bounce.position.copy(hit);
    bounce.intensity = E * .16 * power;
    // The eye adapts to the average brightness in view: a lit patch weighs by the share of the
    // field of view it covers (a far, narrow spot is a small bright dot, not a bright scene).
    const fovHalf = T.MathUtils.degToRad(camera.fov * .5) * Math.max(1, camera.aspect * .75);
    const cover = clamp((Math.tan(half) / Math.tan(fovHalf)) ** 2, .06, 1);
    const target = 1 / (1 + E * cover * .9);
    adaptation = mix(adaptation, clamp(target, .32, 1), 1 - Math.exp(-dt / (target < adaptation ? .45 : 1.6)));
  }

  // Illuminance (scene units) the torch puts on a point, ignoring occlusion.
  function illuminance(p) {
    if (!on || power <= 0) return 0;
    tmp.subVectors(p, origin);
    const d = tmp.length();
    const c = tmp.dot(dir) / Math.max(d, 1e-4);
    const half = halfAngle();
    const r = Math.acos(clamp(c, -1, 1)) / half;
    if (r >= 1) return 0;
    return light.intensity * beam(r, focus) / Math.max(.25, d * d);
  }

  return {
    update, toggle, setFocus, illuminance, light, holder,
    get on() { return on; },
    get focus() { return focusTarget; },
    get origin() { return origin; },
    get direction() { return dir; },
    get halfAngle() { return halfAngle(); },
    get adaptation() { return adaptation; },
    get hitDistance() { return hitDistance; },
    get candela() { return centreCandela(); },
    profile, beamProfile: beam,
    wheel(deltaY) { setFocus(focusTarget + (deltaY > 0 ? -1 : 1) * .07); },
  };
}

// Volumetric beam: marches each view ray through the torch cone (exponential steps, dense near
// the lamp where the light is strongest), tests the lamp's shadow map, scatters with a mixed
// phase function through slowly drifting mist. Added to the HDR scene before TAA.
export function createBeamVolume(flashlight, quadVertex) {
  const uniforms = {
    sceneDepth: { value: null }, invProj: { value: new T.Matrix4() }, camWorld: { value: new T.Matrix4() },
    lightPos: { value: new T.Vector3() }, lightDir: { value: new T.Vector3() }, cosOuter: { value: .9 },
    intensity: { value: 0 }, color: { value: COLOR.clone() }, density: { value: .02 }, time: { value: 0 },
    shadowMap: { value: null }, shadowMatrix: { value: new T.Matrix4() }, profile: { value: flashlight.profile },
    halfAngle: { value: .3 }, gain: { value: 1 },
  };
  const material = new T.ShaderMaterial({
    uniforms, vertexShader: quadVertex, depthTest: false, depthWrite: false, transparent: true,
    blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor,
    fragmentShader: `
      #include <packing>
      uniform sampler2D sceneDepth, shadowMap, profile;
      uniform mat4 invProj, camWorld, shadowMatrix;
      uniform vec3 lightPos, lightDir, color;
      uniform float cosOuter, intensity, density, time, halfAngle, gain;
      varying vec2 vUv;
      float hash(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float lit(vec3 p, out vec3 tint){
        vec4 sc=shadowMatrix*vec4(p,1.); sc.xyz/=sc.w;
        tint=vec3(0.);
        if(sc.x<=0.||sc.x>=1.||sc.y<=0.||sc.y>=1.||sc.z>=1.) return 0.;
        tint=texture2D(profile,sc.xy).rgb;
        float occ=unpackRGBAToDepth(texture2D(shadowMap,sc.xy));
        return step(sc.z-.0015,occ);
      }
      void main(){
        float meters=texture2D(sceneDepth,vUv).a;
        vec4 v=invProj*vec4(vUv*2.-1.,1.,1.); v.xyz/=v.w;
        vec3 rayView=normalize(v.xyz);
        float maxT=min(meters/max(1e-3,-rayView.z), 48.);
        vec3 ro=camWorld[3].xyz, rd=normalize(mat3(camWorld)*rayView);
        float dither=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715)))+time*7.31);
        const int STEPS=28;
        float t0=.12, ratio=maxT/t0;
        vec3 sum=vec3(0.); float tPrev=t0;
        for(int i=0;i<STEPS;i++){
          float t=t0*pow(ratio,(float(i)+dither)/float(STEPS));
          float dt=t-tPrev; tPrev=t;
          vec3 p=ro+rd*t;
          vec3 l=p-lightPos; float d=length(l); vec3 ln=l/d;
          float c=dot(ln,lightDir);
          if(c<cosOuter) continue;
          vec3 tint; float s=lit(p,tint);
          if(s<=0.) continue;
          // mist: thicker near the ground and drifting
          float mist=density*(.55+.9*vnoise(p*.55+vec3(time*.12,time*.03,time*.07)))*(1.+.8*exp(-max(0.,p.y-ro.y+1.2)*.7));
          float cosTheta=dot(-ln,-rd);
          float g=.55; float hg=(1.-g*g)/pow(1.+g*g-2.*g*cosTheta,1.5)*.0795775;
          float phase=mix(.0795775,hg,.45);
          sum+=tint*color*(intensity/max(.8,d*d))*smoothstep(.15,1.4,d)*mist*phase*exp(-density*t)*dt;
        }
        gl_FragColor=vec4(sum*gain,0.);
      }`,
  });
  const camInv = new T.Matrix4();
  return {
    material, uniforms,
    gain: .05,
    get enabled() { return flashlight.on || flashlight.light.intensity > 0 && flashlight.light.visible; },
    prepare(camera, sceneDepth, time, density) {
      const l = flashlight.light;
      uniforms.sceneDepth.value = sceneDepth;
      uniforms.invProj.value.copy(camera.projectionMatrixInverse);
      uniforms.camWorld.value.copy(camera.matrixWorld);
      uniforms.lightPos.value.copy(l.position);
      uniforms.lightDir.value.copy(flashlight.direction);
      uniforms.cosOuter.value = Math.cos(l.angle);
      uniforms.intensity.value = l.intensity;
      uniforms.time.value = time;
      uniforms.density.value = density;
      uniforms.gain.value = this.gain;
      uniforms.shadowMap.value = l.shadow.map?.texture ?? null;
      uniforms.shadowMatrix.value.copy(l.shadow.matrix);
      return !!uniforms.shadowMap.value;
    },
  };
}
