import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { altitude, fbm, mix, pathX, random, riverBank, smooth, TAU, overlook } from './math.js';
import { forestHaze, hazeColor, nightShade, sunDirection } from './atmosphere.js';
import { floorGlsl, forestAlbedoGlsl } from './groundcover.js';

const angularViews = 8;
const tileWidth = 512;
const tileHeight = 1024;
const atlasWidth = tileWidth * 4;
const atlasHeight = tileHeight * 2;
const bakedWidth = .53;
const bakedHeight = 1.08;
const ditherGlsl = `
  float dither(vec2 p) {
    return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));
  }
`;

function branchTube(points, radius, sides = 5, trunk = false) {
  const curve = new T.CatmullRomCurve3(points);
  const segments = trunk ? 16 : points.length;
  const geometry = new T.TubeGeometry(curve,segments,radius,sides,false);
  const p = geometry.attributes.position;
  const length=curve.getLength();
  const vertex = new T.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i/segments, center = curve.getPointAt(t);
    const taper = Math.pow(1-t,trunk?.84:1)*.94+.06;
    for (let j = 0; j <= sides; j++) {
      const index = i*(sides+1)+j;
      vertex.fromBufferAttribute(p,index).lerp(center,1-taper);
      p.setXYZ(index,vertex.x,vertex.y,vertex.z);
      geometry.attributes.uv.setXY(index,j/sides*(trunk?2:1),t*length*(trunk?17:28));
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function makeTree(species) {
  const rand = random(15512+species*8172);
  const wood = [], shades = [];
  const root = new T.Vector3(0,-.024,0);
  const tip = new T.Vector3((rand()-.5)*.037,1.01,(rand()-.5)*.026);
  wood.push(branchTube([root, new T.Vector3(.006,.24,-.009),new T.Vector3(-.008,.58,.005),tip],species ? .023 : .025,11,true));
  for (let i = 0; i < 5; i++) {
    const phi = (i+.35)*TAU/5;
    const reach = .029+rand()*.029;
    wood.push(branchTube([new T.Vector3(0,.035,0),new T.Vector3(Math.cos(phi)*.023,.008,Math.sin(phi)*.023),
      new T.Vector3(Math.cos(phi)*reach,-.021,Math.sin(phi)*reach)],.010,4));
  }
  const positions = [], uvs = [];
  for (let layer = 0; layer < 18; layer++) {
    const h = .19 + layer*.045;
    const count = layer > 12 ? 4 : 6;
    for (let b = 0; b < count; b++) {
      if (layer < 3 && rand() < (species ? .19 : .50)) continue;
      const y = h + (rand()-.5)*.046;
      const angle = TAU * (b/count + layer*.377 + rand()*.106);
      const radial = new T.Vector3(Math.sin(angle),0,Math.cos(angle));
      const tangent = new T.Vector3(radial.z,0,-radial.x);
      const length = (species ? .236 : .193)*Math.pow(1-y,.76)*mix(.66,1.36,rand());
      const root = new T.Vector3(tip.x*y,y,tip.z*y);
      const bend = mix(-.047,.027,rand()) * (1-y);
      const start = root.clone().addScaledVector(radial,.004);
      const middle = root.clone().addScaledVector(radial,length*.55);
      middle.y += bend-.009;
      const end = root.clone().addScaledVector(radial,length);
      end.y += bend+.016;
      if (layer < 11) wood.push(branchTube([start,middle,end],(.0025+length*.012)*(1-y),4));
      for (let twig = 0; twig < (layer > 13 ? 5 : 8); twig++) {
        const f = (twig+1) / 9, side = twig%2 ? -1 : 1;
        const origin = root.clone().addScaledVector(radial,length*f*.82);
        origin.y += bend*f;
        const axis = radial.clone().multiplyScalar(mix(.37,.85,f)).addScaledVector(tangent,side*mix(.55,.9,rand()));
        axis.y = mix(-.37,.1,rand());
        axis.normalize();
        const width = (.014 + length*.18) * mix(.72,1.33,rand()) * (1-f*.45);
        const extent = (length*(.73-f*.45)+.017)*mix(.74,1.20,rand());
        for (let card = 0; card < 2; card++) {
          const across = new T.Vector3().crossVectors(axis,new T.Vector3(0,1,0)).normalize();
          across.applyAxisAngle(axis, (card ? 1.14 : -.23) + (rand()-.5)*.62).multiplyScalar(width);
          const a = origin.clone().sub(across);
          const b = origin.clone().add(across);
          const c = b.clone().addScaledVector(axis,extent);
          const d = a.clone().addScaledVector(axis,extent);
          for (const p of [a,d,b,b,d,c]) positions.push(p.x,p.y,p.z);
          uvs.push(0,0,1,0,0,1,0,1,1,0,1,1);
          const light = mix(.53,1.19,rand()) * (.80+y*.26);
          const tint = species ? [light*1.08,light,light*.75] : [light*.82,light,light*.92];
          for (let i = 0; i < 6; i++) shades.push(...tint);
        }
      }
    }
  }
  const leaves = new T.BufferGeometry();
  leaves.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  leaves.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
  leaves.setAttribute('color',new T.Float32BufferAttribute(shades,3));
  leaves.computeVertexNormals();
  const trunk = mergeGeometries(wood);
  wood.forEach(g => g.dispose());
  return { trunk, leaves };
}

function bakeTree(renderer, tree, material) {
  const stage = new T.Scene();
  stage.add(new T.HemisphereLight('#fff5e2','#596858',2.30));
  const sun = new T.DirectionalLight('#fff0c9',1.54);
  sun.position.set(2,5,3);
  stage.add(sun, new T.Mesh(tree.trunk,material.wood), new T.Mesh(tree.leaves,material.leaves));
  const camera = new T.OrthographicCamera(-bakedWidth/2,bakedWidth/2,bakedHeight/2,-bakedHeight/2,.1,4);
  const target = new T.WebGLRenderTarget(atlasWidth,atlasHeight,{
    minFilter:T.LinearMipmapLinearFilter, magFilter:T.LinearFilter, generateMipmaps:true,
  });
  const oldAlpha = renderer.getClearAlpha();
  const oldColor = renderer.getClearColor(new T.Color());
  renderer.autoClear = false;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0,0);
  renderer.clear();
  for (let i = 0; i < angularViews; i++) {
    const angle=i/angularViews*TAU;
    const centerY = .512;
    camera.position.set(Math.sin(angle)*2,centerY,Math.cos(angle)*2);
    camera.lookAt(0,centerY,0);
    target.viewport.set((i%4)*tileWidth,Math.floor(i/4)*tileHeight,tileWidth,tileHeight);
    renderer.setRenderTarget(target);
    renderer.render(stage,camera);
  }
  renderer.setRenderTarget(null);
  renderer.setClearColor(oldColor,oldAlpha);
  renderer.autoClear = true;
  return target;
}

export function exportTreeAtlas(renderer, targets) {
  return targets.map(target => {
    const pixels = new Uint8Array(atlasWidth*atlasHeight*4);
    renderer.readRenderTargetPixels(target,0,0,atlasWidth,atlasHeight,pixels);
    const canvas = document.createElement('canvas');
    canvas.width = atlasWidth;
    canvas.height = atlasHeight;
    const context = canvas.getContext('2d');
    const image = context.createImageData(atlasWidth,atlasHeight);
    // Preserve linear albedo in the PNG. The runtime deliberately loads it as data.
    const rowSize = atlasWidth*4;
    for (let row = 0; row < atlasHeight; row++) {
      const from = (atlasHeight-row-1)*rowSize;
      image.data.set(pixels.subarray(from,from+rowSize),row*rowSize);
    }
    context.putImageData(image,0,0);
    return canvas.toDataURL('image/png');
  });
}

function fadingMaterial(source, lod) {
  const material = source.clone();
  material.onBeforeCompile = shader => {
    shader.uniforms.lod = lod;
    shader.vertexShader = shader.vertexShader.replace('#include <common>','#include <common>\nvarying float vDistance;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vec3 root=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
      vDistance=length(cameraPosition.xz-root.xz);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying float vDistance;uniform vec2 lod;' + ditherGlsl);
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      if(dither(gl_FragCoord.xy)<smoothstep(lod.x,lod.y,vDistance))discard;
    `);
  };
  return material;
}

function cardGeometry(entries) {
  const source = new T.PlaneGeometry(1,1);
  const geometry = new T.InstancedBufferGeometry();
  geometry.index = source.index;
  geometry.attributes.position = source.attributes.position;
  geometry.attributes.uv = source.attributes.uv;
  geometry.setAttribute('origin',new T.InstancedBufferAttribute(new Float32Array(entries.flatMap(e=>[e.x,e.y,e.z,e.height])),4));
  geometry.setAttribute('traits',new T.InstancedBufferAttribute(new Float32Array(entries.flatMap(e=>[e.width,e.angle,e.seed,e.tone])),4));
  geometry.instanceCount = entries.length;
  return geometry;
}

function treeCards(scene, entries, atlas, photograph, time, lod, reach, species) {
  const uniforms = {
    atlas: { value:atlas }, farTree: { value:photograph }, clock:time, lod, reach,
    fogTone: { value:hazeColor }, sunDir: { value:sunDirection }, species: { value:species }, nightShade,
  };
  const material = new T.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute vec4 origin,traits;
      uniform float clock,reach;
      uniform vec2 lod;
      varying vec2 vUv;
      varying vec4 vInfo;
      void main(){
        vec2 delta=cameraPosition.xz-origin.xz;
        float distanceToTree=length(delta);
        vec2 viewer=delta/max(distanceToTree,.001);
        vec2 right=vec2(viewer.y,-viewer.x);
        float angle=atan(viewer.x,viewer.y)-traits.y;
        float wind=sin(clock*.91+origin.x*.17+origin.z*.063)*.62+
          sin(clock*1.82+traits.z*8.6)*.38;
        vec3 p=origin.xyz+vec3(right.x*position.x*traits.x,(uv.y*1.08-.028)*origin.w,right.y*position.x*traits.x);
        p.xz+=vec2(.21,.12)*uv.y*uv.y*wind*origin.w/25.;
        vInfo=vec4(fract(angle/6.2831853)*8.,distanceToTree,traits.w,traits.z);
        vUv=uv;
        // Near trees are fully drawn as 3D geometry; skip rasterising their full-size cards.
        gl_Position=distanceToTree>reach||distanceToTree<=lod.x ? vec4(2.,2.,2.,1.) : projectionMatrix*viewMatrix*vec4(p,1.);
      }
    `,
    fragmentShader: `
      uniform sampler2D atlas,farTree;
      uniform vec2 lod;
      uniform vec3 fogTone, sunDir, nightShade;
      uniform float species;
      varying vec2 vUv;
      varying vec4 vInfo;
      ${ditherGlsl}
      vec4 viewAt(float i,vec2 uv){
        vec2 tile=vec2(mod(i,4.),floor(mod(i,8.)/4.));
        return texture2D(atlas,(tile+clamp(uv,vec2(.006),vec2(.994)))/vec2(4.,2.));
      }
      void main(){
        float dist=vInfo.y;
        float grain=dither(gl_FragCoord.xy);
        if(grain>=smoothstep(lod.x,lod.y,dist)) discard;
        vec4 pixel;
        float farMix=smoothstep(74.,115.,dist);
        if (farMix>fract(grain+.37)) {
          vec2 uv=vec2((vUv.x-.5)*mix(1.31,1.02,species)+.5, vUv.y*1.08-.008);
          if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))discard;
          pixel=texture2D(farTree,uv);
          pixel.rgb*=vec3(.48,.53,.46);
        } else {
          float view=floor(vInfo.x);
          float blend=smoothstep(0.,1.,fract(vInfo.x));
          vec2 offset=vec2((vUv.x-.5)*.045*(1.-smoothstep(18.,80.,dist)),0.);
          vec4 a=viewAt(view,vUv+offset*blend);
          vec4 b=viewAt(view+1.,vUv-offset*(1.-blend));
          float alpha=mix(a.a,b.a,blend);
          vec3 rgb=mix(a.rgb,b.rgb,blend)/max(.12,alpha);
          pixel=vec4(rgb,alpha);
        }
        if(pixel.a<.15 || pixel.a<mix(.28,.77,fract(grain+.19)))discard;
        vec3 color=pixel.rgb*vInfo.z;
        color*=mix(vec3(.67,.75,.71),vec3(1.14,1.08,.94),smoothstep(.07,.97,vUv.y))*nightShade;
        float fog=1.-exp(-pow(dist*${forestHaze},2.));
        color=mix(color,fogTone,fog);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new T.Mesh(cardGeometry(entries),material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh.geometry;
}

function addCanopyShadow(scene, geometry, atlas) {
  const caster = new T.Mesh(geometry,new T.MeshBasicMaterial({colorWrite:false,depthWrite:false}));
  const depth = new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,side:T.DoubleSide});
  depth.onBeforeCompile = shader => {
    shader.uniforms.treeAtlas={value:atlas};
    shader.uniforms.sunDir={value:sunDirection};
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute vec4 origin,traits;
      uniform vec3 sunDir;
      varying vec2 casterUv;
      varying float casterAngle;
    `).replace('#include <begin_vertex>',`
      vec2 sun=normalize(sunDir.xz);
      vec2 right=vec2(sun.y,-sun.x);
      casterUv=uv;
      casterAngle=fract((atan(sun.x,sun.y)-traits.y)/6.2831853)*8.;
      vec3 transformed=origin.xyz+vec3(right.x*position.x*traits.x,
        (uv.y*1.08-.028)*origin.w,right.y*position.x*traits.x);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform sampler2D treeAtlas;
      varying vec2 casterUv;
      varying float casterAngle;
      float opacityAt(float view) {
        vec2 tile=vec2(mod(view,4.),floor(mod(view,8.)/4.));
        return texture2D(treeAtlas,(tile+clamp(casterUv,vec2(.006),vec2(.994)))/vec2(4.,2.)).a;
      }
    `).replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      float view=floor(casterAngle);
      if(mix(opacityAt(view),opacityAt(view+1.),fract(casterAngle))<.53)discard;
    `);
  };
  caster.customDepthMaterial=depth;
  caster.castShadow=true;
  caster.frustumCulled=false;
  scene.add(caster);
}

export function createForest(scene, renderer, textures, collision, time) {
  const rand = random(48135);
  const groups = [[],[]];
  const add = (x,z,height,species) => {
    if(riverBank(x,z)<1.15)return;
    // Low, open talus above the ford gives the overlook a view across the valley.
    const downValley=-118-z;
    if(downValley>0 && downValley<126){
      const gap=Math.abs(x-(overlook.x+downValley*.26));
      const width=9+downValley*.24;
      if(gap<width){
        const clearing=smooth(0,10,downValley)*(1-smooth(width*.43,width,gap));
        if(clearing>.45&&rand()<clearing*.52)return;
        height*=1-clearing*.78;
      }
    }
    const entry = {x,y:altitude(x,z),z,height,width:height*bakedWidth,angle:rand()*TAU,seed:rand(),tone:mix(.56,1.02,rand())};
    groups[species].push(entry);
    if (z > -260 && Math.abs(x) < 160) collision.add(x,z,height*.022,'tree',height);
  };
  [
    [-4.55,-7.3,23.5,0],[9.15,-9.25,20.8,1],[-5.6,-13,20.9,1],[6.7,-23,23.8,0],
    [-9.35,-21,24.9,0],[18,-22,22,0],[-2.0,-33,20.1,1],[9.0,-38,26,1],
    [-12.3,-39,28,0],[3.9,-50,21.2,0],[-12.5,-58,20.5,1], [9.2,-63,19.4,1],
    [-8.1,-76,20.3,0],[7.7,-82,22.0,0],[overlook.x-15,-103,20.3,0],
    [overlook.x+15,-105,23.7,0],[-8.8,4.5,24.7,1],[4.0,5.4,23.9,0],
  ].forEach(entry=>add(...entry));
  for (let z=-373;z<123;z+=6.8) {
    for (let x=-231;x<231;x+=6.8) {
      const px=x+(rand()-.5)*5.8, pz=z+(rand()-.5)*5.8;
      const away=Math.abs(px-pathX(pz));
      if (away<3.7 || (away<10.5 && pz>-48)) continue;
      if (pz<1&&pz>-88&&Math.abs(px-(-pz+2.8)*.585)<5.8)continue;
      const opening=(px-overlook.x)**2/440+(pz+122)**2/510;
      if (opening<.83) continue;
      if (pz<-48 && pz>-108 && away<7.7 && rand()<.76) continue;
      if (rand() > .40+.48*fbm(x*.019,z*.019)) continue;
      if (groups.some(group=>group.slice(0,18).some(e=>(e.x-px)**2+(e.z-pz)**2<14))) continue;
      const h=mix(7,24,rand()**.80)*mix(.85,1.23,fbm(px*.035,pz*.033));
      add(px,pz,h,rand()<.57 ? 0 : 1);
    }
  }
  for(let z=-454;z<-166;z+=7.6)for(let x=-275;x<276;x+=7.6){
    const px=x+rand()*6,pz=z+rand()*6;
    const grove=fbm(px*.027,pz*.025);
    if(grove<.48||rand()>.60||Math.abs(px-pathX(pz))<2.8)continue;
    add(px,pz,mix(4.8,16,rand())*(.74+grove*.56),rand()<.46?0:1);
  }
  const wood = new T.MeshPhysicalMaterial({map:textures.bark,roughness:1,specularIntensity:.13,normalMap:textures.barkNormal,normalScale:new T.Vector2(.94,.94)});
  const leaves = new T.MeshPhysicalMaterial({
    map:textures.sprig,alphaTest:.40,vertexColors:true,side:T.DoubleSide,roughness:.89,
    color:new T.Color().setRGB(.67,1.10,.72),specularIntensity:.14,
  });
  const lod={value:new T.Vector2(14,24)}, reach={value:410};
  const geometry = [makeTree(0),makeTree(1)];
  const targets = textures.atlasFir && textures.atlasSpruce ? [] : geometry.map(tree=>bakeTree(renderer,tree,{wood,leaves}));
  const atlasTextures = targets.length ? targets.map(t=>t.texture) : [textures.atlasFir,textures.atlasSpruce];
  const models = geometry.map((tree,i) => {
    const cards=treeCards(scene,groups[i],atlasTextures[i],i ? textures.spruce : textures.fir,time,lod,reach,i);
    addCanopyShadow(scene,cards,atlasTextures[i]);
    const trunk = new T.InstancedMesh(tree.trunk,fadingMaterial(wood,lod),160);
    const crown = new T.InstancedMesh(tree.leaves,fadingMaterial(leaves,lod),160);
    scene.add(trunk,crown);
    trunk.receiveShadow = true;
    crown.receiveShadow = true;
    // Near trunks and branches cast shadows for the hand torch only (layer 3); the sun and moon
    // keep using the canopy silhouettes.
    trunk.castShadow = crown.castShadow = true;
    trunk.layers.set(3); crown.layers.set(3);
    trunk.frustumCulled = crown.frustumCulled = false;
    return {trunk,crown};
  });
  let lastX=Infinity,lastZ=Infinity,lastLod=0;
  const object = new T.Object3D();
  return {
    count:groups[0].length+groups[1].length,
    // Tree records {x,y,z,height} for effects that anchor to crowns (light shafts).
    trees:groups.flat(),
    targets,
    update(position,quality) {
      reach.value=quality.distance;
      lod.value.set(quality.treeNear*.66,quality.treeNear);
      if(Math.hypot(lastX-position.x,lastZ-position.z)<5 && lastLod===quality.treeNear) return;
      lastX=position.x; lastZ=position.z; lastLod=quality.treeNear;
      groups.forEach((trees,species)=>{
        const {trunk,crown}=models[species];
        let index=0;
        for (const e of trees) {
          if ((e.x-position.x)**2+(e.z-position.z)**2 > (quality.treeNear+7)**2 || index>=160) continue;
          object.position.set(e.x,e.y,e.z);
          object.rotation.set(0,e.angle,0);
          object.scale.setScalar(e.height);
          object.updateMatrix();
          trunk.setMatrixAt(index,object.matrix);
          crown.setMatrixAt(index,object.matrix);
          index++;
        }
        trunk.count=crown.count=index;
        trunk.instanceMatrix.needsUpdate=crown.instanceMatrix.needsUpdate=true;
      });
    },
  };
}

export function createUnderstory(scene, textures, time,floor) {
  const rand=random(72654);
  const entries=[];
  for (let i=0;i<1930;i++) {
    let z=mix(-182,65,rand()), x=mix(-105,105,rand());
    if(i<1230) {
      z=mix(-132,29,rand());
      x=pathX(z)+(rand()-.5)*45;
    }
    const ground=floor.at(x,z);
    if(ground.trail>.22||ground.shade>.61||rand()>ground.moisture*.94+.28)continue;
    const height=mix(.107,.47,rand()**1.75),width=height*mix(1.60,2.12,rand());
    const a=rand()*TAU, tone=mix(.62,1.19,rand())*mix(.79,1.,ground.moisture);
    const y=altitude(x,z)-.025;
    entries.push({x,y,z,height,width,angle:a,seed:rand(),tone});
    if(height>.27&&i<900)entries.push({x,y:y+.010,z,height:height*.77,width,angle:a+1.61,seed:rand(),tone});
  }
  const reach={value:75};
  const mat=new T.MeshLambertMaterial({map:textures.fern,color:0xbbc5af,side:T.DoubleSide});
  const geometry=cardGeometry(entries);
  const surfaceNormals=new Float32Array(entries.length*2);
  entries.forEach(({x,z},i)=>{
    surfaceNormals[i*2]=(altitude(x-.18,z)-altitude(x+.18,z))/.36;
    surfaceNormals[i*2+1]=(altitude(x,z-.18)-altitude(x,z+.18))/.36;
  });
  geometry.setAttribute('terrainSlope',new T.InstancedBufferAttribute(surfaceNormals,2));
  mat.onBeforeCompile=shader=>{
    shader.uniforms.clock=time;
    shader.uniforms.reach=reach;
    shader.uniforms.floorMask={value:floor.texture};
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute vec4 origin,traits;
      attribute vec2 terrainSlope;
      uniform float clock,reach;
      varying vec3 info;
      varying vec2 root;
      varying vec3 frondNormal;
    `).replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
      vec2 delta=cameraPosition.xz-origin.xz;
      float d=length(delta);
      vec2 facing=vec2(sin(traits.y),cos(traits.y));
      if(dot(facing,delta)<0.)facing=-facing;
      facing=normalize(mix(facing,delta/max(d,.001),smoothstep(3.,22.,d)*.83));
      vec3 slope=normalize(vec3(terrainSlope.x*.49,1.,terrainSlope.y*.49));
      float tilt=mix(.28,.11,uv.y);
      objectNormal=normalize(slope+vec3(facing.x*tilt,0.,facing.y*tilt));
      frondNormal=normalize((viewMatrix*vec4(objectNormal,0.)).xyz);
    `).replace('#include <begin_vertex>',`#include <begin_vertex>
      vec2 right=vec2(facing.y,-facing.x);
      float sway=sin(clock*1.83+origin.x*.34+origin.z*.16)+sin(clock*2.71+traits.z*9.)*.31;
      transformed=origin.xyz+vec3(right.x*position.x*traits.x,uv.y*origin.w,right.y*position.x*traits.x);
      transformed.xz+=(vec2(.12,.056)*sway+facing*.10)*uv.y*uv.y*origin.w;
      root=origin.xz;
      info=vec3(d,traits.w,traits.z);
    `).replace('#include <project_vertex>',`#include <project_vertex>
      if(d>reach)gl_Position=vec4(2.,2.,2.,1.);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform float reach;
      varying vec3 info;
      varying vec2 root;
      varying vec3 frondNormal;
      ${floorGlsl}
      ${ditherGlsl}
      ${forestAlbedoGlsl}
    `).replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      float grain=dither(gl_FragCoord.xy);
      if(diffuseColor.a<mix(.32,.54,grain)||grain<smoothstep(reach*.73,reach,info.x))discard;
      vec4 ground=floorAt(root);
      float height=clamp(vMapUv.y,0.,1.);
      diffuseColor.rgb=matteAlbedo(diffuseColor.rgb)*info.y*
        mix(.61,1.,smoothstep(.06,.76,height))*mix(.89,.46,ground.a);
    `).replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
      normal=normalize(frondNormal);`);
  };
  const mesh=new T.Mesh(geometry,mat);
  mesh.receiveShadow=true;
  mesh.frustumCulled=false;
  scene.add(mesh);
  return distance=>{reach.value=distance;};
}
