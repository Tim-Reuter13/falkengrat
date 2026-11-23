import * as T from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { altitude, getTerrainGrid, mix, noise, pathX, random, riverGlsl, riverX, riverWidth, TAU, overlook } from './math.js';
import { floorGlsl } from './groundcover.js';
import { waterContact } from './water-contact.js';

const glsl = `
  varying vec3 vLand;
  float hash21(vec2 p){
    p = fract(p * vec2(123.34,456.21));
    p += dot(p, p+45.32);
    return fract(p.x*p.y);
  }
  float noise2(vec2 p){
    vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),
      mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y);
  }
`;

// Each triangle interpolates three individually oriented patches. Shared lattice vertices
// have identical transforms on both sides of an edge, including their normal-map frames.
const patchesGlsl=`
  struct Patch { vec2 offset; mat2 axis; };
  Patch patchAt(vec2 tile){
    float a=6.2831853*hash21(tile+19.3);
    return Patch(vec2(hash21(tile+77.),hash21(tile+131.))*11.,
      mat2(cos(a),sin(a),-sin(a),cos(a)));
  }
  struct Field { Patch a; Patch b; Patch c; vec3 w; };
  Field fieldAt(vec2 p){
    vec2 warp=vec2(noise2(p*.087+91.),noise2(p*.069+24.))*.73;
    vec2 skew=mat2(1.,0.,.57735,1.1547)*p*.203+warp;
    vec2 cell=floor(skew),f=fract(skew);
    float upper=step(1.,f.x+f.y);
    vec2 v0=cell+upper;
    vec3 w=upper>.5?vec3(f.x+f.y-1.,1.-f.y,1.-f.x):vec3(1.-f.x-f.y,f.x,f.y);
    w=pow(max(w,vec3(0.)),vec3(2.4));w/=max(.001,dot(w,vec3(1.)));
    return Field(patchAt(v0),patchAt(cell+vec2(1,0)),patchAt(cell+vec2(0,1)),w);
  }
  vec3 patchSample(sampler2D tex,Patch tile,vec2 p,vec2 dx,vec2 dy){
    return textureGrad(tex,tile.axis*p+tile.offset,tile.axis*dx,tile.axis*dy).rgb;
  }
  vec3 fieldSample(sampler2D tex,Field f,vec2 p){
    vec2 dx=dFdx(p),dy=dFdy(p);
    return patchSample(tex,f.a,p,dx,dy)*f.w.x+patchSample(tex,f.b,p,dx,dy)*f.w.y+patchSample(tex,f.c,p,dx,dy)*f.w.z;
  }
  vec2 fieldNormal(sampler2D tex,Field f,vec2 p){
    vec2 dx=dFdx(p),dy=dFdy(p);
    return ((patchSample(tex,f.a,p,dx,dy).xy*2.-1.)*f.a.axis)*f.w.x+
           ((patchSample(tex,f.b,p,dx,dy).xy*2.-1.)*f.b.axis)*f.w.y+
           ((patchSample(tex,f.c,p,dx,dy).xy*2.-1.)*f.c.axis)*f.w.z;
  }
  vec3 layerSample(sampler2DArray tex,Field f,vec2 p,float layer){
    vec2 dx=dFdx(p),dy=dFdy(p);
    return textureGrad(tex,vec3(f.a.axis*p+f.a.offset,layer),f.a.axis*dx,f.a.axis*dy).rgb*f.w.x+
           textureGrad(tex,vec3(f.b.axis*p+f.b.offset,layer),f.b.axis*dx,f.b.axis*dy).rgb*f.w.y+
           textureGrad(tex,vec3(f.c.axis*p+f.c.offset,layer),f.c.axis*dx,f.c.axis*dy).rgb*f.w.z;
  }
  vec2 layerNormal(sampler2DArray tex,Field f,vec2 p,float layer){
    vec2 dx=dFdx(p),dy=dFdy(p);
    vec2 a=textureGrad(tex,vec3(f.a.axis*p+f.a.offset,layer),f.a.axis*dx,f.a.axis*dy).xy*2.-1.;
    vec2 b=textureGrad(tex,vec3(f.b.axis*p+f.b.offset,layer),f.b.axis*dx,f.b.axis*dy).xy*2.-1.;
    vec2 c=textureGrad(tex,vec3(f.c.axis*p+f.c.offset,layer),f.c.axis*dx,f.c.axis*dy).xy*2.-1.;
    return a*f.a.axis*f.w.x+b*f.b.axis*f.w.y+c*f.c.axis*f.w.z;
  }
  // Gradient-explicit variants: derivatives are taken once in uniform control flow,
  // so these samples may sit inside the weight branches of the terrain shader.
  vec3 fieldSampleG(sampler2D tex,Field f,vec2 p,vec2 dx,vec2 dy){
    return patchSample(tex,f.a,p,dx,dy)*f.w.x+patchSample(tex,f.b,p,dx,dy)*f.w.y+patchSample(tex,f.c,p,dx,dy)*f.w.z;
  }
  vec2 fieldNormalG(sampler2D tex,Field f,vec2 p,vec2 dx,vec2 dy){
    return ((patchSample(tex,f.a,p,dx,dy).xy*2.-1.)*f.a.axis)*f.w.x+
           ((patchSample(tex,f.b,p,dx,dy).xy*2.-1.)*f.b.axis)*f.w.y+
           ((patchSample(tex,f.c,p,dx,dy).xy*2.-1.)*f.c.axis)*f.w.z;
  }
  vec3 layerSampleG(sampler2DArray tex,Field f,vec2 p,float layer,vec2 dx,vec2 dy){
    return textureGrad(tex,vec3(f.a.axis*p+f.a.offset,layer),f.a.axis*dx,f.a.axis*dy).rgb*f.w.x+
           textureGrad(tex,vec3(f.b.axis*p+f.b.offset,layer),f.b.axis*dx,f.b.axis*dy).rgb*f.w.y+
           textureGrad(tex,vec3(f.c.axis*p+f.c.offset,layer),f.c.axis*dx,f.c.axis*dy).rgb*f.w.z;
  }
  vec2 layerNormalG(sampler2DArray tex,Field f,vec2 p,float layer,vec2 dx,vec2 dy){
    vec2 a=textureGrad(tex,vec3(f.a.axis*p+f.a.offset,layer),f.a.axis*dx,f.a.axis*dy).xy*2.-1.;
    vec2 b=textureGrad(tex,vec3(f.b.axis*p+f.b.offset,layer),f.b.axis*dx,f.b.axis*dy).xy*2.-1.;
    vec2 c=textureGrad(tex,vec3(f.c.axis*p+f.c.offset,layer),f.c.axis*dx,f.c.axis*dy).xy*2.-1.;
    return a*f.a.axis*f.w.x+b*f.b.axis*f.w.y+c*f.c.axis*f.w.z;
  }
`;

function mapMaterials(material, uniforms, fragment, normals = '') {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLand;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 landVertex=vec4(position,1.);
      #ifdef USE_INSTANCING
        landVertex=instanceMatrix*landVertex;
      #endif
      vLand=(modelMatrix*landVertex).xyz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + glsl + fragment.declarations);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', fragment.color);
    if (normals) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', normals);
  };
  material.customProgramCacheKey = () => fragment.color;
  return material;
}

function terrainSections(scene, material) {
  const {xs,zs,elevations}=getTerrainGrid();
  const h=(x,z)=>elevations[z*xs.length+x];
  for(let j=0;j<zs.length-1;j+=40)for(let i=0;i<xs.length-1;i+=40){
    const nx=Math.min(41,xs.length-i),nz=Math.min(41,zs.length-j), pos=[],normals=[],indices=[];
    for(let b=0;b<nz;b++)for(let a=0;a<nx;a++){
      const x=i+a,z=j+b,x0=Math.max(0,x-1),x1=Math.min(xs.length-1,x+1),z0=Math.max(0,z-1),z1=Math.min(zs.length-1,z+1);
      pos.push(xs[x],h(x,z),zs[z]);
      const gx=(h(x1,z)-h(x0,z))/(xs[x1]-xs[x0]),gz=(h(x,z1)-h(x,z0))/(zs[z1]-zs[z0]);
      const length=Math.hypot(gx,1,gz);
      normals.push(-gx/length,1/length,-gz/length);
      if(a<nx-1&&b<nz-1){const n=b*nx+a;indices.push(n,n+nx,n+1,n+1,n+nx,n+nx+1);}
    }
    const geo=new T.BufferGeometry();
    geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));
    geo.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geo.setIndex(indices);
    const mesh=new T.Mesh(geo,material);mesh.receiveShadow=true;scene.add(mesh);
  }
}

// Shared clock for the animated stream-bed caustics; the air effects advance it each frame.
export const terrainTime = { value: 0 };

const causticGlsl = `
  uniform float causticTime;
  vec2 hash22(vec2 p){ vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); q+=dot(q,q.yzx+33.33); return fract((q.xx+q.yz)*q.zy); }
  // Distance between the two nearest moving feature points: thin bright seams where cells meet,
  // the net of light a rippled surface focuses onto a shallow bed.
  float causticCells(vec2 p,float t){
    vec2 g=floor(p),f=fract(p);
    float d1=8.,d2=8.;
    for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
      vec2 c=vec2(i,j),o=hash22(g+c);
      o=.5+.42*sin(t+6.2831*o);
      vec2 r=c+o-f;
      float d=dot(r,r);
      if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
    }
    return sqrt(d2)-sqrt(d1);
  }
  float causticAt(vec2 p,float t,float blur){
    float a=1.-smoothstep(0.,.09+blur,causticCells(p*1.35,t*.9));
    float b=1.-smoothstep(0.,.11+blur,causticCells(p*1.95+vec2(4.1,7.3),-t*.73+1.7));
    return a*a*.55+b*b*.35+a*b*.9;
  }
`;

export function createTerrain(scene, textures, floor) {
  const { earth, moss, limestone, groundNormal, meadow, turf, needles, meadowNormal } = textures;
  const material = mapMaterials(new T.MeshPhysicalMaterial({roughness:.98,specularIntensity:.12}), {
    earth: {value:earth}, moss:{value:moss}, bedrock:{value:limestone}, groundNormal:{value:groundNormal},
    meadow:{value:meadow}, turf:{value:turf}, needles:{value:needles}, meadowNormal:{value:meadowNormal},
    soilSwatches:{value:textures.soilSwatches},soilNormals:{value:textures.soilNormals},
    floorMask:{value:floor.texture},disturbedSoil:{value:floor.soil},causticTime:terrainTime,
  }, {
    declarations: `uniform sampler2D earth,moss,bedrock,groundNormal,meadow,turf,needles,meadowNormal;
      uniform highp sampler2DArray soilSwatches,soilNormals;
      uniform sampler2D disturbedSoil;
      ${causticGlsl}
      ${floorGlsl}
      ${riverGlsl}
      ${patchesGlsl}`,
    color: `
      // Each layer is only sampled where its final weight is above zero. Blend order and
      // constants match the unbranched version, so the image is unchanged.
      vec2 p=vLand.xz;
      vec3 ldx=dFdx(vLand),ldy=dFdy(vLand);
      vec2 gx=ldx.xz,gy=ldy.xz;
      Field field=fieldAt(p);
      vec4 ground=floorAt(p);
      vec3 nWorld=inverseTransformDirection(normalize(vNormal),viewMatrix);
      float broad=noise2(p*.063+9.);
      float speckle=noise2(p*.53)*.67+noise2(p*1.49-7.)*.33;
      float stone=smoothstep(.20,.57,1.-abs(nWorld.y))*(1.-ground.r*.91);
      float trailEdge=smoothstep(.31,.91,ground.r+(speckle-.53)*.44);
      float bank=riverBankAt(p);
      float bankWeight=1.-smoothstep(.40,2.60,bank+(speckle-.5)*.57);
      float extraShore=1.-smoothstep(-.08,1.9,bank+(speckle-.5)*1.45+(broad-.5)*.58);
      float wetShore=1.-smoothstep(-.36,.25,bank+(speckle-.5)*.41);
      float blendShore=extraShore*smoothstep(.15,.80,extraShore);
      float dig=texture2D(disturbedSoil,(p+vec2(352.,490.))/704.).r;
      vec3 leafBed=fieldSampleG(needles,field,p*.69+.18,gx*.69,gy*.69);
      vec3 bare=fieldSampleG(earth,field,p*.77,gx*.77,gy*.77);
      vec3 soil=mix(leafBed,bare,smoothstep(.31,.71,speckle)*.56);
      vec3 grass=fieldSampleG(meadow,field,p*.87,gx*.87,gy*.87);
      float bladeColor=dot(grass,vec3(.23,.65,.12));
      float grow=smoothstep(.18,.74,ground.g+(speckle-.46)*.28+bladeColor*.42)*(1.-ground.r*.80);
      vec3 sod=vec3(0.);
      if(grow>0.){
        vec3 woodland=fieldSampleG(turf,field,p*.72,gx*.72,gy*.72);
        sod=mix(woodland,grass,smoothstep(.33,.78,ground.g+speckle*.19)*.85);
        float mossCover=smoothstep(.55,.81,ground.b+(speckle-.5)*.24)*.63;
        if(mossCover>0.)sod=mix(sod,fieldSampleG(moss,field,p*.94,gx*.94,gy*.94)*.70,mossCover);
      }
      vec3 base=mix(soil,sod,grow);
      vec3 gravel=vec3(0.);
      if(stone>0.||trailEdge>0.||bankWeight>0.||blendShore>0.){
        gravel=fieldSampleG(bedrock,field,p*.74+vLand.y*.11,gx*.74+ldx.y*.11,gy*.74+ldy.y*.11);
        if(stone>.075){
          vec2 sides=pow(abs(nWorld.xz),vec2(3.));
          vec3 wall=mix(fieldSampleG(bedrock,field,vLand.xy*.56,ldx.xy*.56,ldy.xy*.56),
            fieldSampleG(bedrock,field,vLand.zy*.56,ldx.zy*.56,ldy.zy*.56),
            sides.x/max(.0001,sides.x+sides.y));
          gravel=mix(gravel,wall,stone);
        }
      }
      base=mix(base,mix(gravel*.64,soil,.19),stone*.87);
      base=mix(base,mix(bare*.86,gravel*.74,.12+speckle*.20),trailEdge*.82);
      base=mix(base,mix(gravel,soil*.85,.22+speckle*.20)*mix(.56,1.,smoothstep(-.5,2.,bank)),bankWeight);
      float moisture=ground.b+(speckle-.50)*.29;
      float leafiness=smoothstep(.35,.65,noise2(p*.123+vec2(29,13))*.74+speckle*.26);
      float mossiness=smoothstep(.50,.73,moisture)*smoothstep(.2,.87,ground.g+speckle*.53);
      float scree=stone*smoothstep(.36,.65,broad*.65+speckle*.35);
      float siltiness=smoothstep(.36,.67,noise2(p*.77+42.)*.52 + .54*smoothstep(.2,2.2,-bank));
      float gravelly=smoothstep(.48,.77,noise2(p*.36+17.)*.77+speckle*.23);
      vec2 materialUv=p*.85;
      vec2 mx=gx*.85,my=gy*.85;
      float forestLayer=leafiness>.50?1.:0.;
      float forestWeight=smoothstep(.04,.30,abs(leafiness-.50))*.67;
      vec3 humus=vec3(0.);
      if(forestWeight>0.||dig>0.)humus=layerSampleG(soilSwatches,field,materialUv,forestLayer,mx,my);
      vec3 habitat=mix(soil,humus*.91,forestWeight);
      if(mossiness>0.)habitat=mix(habitat,layerSampleG(soilSwatches,field,materialUv*.82,2.,mx*.82,my*.82)*.95,mossiness*.85);
      base=mix(habitat,base,max(grow*.88,stone*.92));
      float pathWeight=trailEdge*mix(.24,.63,speckle)*smoothstep(.03,1.19,bank);
      float stoneWeight=scree*.79;
      float exposedLayer=pathWeight>stoneWeight?3.:7.;
      float exposedWeight=max(pathWeight,stoneWeight);
      vec3 dustyPebbles=vec3(0.);
      if((exposedWeight>0.&&trailEdge>0.)||blendShore>0.)
        dustyPebbles=layerSampleG(soilSwatches,field,materialUv*1.12,4.,mx*1.12,my*1.12);
      if(exposedWeight>0.){
        vec3 exposed=layerSampleG(soilSwatches,field,materialUv,exposedLayer,mx,my);
        vec3 dirt=mix(exposed*vec3(.69,.61,.52),dustyPebbles*.46,gravelly*.25);
        base=mix(base,mix(exposed*.81,dirt,trailEdge),exposedWeight);
      }
      float submerged=siltiness>.50?6.:5.;
      if(blendShore>0.){
        float bedWeight=smoothstep(.03,.24,abs(siltiness-.50))*.91;
        vec3 wetMix=gravel*.67;
        if(bedWeight>0.&&wetShore>0.)
          wetMix=mix(wetMix,layerSampleG(soilSwatches,field,materialUv*.83,submerged,mx*.83,my*.83)*.79,bedWeight);
        vec3 shoreline=mix(dustyPebbles*vec3(.69,.67,.59),wetMix,wetShore);
        base=mix(base,shoreline,blendShore*.86);
      }
      if(dig>0.){
        vec3 turned=mix(bare*.70,humus*vec3(.62,.55,.49),speckle);
        base=mix(base,turned,dig*.95);
      }
      float shoreLayer=wetShore>.48?submerged:4.;
      float growthShadow=mix(1.,.24,ground.a);
      float waterDepth=riverLevelAt(vLand.z)-vLand.y;
      if(waterDepth>0.&&bank<.5){
        // Fade the net out before it gets finer than a pixel or the water too deep to focus.
        float footprint=max(length(gx),length(gy))*1.95;
        float sharpness=1.-smoothstep(.10,.42,footprint);
        float shallow=smoothstep(0.,.05,waterDepth)*(1.-smoothstep(.35,1.5,waterDepth));
        if(sharpness*shallow>0.){
          vec2 bed=p+vec2(sin(causticTime*.31+p.y*.2),cos(causticTime*.27+p.x*.2))*.12;
          float light=causticAt(bed,causticTime*1.1,footprint*.6);
          base*=1.+vec3(1.,.97,.86)*light*1.05*sharpness*shallow;
        }
      }
      float dapple=mix(.83,1.07,smoothstep(.27,.76,noise2(p*.24+vec2(vLand.y*.135,0.))));
      float macro=noise2(p*.018+15.)*.64+noise2(p*.041-11.)*.36;
      diffuseColor.rgb*=base*mix(vec3(.79,.87,.83),vec3(1.13,1.06,.94),macro)*mix(.86,1.16,broad)*dapple*growthShadow;
    `,
  }, `
    // Beyond 110 m the relief weight is zero, so the normal-map reads are skipped.
    float nearSurface=1.-smoothstep(24.,110.,length(vViewPosition));
    if(nearSurface>0.){
      vec2 earthN=fieldNormalG(groundNormal,field,vLand.xz*.77,gx*.77,gy*.77);
      vec2 localNormal=earthN;
      float meadowWeight=smoothstep(.19,.75,ground.g);
      if(meadowWeight>0.)localNormal=mix(earthN,fieldNormalG(meadowNormal,field,vLand.xz*.87,gx*.87,gy*.87),meadowWeight);
      float landLayer=exposedWeight>.24?exposedLayer:mossiness>.51?2.:forestLayer;
      float layer=mix(landLayer,shoreLayer,step(.49,blendShore));
      float normalWeight=.56+.10*blendShore;
      localNormal=mix(localNormal,layerNormalG(soilNormals,field,materialUv,layer,mx,my),normalWeight);
      localNormal=mix(localNormal,earthN*1.35,dig*.70);
      vec3 tangentX=normalize((viewMatrix*vec4(1.,0.,0.,0.)).xyz);
      vec3 tangentZ=normalize((viewMatrix*vec4(0.,0.,1.,0.)).xyz);
      vec3 relief=localNormal.x*tangentX+localNormal.y*tangentZ;
      normal=normalize(normal+(relief-normal*dot(normal,relief))*1.20*nearSurface);
    }
  `);
  terrainSections(scene,material);
}

export function rockGeometry(seed, detail) {
  const rand = random(seed);
  let geometry = new T.IcosahedronGeometry(1, detail);
  const p = geometry.attributes.position;
  const vertexColor = [];
  const warp = rand() * 16;
  const shelf=.55+rand()*.33,tiltX=(rand()-.50)*.75,tiltZ=(rand()-.48)*.57;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const coarse=noise(x*2.9+y*1.4+warp,z*2.8-y*2);
    const bedding=Math.sin((y+x*.23-z*.12)*19+warp+coarse*2);
    const size=.82+coarse*.29+noise(x*12+y*6+warp,z*10-y*3)*.09+bedding*.038;
    const fracture=Math.min(x*size+.10*y,.64+.13*y+.16*z);
    const crown=shelf+tiltX*x+tiltZ*z+.13*(coarse-.5)+bedding*.017;
    const bottom=y*size-Math.pow(Math.max(0,-y-.29),1.55)*.76;
    p.setXYZ(i,fracture,Math.min(bottom,crown),z*size-y*.19);
    const side = .72 + noise(x * 9 + y * 2, z * 9 + warp) * .33;
    vertexColor.push(side, side, side);
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(vertexColor, 3));
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry=mergeVertices(geometry,.0003);
  geometry.computeVertexNormals();
  return geometry;
}

// Rock material: world-space triplanar granite/limestone with moss and wet banks.
export function rockMaterial(textures) {
  return mapMaterials(new T.MeshPhysicalMaterial({vertexColors:true,roughness:.98,specularIntensity:.15}), {
    granite: { value: textures.granite }, moss: { value: textures.moss }, rockNormal: { value: textures.rockNormal },
    limestone:{value:textures.limestone}, limestoneNormal:{value:textures.limestoneNormal},
  }, {
    declarations: `uniform sampler2D granite,moss,rockNormal,limestone,limestoneNormal;
      ${riverGlsl}`,
    color: `
      vec3 n=abs(inverseTransformDirection(normalize(vNormal),viewMatrix));
      vec3 weight=pow(n,vec3(4.)); weight/=max(.0001,dot(weight,vec3(1.)));
      vec3 stone=texture2D(granite,vLand.yz*.64).rgb*weight.x+
        texture2D(granite,vLand.xz*.64).rgb*weight.y+texture2D(granite,vLand.xy*.64).rgb*weight.z;
      vec3 shale=texture2D(limestone,vLand.yz*.38).rgb*weight.x+
        texture2D(limestone,vLand.xz*.38).rgb*weight.y+texture2D(limestone,vLand.xy*.38).rgb*weight.z;
      float mineral=smoothstep(.27,.70,noise2(vLand.xz*.50+vLand.y*.33));
      float growth=smoothstep(.39,.76,noise2(vLand.xz*1.7+vLand.y*.16))*smoothstep(.39,.84,n.y);
      diffuseColor.rgb*=mix(mix(stone,shale,mineral*.76)*.79,
        texture2D(moss,vLand.xz*.82).rgb*.62,growth*.76);
      float edgeY=vLand.y-riverLevelAt(vLand.z);
      float bank=riverBankAt(vLand.xz);
      float dryEdge=.18+noise2(vLand.xz*4.92)*.135;
      float wet=(1.-smoothstep(-.05,.48,bank))*(1.-smoothstep(.035,dryEdge,edgeY));
      diffuseColor.rgb*=mix(vec3(1.),vec3(.54,.61,.60),wet*.76);
      float film=(1.-smoothstep(.02,.12,edgeY))*smoothstep(-.77,-.32,edgeY)*wet;
      float colonies=smoothstep(.43,.75,noise2(vLand.xz*1.78)*.57+noise2(vLand.xy*9.1)*.43);
      diffuseColor.rgb*=mix(vec3(1.),vec3(.57,.90,.38),film*colonies*.76);
    `,
  }, `
    vec2 nx=mix(texture2D(rockNormal,vLand.yz*.64).xy,texture2D(limestoneNormal,vLand.yz*.38).xy,mineral*.76)*2.-1.;
    vec2 ny=mix(texture2D(rockNormal,vLand.xz*.64).xy,texture2D(limestoneNormal,vLand.xz*.38).xy,mineral*.76)*2.-1.;
    vec2 nz=mix(texture2D(rockNormal,vLand.xy*.64).xy,texture2D(limestoneNormal,vLand.xy*.38).xy,mineral*.76)*2.-1.;
    vec3 bump=vec3(0.,nx)*weight.x+vec3(ny.x,0.,ny.y)*weight.y+vec3(nz,0.)*weight.z;
    vec3 stoneN=inverseTransformDirection(normal,viewMatrix);
    stoneN=normalize(stoneN+(bump-stoneN*dot(stoneN,bump))*1.43*(1.-smoothstep(24.,89.,length(vViewPosition))));
    normal=normalize((viewMatrix*vec4(stoneN,0.)).xyz);
  `);
}

export function createRocks(scene, textures, collision) {
  const rand = random(849674);
  const object = new T.Object3D();
  const mat = rockMaterial(textures);
  const landmarks = [
    [-7.8,-10,3.3,2.3,2.8],[10.2,-14,3.6,2.6,2.4],[-4.7,-26,2.5,1.7,1.45],
    [16,-36,3.4,3.0,2.2],[-11,-49,4.4,3.3,2.8],[overlook.x-5,-118,3.9,2.1,3.7],
    [overlook.x+6,-124,3.5,1.5,3.3],
  ];
  const groups = [[], [], [], []];
  const perches=[],contacts=[],waterObstacles=[];
  const candidate=new T.Vector3(),highest=new T.Vector3(),up=new T.Vector3(0,1,0),slopeNormal=new T.Vector3();
  const authoredRotation=new T.Quaternion(),seatRotation=new T.Quaternion();
  for(let i=0;i<790;i++){
    const z=mix(-427,104,rand()),sign=rand()<.5?-1:1;
    const x=riverX(z)+sign*(riverWidth(z)+mix(-2.8,2.65,rand()));
    const size=rand()<.22?mix(.5,1.55,rand()):mix(.06,.41,rand());
    groups[size>.45?Math.floor(rand()*3):3].push({x,z,sx:size*1.16,sy:size*.84,sz:size});
  }
  for(let i=0;i<82;i++){
    const z=mix(-439,-159,rand()),x=mix(-202,202,rand()),size=mix(1.6,7.1,rand()**1.7);
    if(Math.abs(x-pathX(z))<4)continue;
    groups[i%3].push({x,z,sx:size*1.52,sy:size*.88,sz:size});
  }
  for (const [x,z,sx,sy,sz] of landmarks) groups[Math.floor(rand()*3)].push({x,z,sx,sy,sz});
  for (let i = 0; i < 1350; i++) {
    const z = mix(-244, 83, rand()), x = mix(-146, 146, rand());
    const d = Math.abs(x - pathX(z));
    const big = rand() < .17 && d > 3.8;
    if (!big && d < 2.2 && rand() > .22) continue;
    const size = big ? mix(.43, 2.48, rand()**2) : mix(.044, .34, rand()**2);
    groups[big ? Math.floor(rand()*3) : 3].push({x,z,sx:size*mix(.88,1.53,rand()),sy:size*mix(.42,.91,rand()),sz:size});
  }
  groups.forEach((group, index) => {
    const mesh = new T.InstancedMesh(rockGeometry(8421 + index * 64, index === 3 ? 1 : 5),mat,group.length);
    const pos=mesh.geometry.attributes.position;
    group.forEach(({x,z,sx,sy,sz}, i) => {
      const ground=altitude(x,z),extent=Math.max(sx,sz);
      object.position.set(x,ground+sy*.16,z);
      object.scale.set(sx,sy,sz);
      const pitch=(rand()-.5)*.38,yaw=rand()*TAU,roll=(rand()-.5)*.28;
      object.rotation.set(pitch,yaw,roll,'YXZ');
      if(sx>.45){
        const gx=(altitude(x+.61,z)-altitude(x-.61,z))/1.22;
        const gz=(altitude(x,z+.61)-altitude(x,z-.61))/1.22;
        slopeNormal.set(-gx*.66,1,-gz*.66).normalize();
        authoredRotation.copy(object.quaternion);
        object.quaternion.copy(seatRotation.setFromUnitVectors(up,slopeNormal)).multiply(authoredRotation);
        object.updateMatrix();
        const support=[Infinity,Infinity,Infinity,Infinity];
        for(let j=0;j<pos.count;j++){
          if(pos.getY(j)>-.40)continue;
          candidate.fromBufferAttribute(pos,j).applyMatrix4(object.matrix);
          const quadrant=Number(candidate.x>x)+2*Number(candidate.z>z);
          support[quadrant]=Math.min(support[quadrant],candidate.y-altitude(candidate.x,candidate.z));
        }
        const gap=Math.max(...support.filter(Number.isFinite));
        if(gap>-.045)object.position.y-=gap+.045;
      }
      object.updateMatrix();
      mesh.setMatrixAt(i, object.matrix);
      mesh.setColorAt(i,new T.Color().setRGB(.86+rand()*.14,.88+rand()*.12,.84+rand()*.14));
      if(sx>.29 && sy>.22)collision.addMesh(x,z,mesh.geometry,object.matrix,'rock');
      if(extent>.19)contacts.push({x,z,rx:sx*.81,rz:sz*.80,yaw});
      const wake=extent>.20?waterContact(mesh.geometry,object.matrix,x,z,extent):null;
      if(wake)waterObstacles.push(wake);
      if(sx>.52 && sy>.38 && z<30 && z>-210 && Math.abs(x-pathX(z))<34){
        highest.set(x,-Infinity,z);
        for(let j=0;j<pos.count;j++){
          candidate.fromBufferAttribute(pos,j).applyMatrix4(object.matrix);
          if(candidate.y>highest.y)highest.copy(candidate);
        }
        perches.push(highest.clone());
      }
    });
    mesh.castShadow = index !== 3;
    mesh.receiveShadow = true;
    scene.add(mesh);
  });
  return {perches,contacts,waterObstacles};
}
