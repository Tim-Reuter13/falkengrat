import * as T from 'three';
import { altitude, channelSlope, mix, random, riverSpeed, riverWidth, riverX, TAU, waterLevel } from './math.js';

export function createStreamLife(scene,time){
  const rng=random(88519);
  const leafShape=new T.Shape();
  leafShape.moveTo(0,-.52);
  leafShape.quadraticCurveTo(-.38,-.29,-.46,.01);
  leafShape.quadraticCurveTo(-.31,.29,0,.58);
  leafShape.quadraticCurveTo(.33,.31,.43,.01);
  leafShape.quadraticCurveTo(.36,-.28,0,-.52);
  const leafGeometry=new T.ShapeGeometry(leafShape,7);
  const uv=leafGeometry.attributes.uv;
  for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)+.5,uv.getY(i)+.5);
  leafGeometry.rotateX(-Math.PI*.5);
  const leafMaterial=new T.MeshPhysicalMaterial({side:T.DoubleSide,roughness:.72,specularIntensity:.27});
  leafMaterial.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 leafUv;')
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        leafUv=uv;
        transformed.y+=.038*cos(position.x*5.6)*sin(position.z*4.2);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 leafUv;')
      .replace('#include <color_fragment>',`#include <color_fragment>
        float side=abs(leafUv.x-.5);
        float vein=min(side,abs(fract((leafUv.y+side*.73)*8.)-.5)*.167+.015);
        float variegation=fract(sin(dot(floor(leafUv*115.),vec2(12.89,78.44)))*4873.21);
        diffuseColor.rgb*=mix(.67,1.34,smoothstep(.00,.051,vein))*(.84+.19*variegation);`);
  };
  const leaves=Array.from({length:66},(_,i)=>({z:mix(-197,22,rng()),offset:(rng()-.5)*1.58,
    yaw:rng()*TAU,phase:rng()*TAU,size:mix(.053,.151,rng()),drift:mix(.39,.89,rng())}));
  const batch=new T.InstancedMesh(leafGeometry,leafMaterial,leaves.length);
  batch.receiveShadow=true;batch.frustumCulled=false;
  const color=new T.Color();
  leaves.forEach((leaf,i)=>{
    color.setHSL(mix(.055,.122,rng()),mix(.33,.56,rng()),mix(.14,.34,rng()));
    batch.setColorAt(i,color);
  });
  batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
  scene.add(batch);

  const positions=[],phase=[];
  for(let z=-173;z<15;z+=7.7){
    for(let i=0;i<12;i++){
      const pz=z+(rng()-.5)*2.1,side=rng()<.5?-1:1;
      const x=riverX(pz)+side*(riverWidth(pz)+mix(.32,1.70,rng()));
      positions.push(x,Math.max(altitude(x,pz),waterLevel(pz))+mix(.24,1.08,rng()),pz);
      phase.push(rng()*TAU,rng()*TAU,mix(.58,1.64,rng()));
    }
  }
  const geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geo.setAttribute('flight',new T.Float32BufferAttribute(phase,3));
  const insectMaterial=new T.PointsMaterial({color:0xaa9e79,size:.012,transparent:true,opacity:.59,depthWrite:false});
  insectMaterial.onBeforeCompile=shader=>{
    shader.uniforms.clock=time;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      uniform float clock;
      attribute vec3 flight;
      varying float glint;
    `).replace('#include <begin_vertex>',`#include <begin_vertex>
      float t=clock*flight.z;
      transformed+=vec3(.39*sin(t*3.1+flight.x)+.105*cos(t*9.7+flight.y),
        .18*sin(t*4.82+flight.y),.37*cos(t*2.7+flight.x)+.106*sin(t*8.+flight.y));
      glint=.58+.42*pow(abs(sin(t*8.6+flight.y)),8.);
    `).replace('gl_PointSize = size;',`gl_PointSize=size;
      if(distance(transformed,cameraPosition)>17.)gl_Position=vec4(2.,2.,2.,1.);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float glint;')
      .replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
        float r=length(gl_PointCoord-.5)*2.;
        if(r>.99)discard;
        diffuseColor.a*=glint*(1.-smoothstep(.15,.98,r));`);
  };
  const insects=new T.Points(geo,insectMaterial);
  scene.add(insects);

  const o=new T.Object3D();
  return {
    update(dt,camera){
      leaves.forEach((leaf,i)=>{
        leaf.z+=dt*riverSpeed(leaf.z)*leaf.drift;
        if(leaf.z>28)leaf.z-=229;
        const x=riverX(leaf.z)+leaf.offset+Math.sin(leaf.z*.38+leaf.phase)*.39;
        const visible=Math.hypot(camera.x-x,camera.z-leaf.z)<55;
        const current=channelSlope(leaf.z);
        o.position.set(x,waterLevel(leaf.z)+.012+Math.sin(time.value*7+leaf.phase)*.003,leaf.z);
        o.rotation.set(.091*Math.sin(time.value*2+leaf.phase),leaf.yaw+current*.26+time.value*.27,
          .051*Math.cos(time.value*2.5+leaf.phase),'YXZ');
        o.scale.setScalar(visible?leaf.size:.0001);
        o.updateMatrix();batch.setMatrixAt(i,o.matrix);
      });
      batch.instanceMatrix.needsUpdate=true;
    },
    leaves:leaves.length,midgeGroups:positions.length/36,
  };
}
