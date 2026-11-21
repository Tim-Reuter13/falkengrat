import * as T from 'three';
import { altitude, channelSlope, mix, noise, pathX, random, riverBank, riverSpeed, riverWidth, riverX, TAU, waterLevel } from './math.js';
import { rootings, rootingMask } from './animal-traces.js';
import { floorGlsl, forestAlbedoGlsl } from './groundcover.js';

const species=[
  [.38,.18],[.59,.41],[.35,.43],[.37,.19],[.24,.39],[.29,.31],[.29,.17],[.13,.098],
  [.39,.69],[.36,.55],[.34,.30],[.33,.27],[.39,.42],[.44,.27],[.38,.35],[.69,.42],
];

export function createHabitatPlants(scene,textures,floor,time,plantLight,probePass){
  const rng=random(15831);
  const standing=[],flat=[],counts=new Uint16Array(species.length);
  function plant(x,z,kind,scale){
    const bank=riverBank(x,z),y=altitude(x,z),water=waterLevel(z),depth=water-y;
    const size=species[kind],aquatic=kind>=13;
    if(aquatic?(depth<.11||depth>.78||bank>-.12):(depth>.065||floor.at(x,z).trail>.48))return;
    const width=size[0]*scale,height=aquatic?Math.min(size[1]*scale,depth-.037):size[1]*scale;
    const facing=rng(),rotation=aquatic?Math.atan(channelSlope(z))+(facing-.5)*.90:facing*TAU,seed=rng();
    const target=kind===7||kind===15?flat:standing;
    counts[kind]++;
    target.push({x,y,z,kind,width,height,rotation,seed});
    if(target===standing&&(width>.26||kind>=8)){
      target.push({x,y:y-.009,z,kind,width:width*.81,height:height*.93,rotation:rotation+1.57,seed});
    }
  }
  for(let i=0;i<420;i++){
    const z=mix(-231,27,rng()),x=pathX(z)+(rng()<.5?-1:1)*mix(1.05,17,rng()**1.65);
    const field=floor.at(x,z);
    if(field.trail>.33||rootingMask(x,z,0)>.49)continue;
    const kind=Math.floor(rng()*8);
    if(kind===1&&field.grass<.30||kind===5&&field.shade>.44)continue;
    const group=kind<=3?4:kind<=5?3:2;
    for(let n=0;n<group;n++){
      plant(x+(rng()-.5)*1.28,z+(rng()-.5)*1.18,kind,mix(.68,1.42,rng()));
    }
  }
  for(let z=-244;z<33;z+=2.54){
    for(const side of [-1,1]){
      const start=z+(rng()-.5)*3.2;
      const wetBank=riverX(start)+side*(riverWidth(start)+mix(.48,1.94,rng()));
      const kind=8+Math.floor(rng()*5);
      if(rng()<.72)for(let i=0;i<4;i++){
        plant(wetBank+(rng()-.5)*.81,start+(rng()-.5)*1.7,kind,mix(.74,1.48,rng()));
      }
      const underwater=riverX(start)+side*(riverWidth(start)-mix(.35,2.18,rng()));
      const growth=noise(underwater*.27+48,start*.23);
      if(growth>.30&&riverSpeed(start)<1.54){
        const waterKind=growth>.58?15:rng()<.53?13:14;
        for(let i=0;i<5;i++){
          plant(underwater+(rng()-.5)*1.42,start+(rng()-.5)*1.81,waterKind,mix(.73,1.51,rng()));
        }
      }
    }
  }
  // Distinct small stands along the first bends allow the bank species to read up close.
  for(const [z,side,kind] of [[-5,-1,8],[-9,-1,9],[-15,-1,10],[-18,1,11],[-29,-1,12],[-42,-1,8],[-66,1,10]]){
    for(let i=0;i<6;i++){
      const pz=z+(rng()-.5)*2.1,bank=riverX(pz)+side*(riverWidth(pz)+.67+rng()*.82);
      plant(bank,pz,kind,mix(.91,1.51,rng()));
    }
  }

  const mat=new T.MeshLambertMaterial({map:textures.habitat,side:T.DoubleSide});
  const reach={value:62};
  mat.onBeforeCompile=shader=>{
    shader.uniforms.reach=reach;
    shader.uniforms.clock=time;
    shader.uniforms.floorMask={value:floor.texture};
    shader.uniforms.plantLight=plantLight;
    shader.uniforms.probePass=probePass;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute vec3 plantData;
      uniform float reach,clock;
      varying vec3 info;
      varying vec2 groundPoint;
      varying vec3 plantNormal;
      varying vec4 plantFoot;
    `).replace('#include <uv_vertex>',`#include <uv_vertex>
      vec2 tile=vec2(mod(plantData.x,4.),3.-floor(plantData.x*.25));
      vMapUv=(tile+mix(vec2(.019),vec2(.981),uv))*.25;
    `).replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
      float low=plantData.z;
      objectNormal=normalize(vec3(.16,.88,.36));
      vec3 frond=normalize(vec3(0.,1.,0.)+
        normalize(instanceMatrix[2].xyz)*mix(.57,.15,low)*mix(1.,.52,uv.y));
      plantNormal=normalize((viewMatrix*vec4(frond,0.)).xyz);
    `).replace('#include <begin_vertex>',`#include <begin_vertex>
      vec3 planted=instanceMatrix[3].xyz;
      plantFoot=projectionMatrix*viewMatrix*vec4(planted,1.);
      groundPoint=planted.xz;
      float distanceToPlant=length(cameraPosition.xz-planted.xz);
      float coupled=1.-low;
      float sway=sin(clock*(plantData.x>=13.?2.81:1.75)+planted.x*.71+planted.z*.32+
        plantData.y*12.)*.12;
      transformed.x+=sway*uv.y*uv.y*coupled;
      transformed.z+=(sway*.43+step(13.,plantData.x)*.18)*uv.y*uv.y*coupled;
      info=vec3(distanceToPlant,plantData.y,plantData.x);
    `).replace('#include <project_vertex>',`#include <project_vertex>
      if(distanceToPlant>reach)gl_Position=vec4(2.,2.,2.,1.);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform float reach;
      varying vec3 info;
      varying vec2 groundPoint;
      varying vec3 plantNormal;
      varying vec4 plantFoot;
      uniform sampler2D plantLight;
      uniform float probePass;
      ${floorGlsl}
      ${forestAlbedoGlsl}
    `).replace('#include <map_fragment>',`#include <map_fragment>
      float surfaceValue=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
      vec2 textureRelief=clamp(vec2(dFdx(surfaceValue),dFdy(surfaceValue)),-.34,.34);
    `).replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      float grain=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
      if(diffuseColor.a<mix(.32,.54,grain)||grain<smoothstep(reach*.71,reach,info.x))discard;
      vec4 ground=floorAt(groundPoint);
      vec3 tint=mix(vec3(.91,.97,.86),vec3(.69,.78,.62),step(12.5,info.z));
      diffuseColor.rgb=matteAlbedo(diffuseColor.rgb)*tint*mix(.75,.91,info.y)*mix(.92,.44,ground.a);
    `).replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
      normal=normalize(plantNormal+vec3(-textureRelief*.57,0.));
    `).replace('#include <opaque_fragment>',`
      float direct=dot(reflectedLight.directDiffuse,vec3(.2126,.7152,.0722))/max(.018,surfaceValue);
      outgoingLight*=mix(.69,1.02,smoothstep(.024,.27,direct));
      if(probePass<.5&&plantFoot.w>.08&&info.x<42.){
        vec2 uv=plantFoot.xy/plantFoot.w*.5+.5;
        if(all(greaterThan(uv,vec2(.001)))&&all(lessThan(uv,vec2(.999)))){
          vec4 under=texture2D(plantLight,uv);
          float confirm=1.-smoothstep(.17,.95,abs(under.a-plantFoot.w));
          float light=dot(under.rgb,vec3(.2126,.7152,.0722));
          float local=mix(.43,1.12,smoothstep(.013,.161,light));
          outgoingLight*=mix(1.,local,confirm*(.89-.29*fract(vMapUv.y*4.)));
        }
      }
      #include <opaque_fragment>`);
  };
  const o=new T.Object3D(),up=new T.Vector3(0,1,0),yaw=new T.Quaternion(),slope=new T.Vector3();
  for(const [entries,isFlat] of [[standing,false],[flat,true]]){
    const geo=new T.PlaneGeometry(1,1,3,3);
    if(isFlat)geo.rotateX(-Math.PI*.5);else geo.translate(0,.5,0);
    geo.setAttribute('plantData',new T.InstancedBufferAttribute(new Float32Array(entries.flatMap(e=>[e.kind,e.seed,Number(isFlat)])),3));
    const batch=new T.InstancedMesh(geo,mat,entries.length);
    batch.receiveShadow=true;
    batch.layers.set(2);
    entries.forEach((e,i)=>{
      o.position.set(e.x,e.y+(isFlat?.021:-.019),e.z);
      if(isFlat){
        slope.set(altitude(e.x-.13,e.z)-altitude(e.x+.13,e.z),.26,altitude(e.x,e.z-.13)-altitude(e.x,e.z+.13)).normalize();
        o.quaternion.setFromUnitVectors(up,slope).multiply(yaw.setFromAxisAngle(up,e.rotation));
        o.scale.set(e.width,1,e.height);
      }else{
        o.rotation.set(.035,e.rotation,.065*(e.seed-.5),'YXZ');
        o.scale.set(e.width,e.height,1);
      }
      o.updateMatrix();batch.setMatrixAt(i,o.matrix);
    });
    scene.add(batch);
  }
  return {update(distance){reach.value=distance;},counts:Array.from(counts)};
}

function hoofTexture(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=192;
  const c=canvas.getContext('2d');
  for(const side of [-1,1]){
    c.save();c.translate(96+side*7,98);c.scale(side,1);c.rotate(-.07);
    c.beginPath();c.moveTo(6,56);c.bezierCurveTo(35,51,60,10,31,-43);c.quadraticCurveTo(14,-46,6,-14);
    c.quadraticCurveTo(-3,19,6,56);
    c.lineWidth=7;c.strokeStyle='#6b4d37';c.stroke();
    const fill=c.createLinearGradient(0,-45,60,35);
    fill.addColorStop(0,'#2b1d16');fill.addColorStop(.54,'#221811');fill.addColorStop(1,'#54392b');
    c.fillStyle=fill;c.fill();
    c.beginPath();c.ellipse(31,67,6,9,-.26,0,TAU);c.fillStyle='#452e22';c.fill();
    c.restore();
  }
  const texture=new T.CanvasTexture(canvas);
  texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
  return texture;
}

export function createAnimalTraces(scene,textures){
  const rng=random(23301),p=[],uv=[],faces=[],chunks=[];
  for(const site of rootings){
    if(riverBank(site.x,site.z)<.34)continue;
    for(let i=0;i<17;i++){
      const a=rng()*TAU,r=mix(.47,1.02,rng());
      const x=site.x+Math.cos(a)*site.rx*r,z=site.z+Math.sin(a)*site.rz*r;
      if(riverBank(x,z)<.28)continue;
      const scale=mix(.032,.15,rng()**1.5);
      chunks.push([x,z,scale,rng()*TAU]);
    }
    for(let j=0;j<12;j++){
      const t=(j-5.5)*.33,side=(j%2?1:-1)*.14;
      const x=site.x+t*site.cos+side*site.sin,z=site.z-t*site.sin+side*site.cos;
      if(riverBank(x,z)<.28)continue;
      const size=mix(.105,.175,rng()),first=p.length/3;
      for(let k=0;k<4;k++){
        const u=(k%2-.5)*size,v=(Math.floor(k/2)-.5)*size*1.14;
        const px=x+u*site.sin+v*site.cos,pz=z+u*site.cos-v*site.sin;
        p.push(px,altitude(px,pz)+.013,pz);uv.push(k%2,Math.floor(k/2));
      }
      faces.push(first,first+1,first+2,first+1,first+3,first+2);
    }
  }
  const marks=new T.BufferGeometry();
  marks.setAttribute('position',new T.Float32BufferAttribute(p,3));marks.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  marks.setIndex(faces);marks.computeVertexNormals();
  const imprint=new T.Mesh(marks,new T.MeshLambertMaterial({map:hoofTexture(),side:T.DoubleSide,alphaTest:.32,
    polygonOffset:true,polygonOffsetFactor:-1}));
  imprint.receiveShadow=true;scene.add(imprint);
  const clods=new T.InstancedMesh(new T.IcosahedronGeometry(1,2),
    new T.MeshPhysicalMaterial({color:0xbe9d82,map:textures.earth,normalMap:textures.groundNormal,roughness:.99,specularIntensity:.1}),chunks.length);
  const o=new T.Object3D();
  chunks.forEach(([x,z,scale,rotation],i)=>{
    o.position.set(x,altitude(x,z)-scale*.08,z);o.rotation.set(.34,rotation,.16);
    o.scale.set(scale*1.3,scale*.46,scale*.88);o.updateMatrix();clods.setMatrixAt(i,o.matrix);
  });
  clods.receiveShadow=true;scene.add(clods);
  return {rootings:rootings.length,hoofprints:faces.length/6};
}
