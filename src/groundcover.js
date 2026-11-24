import * as T from 'three';
import { altitude, clamp, fbm, mix, noise, pathX, random, riverBank, riverWidth, riverX, smooth, TAU } from './math.js';
import { outerFloor } from './region/woodland.js';
import { rootingMask } from './animal-traces.js';

const startX=-352,startZ=-490,extent=704,resolution=1024;
const pxPerMeter=resolution/extent;

export function createForestFloor(collision, rockContacts) {
  const pixels=new Uint8Array(resolution*resolution*4);
  const exposed=new Uint8Array(resolution*resolution);
  const index=(x,z)=>4*(Math.min(resolution-1,Math.max(0,Math.floor((z-startZ)*pxPerMeter)))*resolution+
    Math.min(resolution-1,Math.max(0,Math.floor((x-startX)*pxPerMeter))));
  for(let j=0;j<resolution;j++){
    const z=startZ+(j+.5)/pxPerMeter, center=pathX(z);
    for(let i=0;i<resolution;i++){
      const x=startX+(i+.5)/pxPerMeter;
      const fine=noise(x*.58,z*.56);
      const patch=fbm(x*.071+7,z*.079-11);
      const broad=noise(x*.024+17,z*.026+1);
      const d=Math.abs(x-center);
      const track=1-smooth(.67,1.65,d+(fine-.5)*.52);
      const damp=fbm(x*.12-10,z*.12+3);
      const cover=smooth(.28,.69,patch*.64+broad*.26+fine*.10+.115)*smooth(.79,1.94,d+(fine-.5)*.37);
      const offset=4*(j*resolution+i);
      const dry=smooth(.15,1.85,riverBank(x,z));
      const disturbed=rootingMask(x,z,fine-.5)*dry;
      pixels[offset]=Math.round(Math.max(track,1-dry)*255);
      pixels[offset+1]=Math.round(cover*dry*(1-disturbed*.97)*255);
      pixels[offset+2]=Math.round(damp*255);
      pixels[offset+3]=0;
      exposed[j*resolution+i]=Math.round(disturbed*255);
    }
  }
  collision.forEach(item=>{
    if(item.type==='rock'||item.type==='driftwood'||item.type==='fallen'||item.type==='root')return;
    const spread=item.type==='tree'?item.radius*3.2:item.radius*1.52;
    const range=spread*1.60;
    for(let dz=-range;dz<range;dz+=1/pxPerMeter){
      for(let dx=-range;dx<range;dx+=1/pxPerMeter){
        const a=index(item.x+dx,item.z+dz);
        const d=Math.hypot(dx,dz)/spread;
        const occlusion=(1-smooth(.28,1.4,d))*(item.type==='tree'?.70:.82);
        pixels[a+3]=Math.max(pixels[a+3],Math.round(occlusion*255));
      }
    }
  });
  for(const {x,z,rx,rz,yaw} of rockContacts){
    const c=Math.cos(yaw),s=Math.sin(yaw),range=Math.max(rx,rz)*1.58;
    for(let dz=-range;dz<=range;dz+=1/pxPerMeter)for(let dx=-range;dx<=range;dx+=1/pxPerMeter){
      const d=Math.hypot((dx*c-dz*s)/rx,(dx*s+dz*c)/rz);
      const a=index(x+dx,z+dz);
      pixels[a+3]=Math.max(pixels[a+3],Math.round(250*(1-smooth(.62,1.42,d))));
    }
  }
  const texture=new T.DataTexture(pixels,resolution,resolution,T.RGBAFormat,T.UnsignedByteType);
  texture.minFilter=texture.magFilter=T.LinearFilter;
  texture.needsUpdate=true;
  const soil=new T.DataTexture(exposed,resolution,resolution,T.RedFormat,T.UnsignedByteType);
  soil.minFilter=soil.magFilter=T.LinearFilter;soil.needsUpdate=true;
  return {
    texture,soil,
    at(x,z) {
      if(x < -230 || x > 230 || z < -450 || z > 125)return outerFloor(x,z);
      const p=index(x,z);
      return {trail:pixels[p]/255,grass:pixels[p+1]/255,moisture:pixels[p+2]/255,shade:pixels[p+3]/255};
    },
  };
}

export const floorGlsl=`
  uniform sampler2D floorMask;
  vec4 floorAt(vec2 world){return texture2D(floorMask,(world+vec2(352.,490.))/704.);}
`;

export const forestAlbedoGlsl=`
  vec3 matteAlbedo(vec3 color){
    float luminance=dot(color,vec3(.2126,.7152,.0722));
    float bakedHighlight=smoothstep(.10,.62,luminance);
    return mix(vec3(luminance),color,.91)*mix(1.,.62,bakedHighlight);
  }
`;

export const bladesPerTuft=12;

function grassGeometry() {
  const rng=random(125842);
  const positions=[],indices=[],colors=[],roots=[];
  const colorsByHeight=['#374125','#505935','#626c40'].map(hex=>new T.Color(hex));
  for(let i=0;i<bladesPerTuft;i++){
    const spread=rng()*TAU;
    const side=new T.Vector2(Math.cos(spread),Math.sin(spread));
    const lean=new T.Vector2(-side.y,side.x).multiplyScalar(mix(.032,.108,rng()));
    const rootX=(rng()-.5)*.29,rootZ=(rng()-.5)*.29;
    const height=mix(.093,.24,rng());
    const width=i<6?mix(.0065,.014,rng()):mix(.0052,.011,rng());
    const tip=positions.length/3;
    positions.push(
      rootX-side.x*width,0,rootZ-side.y*width,
      rootX+side.x*width,0,rootZ+side.y*width,
      rootX+lean.x*.32-side.x*width*.62,height*.59,rootZ+lean.y*.32-side.y*width*.62,
      rootX+lean.x*.32+side.x*width*.62,height*.59,rootZ+lean.y*.32+side.y*width*.62,
      rootX+lean.x,height,rootZ+lean.y
    );
    const light=mix(.8,1.21,rng());
    for(const k of [0,0,1,1,2]){
      roots.push(rootX,rootZ);
      const color=colorsByHeight[k];
      colors.push(color.r*light,color.g*light,color.b*light);
    }
    indices.push(tip,tip+1,tip+2,tip+1,tip+3,tip+2,tip+2,tip+3,tip+4);
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  geometry.setAttribute('bladeRoot',new T.Float32BufferAttribute(roots,2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals=geometry.attributes.normal;
  for(let i=0;i<normals.count;i++) {
    const n=new T.Vector3(normals.getX(i)*.67,Math.abs(normals.getY(i))*.47+.46,normals.getZ(i)*.67).normalize();
    normals.setXYZ(i,n.x,n.y,n.z);
  }
  return geometry;
}

export function createGrass(scene,floor,clock,groundImage) {
  const geometry=grassGeometry();
  const material=new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide});
  const reach={value:48}, detailRadius={value:25};
  material.onBeforeCompile=shader=>{
    shader.uniforms.clock=clock;
    shader.uniforms.groundImage=groundImage;
    shader.uniforms.floorMask={value:floor.texture};
    shader.uniforms.reach=reach;
    shader.uniforms.detailRadius=detailRadius;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      uniform float clock,reach,detailRadius;
      varying vec2 tuft;
      varying float grassDistance,grassTier;
      varying float bladeTip;
      attribute vec2 bladeRoot;
      varying vec4 rootClip;
      varying float bladeHeight;
    `).replace('#include <color_vertex>',`#include <color_vertex>
      grassTier=step(1.7,instanceColor.b);
      vColor.b*=mod(instanceColor.b,2.)/max(instanceColor.b,.001);
    `).replace('#include <begin_vertex>',`#include <begin_vertex>
      vec3 root=instanceMatrix[3].xyz;
      vec4 planted=modelViewMatrix*instanceMatrix*vec4(bladeRoot.x,0.,bladeRoot.y,1.);
      rootClip=projectionMatrix*planted;
      bladeHeight=position.y*instanceMatrix[1].y;
      bladeTip=clamp(position.y*5.3,0.,1.);
      tuft=root.xz;
      grassDistance=length(root.xz-cameraPosition.xz);
      float phase=clock*1.56+root.x*.33+root.z*.21;
      float breeze=.50*sin(phase)+.19*sin(phase*2.58+root.z*.19)+.30;
      float bend=position.y*position.y*5.3;
      transformed.x+=breeze*bend;
      transformed.z+=sin(phase*.67)*bend*.36;
      transformed.y*=(1.-smoothstep(reach*.78,reach,grassDistance))*
        (1.-smoothstep(detailRadius*.77,detailRadius-1.,grassDistance)*grassTier);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      ${floorGlsl}
      uniform float reach,detailRadius;
      varying vec2 tuft;
      varying float grassDistance,grassTier;
      varying float bladeTip;
      uniform sampler2D groundImage;
      varying vec4 rootClip;
      varying float bladeHeight;
    `).replace('#include <color_fragment>',`#include <color_fragment>
      float fade=max(smoothstep(reach*.80,reach,grassDistance),
        smoothstep(detailRadius*.79,detailRadius-1.,grassDistance)*grassTier);
      float grain=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
      if(grain<fade)discard;
      vec4 ground=floorAt(tuft);
      diffuseColor.rgb*=mix(vec3(1.06,1.01,.89),vec3(.79,.93,.81),ground.b)*mix(1.,.59,ground.a);
    `).replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
      vec3 grassUp=normalize((viewMatrix*vec4(0.,1.,0.,0.)).xyz);
      normal=normalize(mix(grassUp,normal*faceDirection,.39));
      totalEmissiveRadiance+=diffuseColor.rgb*(.017+bladeTip*.031);
    `).replace('#include <opaque_fragment>',`
      if(bladeHeight<.105 && rootClip.w>0.){
        vec2 uv=rootClip.xy/rootClip.w*.5+.5;
        vec4 underfoot=texture2D(groundImage,clamp(uv,0.,1.));
        float onGround=1.-smoothstep(.24,.85,abs(underfoot.a-rootClip.w));
        float soil=onGround*(1.-smoothstep(.009,.104,bladeHeight));
        outgoingLight=mix(outgoingLight,underfoot.rgb,soil);
      }
      #include <opaque_fragment>
    `);
  };
  const cellSize=8,cells=new Map();
  const dummy=new T.Object3D(), tint=new T.Color();
  let tick=0,lastX=Infinity,lastZ=Infinity,lastReach=0,lastNear=0;
  function createCell(ix,iz) {
    const rng=random(Math.imul(ix+417,27191)^Math.imul(iz+415,74507));
    const base=[],extra=[];
    const side=Math.abs(ix*cellSize)>230||iz*cellSize < -450||iz*cellSize>125?20:32;
    for(let i=0;i<side*side;i++){
      const x=(ix+(i%side+rng())/side)*cellSize;
      const z=(iz+(Math.floor(i/side)+rng())/side)*cellSize;
      const field=floor.at(x,z);
      if(field.trail>.47||rng()>field.grass*.98+.029||rng()<field.shade*.72)continue;
      const tall=mix(.44,1.58,rng()**1.45)*mix(.67,1.15,field.grass);
      const width=mix(.63,1.31,rng());
      const tone=mix(.69,1.16,rng());
      const entry=[x,z,tall,width, tone, rng()*TAU];
      (rng()<.27?base:extra).push(entry);
    }
    const all=[...base,...extra];
    if(!all.length)return {grass:null,used:tick};
    const grass=new T.InstancedMesh(geometry,material,all.length);
    grass.layers.set(1);
    grass.receiveShadow=true;
    all.forEach(([x,z,height,width,tone,angle],i)=>{
      dummy.position.set(x,altitude(x,z)-.013,z);
      dummy.rotation.set(0,angle,0);
      dummy.scale.set(width,height,width);
      dummy.updateMatrix();
      const m=dummy.matrix.elements;
      const gx=(altitude(x+.13,z)-altitude(x-.13,z))/.26,gz=(altitude(x,z+.13)-altitude(x,z-.13))/.26;
      m[1]=gx*m[0]+gz*m[2];m[9]=gx*m[8]+gz*m[10];
      grass.setMatrixAt(i,dummy.matrix);
      // The high bit of blue identifies the tufts that fade out at the near LOD boundary.
      grass.setColorAt(i,tint.setRGB(tone,mix(tone,1.0,.21),tone*.94+(i>=base.length?2:0)));
    });
    grass.computeBoundingSphere();
    scene.add(grass);
    return {grass,base:base.length,full:all.length,used:tick};
  }
  return (position,distance,detail)=>{
    reach.value=distance;
    detailRadius.value=detail;
    if(Math.hypot(lastX-position.x,lastZ-position.z)<2.3&&lastReach===distance&&lastNear===detail)return;
    lastX=position.x;lastZ=position.z;lastReach=distance;lastNear=detail;
    tick++;
    const ring=distance+cellSize*.65;
    for(let ix=Math.floor((position.x-ring)/cellSize);ix<=Math.floor((position.x+ring)/cellSize);ix++){
      for(let iz=Math.floor((position.z-ring)/cellSize);iz<=Math.floor((position.z+ring)/cellSize);iz++){
        const d=Math.hypot((ix+.5)*cellSize-position.x,(iz+.5)*cellSize-position.z);
        if(d>ring)continue;
        const key=ix+','+iz;
        let cell=cells.get(key);
        if(!cell){cell=createCell(ix,iz);cells.set(key,cell);}
        cell.used=tick;
        if(!cell.grass)continue;
        cell.grass.visible=true;
        cell.grass.count=d<detail+cellSize*.55 ? cell.full : cell.base;
      }
    }
    for(const [key,cell] of cells){
      if(cell.used===tick)continue;
      if(cell.grass)cell.grass.visible=false;
      if(tick-cell.used>4){
        if(cell.grass){scene.remove(cell.grass);cell.grass.dispose();}
        cells.delete(key);
      }
    }
  };
}

export function createForestProps(scene,textures,floor) {
  const rng=random(712612);
  const entries=[];
  const sizeX=[1.15,.92,1.61,.26,.47,.54,.31,.40,.73,.19,.24,.31,.58,.42];
  const depthRatio=[.71,.62,.54,.80,.77,.69,.79,.68,.71,.83,.80,1.04,.71,.68];
  const add=(x,z,kind,scale)=>entries.push({x,z,kind,scale});
  [
    [-2.34,-2.8,0,1.42],[2.8,-4.65,1,1.19],[-5,-9,2,1.18],[1.19,-6.4,3,.9],
    [-.98,-4.80,4,1.3],[3.10,-11.85,2,1.08],[.42,-2.45,4,.83],
    [6.7,-35,0,1.23],[3.7,-64,2,1.28],
  ].forEach(entry=>add(...entry));
  [
    [6,-4.4,6,1.07],[7,-9.6,7,1.28],[5.3,-13.6,8,1.13],
    [6.9,-17.4,9,1.12],[-.60,-32,10,1.1],[2.5,-39,11,1.24],
    [-3.6,-40.5,12,1.08],[-2.8,-51,13,1.21],
  ].forEach(entry=>{if(riverBank(entry[0],entry[1])>.16)add(...entry);});
  for(let i=0;i<4650;i++){
    const z=mix(-241,68,rng());
    const x=i<3000?pathX(z)+(rng()-.5)*37:mix(-123,123,rng());
    const biome=floor.at(x,z);
    if(biome.shade>.41||riverBank(x,z)<.3)continue;
    let kind=rng()<.25?Math.floor(rng()*3):3+Math.floor(rng()*3);
    if(kind<3&&biome.trail>.31)continue;
    if(kind===5&&biome.trail>.43)kind=4;
    const scale=mix(.45,1.29,rng()**.79);
    add(x,z,kind,scale);
  }
  for(let i=0;i<1900;i++){
    const z=mix(-216,40,rng());
    const bank=riverX(z)+(rng()<.5?-1:1)*(riverWidth(z)+mix(.38,8.5,rng()));
    const x=i<980?bank:pathX(z)+(rng()-.5)*53;
    const field=floor.at(x,z),shore=riverBank(x,z);
    if(shore<.47||field.trail>.49||field.shade>.72)continue;
    let kind=6+Math.floor(rng()*8);
    if(shore<2.1&&rng()<.64)kind=rng()<.57?11:10;
    if(kind===6&&field.moisture<.46)kind=7;
    if(kind===11&&shore>8.3)kind=13;
    const scale=mix(.56,1.29,rng());
    add(x,z,kind,scale);
  }
  const geometry=new T.PlaneGeometry(1,1,4,2);
  geometry.rotateX(-Math.PI/2);
  geometry.setAttribute('propType',new T.InstancedBufferAttribute(new Float32Array(entries.map(e=>e.kind)),1));
  const mat=new T.MeshPhysicalMaterial({
    map:textures.props,alphaTest:.38,side:T.DoubleSide,roughness:.98,specularIntensity:.09,
    polygonOffset:true,polygonOffsetFactor:-1,
  });
  const reach={value:54};
  mat.onBeforeCompile=shader=>{
    shader.uniforms.floorMask={value:floor.texture};
    shader.uniforms.reach=reach;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute float propType;
      uniform float reach;
      varying vec3 propOrigin;
      varying float propDistance;
    `).replace('#include <uv_vertex>',`#include <uv_vertex>
      vec2 cell=vec2(mod(propType,4.),3.-floor(propType/4.));
      vMapUv=(cell+mix(vec2(.009),vec2(.991),uv))/4.;
    `).replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
      float reliefHeight=propType<3.?.065:propType==6.||propType==11.?.033:.018;
      vec2 propUv=uv*3.14159265;
      vec2 rise=reliefHeight*3.14159265*vec2(cos(propUv.x)*sin(propUv.y),sin(propUv.x)*cos(propUv.y));
      objectNormal=normalize(vec3(-rise.x,1.,rise.y));
    `).replace('#include <begin_vertex>',`#include <begin_vertex>
      propOrigin=instanceMatrix[3].xyz;
      propDistance=length(cameraPosition.xz-propOrigin.xz);
      transformed.y+=sin(propUv.x)*sin(propUv.y)*reliefHeight;
      if(propDistance>reach)transformed*=0.;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform float reach;
      ${floorGlsl}
      ${forestAlbedoGlsl}
      varying vec3 propOrigin;
      varying float propDistance;
    `).replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      float fogOut=1.-smoothstep(reach*.78,reach,propDistance);
      float pattern=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
      if(fogOut<pattern)discard;
      vec4 terrain=floorAt(propOrigin.xz);
      diffuseColor.rgb=matteAlbedo(diffuseColor.rgb)*mix(.87,.46,terrain.a)*
        mix(vec3(1.,.98,.93),vec3(.76,.80,.69),terrain.b*.68);
    `);
  };
  const sprites=new T.InstancedMesh(geometry,mat,entries.length);
  sprites.receiveShadow=true;
  const object=new T.Object3D(), up=new T.Vector3(0,1,0), normal=new T.Vector3();
  const yaw=new T.Quaternion();
  entries.forEach(({x,z,kind,scale},i)=>{
    const h=altitude(x,z);
    const dx=altitude(x+.20,z)-altitude(x-.20,z),dz=altitude(x,z+.20)-altitude(x,z-.20);
    normal.set(-dx,.40,-dz).normalize();
    const width=scale*sizeX[kind],depth=width*depthRatio[kind];
    const upright=kind===6||kind===11;
    object.position.set(x,h+(upright?depth*.35:kind<3?.049:.016)+scale*.011,z);
    object.quaternion.setFromUnitVectors(up,normal).multiply(yaw.setFromAxisAngle(up,rng()*TAU));
    if(kind===2)object.rotateX((rng()-.5)*.14);
    if(upright)object.rotateX(.99+rng()*.27);
    object.scale.set(width,1,depth);
    object.updateMatrix();
    sprites.setMatrixAt(i,object.matrix);
  });
  scene.add(sprites);
  return distance=>{reach.value=distance;};
}
