import * as T from 'three';
import { altitude, mix, random, riverBank, riverX, waterLevel } from './math.js';
import { daylight, hazeColor, sunDirection } from './atmosphere.js';
import { terrainTime } from './landscape.js';

// Air effects drawn after all opaque passes (grass included): sun shafts under the crowns,
// low mist along the stream and dust motes that glint when you look toward the sun.
// Each one fades softly into the scene using the linear depth stored in the opaque copy.

const softDepthGlsl = `
  uniform sampler2D sceneDepth;
  uniform vec2 viewport;
  float sceneMeters(){ return texture2D(sceneDepth,gl_FragCoord.xy/viewport).a; }
`;

const valueNoiseGlsl = `
  float hash12(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
  float vnoise(vec2 p){
    vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x),mix(hash12(i+vec2(0,1)),hash12(i+1.),f.x),f.y);
  }
`;

function instancedQuad(capacity, attributes) {
  const source = new T.PlaneGeometry(1, 1);
  const geometry = new T.InstancedBufferGeometry();
  geometry.index = source.index;
  geometry.setAttribute('position', source.attributes.position);
  geometry.setAttribute('uv', source.attributes.uv);
  for (const name of attributes)
    geometry.setAttribute(name, new T.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(T.DynamicDrawUsage));
  geometry.instanceCount = 0;
  return geometry;
}

function lightShafts(scene, shared, trees) {
  const capacity = 48;
  const geometry = instancedQuad(capacity, ['top', 'shape']);
  const material = new T.ShaderMaterial({
    uniforms: shared, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    vertexShader: `
      attribute vec4 top,shape;
      uniform vec3 sunDir;
      varying vec2 beamUv;
      varying vec3 world;
      varying float eye,seed,strength;
      void main(){
        vec3 axis=-sunDir;
        vec3 center=top.xyz+axis*top.w*.5;
        vec3 side=normalize(cross(axis,center-cameraPosition));
        world=top.xyz+axis*top.w*(1.-uv.y)+side*position.x*shape.x;
        beamUv=uv;seed=shape.y;strength=shape.z;
        vec4 view=viewMatrix*vec4(world,1.);
        eye=-view.z;
        gl_Position=projectionMatrix*view;
      }`,
    fragmentShader: `
      uniform vec3 sunDir,sunTint;
      uniform float time,shaftLevel;
      ${softDepthGlsl}
      varying vec2 beamUv;
      varying vec3 world;
      varying float eye,seed,strength;
      void main(){
        float across=beamUv.x*2.-1.;
        float profile=exp(-across*across*3.2)*(1.-smoothstep(.62,1.,abs(across)));
        float strands=.72+.28*sin(across*7.3+seed*41.)*sin(across*3.1-seed*17.);
        float along=smoothstep(0.,.22,beamUv.y)*(1.-smoothstep(.62,1.,beamUv.y));
        float breathing=.78+.22*sin(time*.37+seed*29.);
        float d=length(world-cameraPosition);
        float distanceFade=smoothstep(2.2,7.,d)*(1.-smoothstep(26.,36.,d));
        // Forward scattering: shafts read clearly against the sun, faintly with it behind you.
        float mu=max(dot(normalize(world-cameraPosition),sunDir),0.);
        float phase=.16+.84*mu*mu*mu;
        float soft=clamp((sceneMeters()-eye)/1.6,0.,1.);
        float light=profile*strands*along*breathing*distanceFade*phase*soft*strength*shaftLevel;
        if(light<.0005)discard;
        gl_FragColor=vec4(sunTint*light,1.);
      }`,
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  scene.add(mesh);
  const top = geometry.attributes.top, shape = geometry.attributes.shape;
  const foot = new T.Vector3();
  let lastX = Infinity, lastZ = Infinity;
  return position => {
    if (Math.hypot(position.x - lastX, position.z - lastZ) < 3) return;
    lastX = position.x; lastZ = position.z;
    const near = [];
    for (const tree of trees) {
      const d = Math.hypot(tree.x - position.x, tree.z - position.z);
      if (d < 36 && tree.height > 9) near.push([d, tree]);
    }
    near.sort((a, b) => a[0] - b[0]);
    let count = 0;
    for (const [, tree] of near) {
      // Same tree, same shaft: offsets come from the tree's own seed, so nothing pops while walking.
      const rand = random(Math.floor(tree.seed * 1e6) + 17);
      if (rand() > .5) continue;
      for (let k = 0; k < 2 && count < capacity; k++) {
        if (k === 1 && rand() > .35) break;
        const angle = rand() * Math.PI * 2, reach = tree.height * mix(.10, .26, rand());
        const x = tree.x + Math.cos(angle) * reach, z = tree.z + Math.sin(angle) * reach;
        const y = tree.y + tree.height * mix(.48, .78, rand());
        let length = (y - altitude(x, z)) / sunDirection.y;
        for (let i = 0; i < 2; i++) {
          foot.set(x, y, z).addScaledVector(sunDirection, -length);
          length = (y - altitude(foot.x, foot.z)) / sunDirection.y;
        }
        if (length < 3) continue;
        top.setXYZW(count, x, y, z, length + .6);
        shape.setXYZW(count, mix(.45, 1.5, rand()), rand(), mix(.55, 1., rand()), 0);
        count++;
      }
      if (count >= capacity) break;
    }
    geometry.instanceCount = count;
    top.needsUpdate = shape.needsUpdate = true;
  };
}

function groundMist(scene, shared) {
  const capacity = 56;
  const rand = random(90217);
  const banks = [];
  // Mist gathers over the stream and in the damp hollows beside it.
  for (let z = -330; z < 110; z += 7.5) {
    const x = riverX(z) + (rand() - .5) * 7;
    banks.push({ x, y: Math.max(waterLevel(z), altitude(x, z)), z, width: mix(7, 13, rand()), height: mix(1.4, 2.6, rand()), seed: rand() });
    if (rand() < .55) {
      const side = (rand() < .5 ? -1 : 1) * mix(6, 16, rand());
      const sx = riverX(z) + side, sz = z + (rand() - .5) * 6;
      if (riverBank(sx, sz) > 0) banks.push({ x: sx, y: altitude(sx, sz), z: sz, width: mix(6, 11, rand()), height: mix(1.1, 2.1, rand()), seed: rand() });
    }
  }
  const geometry = instancedQuad(capacity, ['origin', 'shape']);
  const material = new T.ShaderMaterial({
    uniforms: shared, transparent: true, depthWrite: false, side: T.DoubleSide,
    vertexShader: `
      attribute vec4 origin,shape;
      varying vec2 mistUv;
      varying vec3 world;
      varying float eye,seed;
      void main(){
        vec2 toward=normalize(cameraPosition.xz-origin.xz+vec2(.0001));
        vec2 right=vec2(toward.y,-toward.x);
        world=origin.xyz+vec3(right.x*position.x*shape.x,(uv.y-.12)*shape.y,right.y*position.x*shape.x);
        mistUv=uv;seed=shape.z;
        vec4 view=viewMatrix*vec4(world,1.);
        eye=-view.z;
        gl_Position=projectionMatrix*view;
      }`,
    fragmentShader: `
      uniform vec3 sunDir,sunTint,mistTint;
      uniform float time,mistLevel;
      ${softDepthGlsl}
      ${valueNoiseGlsl}
      varying vec2 mistUv;
      varying vec3 world;
      varying float eye,seed;
      void main(){
        vec2 p=vec2(mistUv.x*3.1,mistUv.y*1.3)+seed*17.;
        vec2 drift=vec2(time*.035,-time*.012);
        float n=vnoise(p+drift)*.62+vnoise(p*2.3-drift*1.7)*.38;
        float across=mistUv.x*2.-1.;
        float envelope=(1.-smoothstep(.35,1.,abs(across)))*(1.-smoothstep(.12,1.,mistUv.y))*smoothstep(0.,.12,mistUv.y);
        float density=envelope*smoothstep(.28,.82,n);
        float d=length(world-cameraPosition);
        float distanceFade=smoothstep(3.5,11.,d)*(1.-smoothstep(70.,96.,d));
        float soft=clamp((sceneMeters()-eye)/2.4,0.,1.);
        float alpha=density*distanceFade*soft*mistLevel;
        if(alpha<.002)discard;
        float mu=max(dot(normalize(world-cameraPosition),sunDir),0.);
        vec3 color=mistTint+sunTint*(.05+.32*mu*mu*mu*mu);
        gl_FragColor=vec4(color,alpha);
      }`,
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);
  const origin = geometry.attributes.origin, shape = geometry.attributes.shape;
  let lastX = Infinity, lastZ = Infinity, lastLimit = -1;
  return (position, limit) => {
    if (Math.hypot(position.x - lastX, position.z - lastZ) < 4 && limit === lastLimit) return;
    lastX = position.x; lastZ = position.z; lastLimit = limit;
    const near = banks.map(b => [Math.hypot(b.x - position.x, b.z - position.z), b]).filter(([d]) => d < 98).sort((a, b) => a[0] - b[0]);
    const count = Math.min(limit, near.length);
    for (let i = 0; i < count; i++) {
      const b = near[i][1];
      origin.setXYZW(i, b.x, b.y, b.z, 0);
      shape.setXYZW(i, b.width, b.height, b.seed, 0);
    }
    geometry.instanceCount = count;
    origin.needsUpdate = shape.needsUpdate = true;
  };
}

function dustMotes(scene, shared) {
  const capacity = 900, box = 14;
  const rand = random(55120);
  const seeds = new Float32Array(capacity * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(capacity * 3), 3));
  geometry.setAttribute('seed', new T.BufferAttribute(seeds, 4));
  const material = new T.ShaderMaterial({
    uniforms: shared, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: `
      attribute vec4 seed;
      uniform float time;
      uniform vec2 screen;
      uniform vec3 sunDir;
      varying float glow,eye;
      const float box=${box.toFixed(1)};
      void main(){
        vec3 drift=vec3(sin(time*.11+seed.w*40.)*.9+time*.05,sin(time*.07+seed.x*31.)*.35+sin(time*.5+seed.y*9.)*.04,cos(time*.09+seed.z*27.)*.9);
        vec3 p=mod(seed.xyz*box+drift-cameraPosition+box*.5,box)-box*.5+cameraPosition;
        vec4 view=viewMatrix*vec4(p,1.);
        float d=-view.z;
        eye=d;
        gl_Position=projectionMatrix*view;
        gl_PointSize=clamp(.016*screen.y*projectionMatrix[1][1]/max(d,.1),1.2,4.);
        float mu=max(dot(normalize(p-cameraPosition),sunDir),0.);
        float twinkle=.55+.45*sin(time*(1.6+seed.w*2.)+seed.x*60.);
        glow=(.05+.95*pow(mu,6.))*twinkle*smoothstep(.5,1.6,d)*(1.-smoothstep(4.5,6.8,d));
      }`,
    fragmentShader: `
      uniform vec3 sunTint;
      uniform float dustLevel;
      uniform sampler2D sceneDepth;
      uniform vec2 screen;
      varying float glow,eye;
      void main(){
        // Drawn onto the finished frame, so hide motes behind anything nearer than themselves.
        vec4 behind=texture2D(sceneDepth,gl_FragCoord.xy/screen);
        if(behind.a<eye-.08)discard;
        // Specks only read against shade; in front of bright sky they vanish, as in real backlight.
        float contrast=1.-smoothstep(.06,.30,dot(behind.rgb,vec3(.2126,.7152,.0722)));
        vec2 q=gl_PointCoord*2.-1.;
        float disc=1.-smoothstep(.2,1.,dot(q,q));
        float light=glow*disc*dustLevel*contrast;
        if(light<.001)discard;
        gl_FragColor=vec4(sunTint*light,1.);
      }`,
  });
  const points = new T.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  return limit => geometry.setDrawRange(0, Math.min(capacity, limit));
}

// river.opaque holds the half-size scene copy with linear depth in alpha; river.size is the render size.
// Dust motes are drawn after anti-aliasing (postScene): temporal accumulation would erase
// specks this small and this fast.
export function createAirEffects(clock, trees, river) {
  const scene = new T.Scene(), postScene = new T.Scene();
  const linear = hazeColor.clone();
  // Day and night looks of the air. At night the shafts become faint cold moonbeams and the
  // mist thickens and turns pale; dust only glints in sunlight.
  const looks = {
    day: { tint:new T.Color(1, .86, .64), mist:new T.Color(linear.r * .62, linear.g * .66, linear.b * .70), shaft:.11, fog:.16, dust:.5 },
    night: { tint:new T.Color(.50, .62, .92), mist:new T.Color(.016, .021, .030), shaft:.032, fog:.42, dust:0 },
  };
  const shared = {
    time: clock, sceneDepth: river.opaque, viewport: river.size,
    sunDir: { value: sunDirection }, sunTint: { value: new T.Color(1, .86, .64) },
    mistTint: { value: new T.Color(linear.r * .62, linear.g * .66, linear.b * .70) },
    shaftLevel: { value: .11 }, mistLevel: { value: .16 }, dustLevel: { value: .5 },
    screen: { value: new T.Vector2(1, 1) },
  };
  const updateShafts = lightShafts(scene, shared, trees);
  const updateMist = groundMist(scene, shared);
  const setDust = dustMotes(postScene, shared);
  if (new URLSearchParams(location.search).has('dev')) window.falkengratAir = shared;
  return {
    scene, postScene,
    update(position, quality, canvas) {
      shared.screen.value.set(canvas.width, canvas.height);
      terrainTime.value = clock.value;
      const d = daylight.value;
      shared.sunTint.value.lerpColors(looks.night.tint, looks.day.tint, d);
      shared.mistTint.value.lerpColors(looks.night.mist, looks.day.mist, d);
      shared.shaftLevel.value = T.MathUtils.lerp(looks.night.shaft, looks.day.shaft, d);
      shared.mistLevel.value = T.MathUtils.lerp(looks.night.fog, looks.day.fog, d);
      shared.dustLevel.value = T.MathUtils.lerp(looks.night.dust, looks.day.dust, d);
      const level = quality.name === 'Performance' ? 0 : quality.name === 'Cinematic' ? 2 : 1;
      updateShafts(position);
      updateMist(position, [22, 40, 56][level]);
      setDust([300, 600, 900][level]);
    },
  };
}
