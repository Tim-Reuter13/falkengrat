import * as T from 'three';
import { clamp, mix, random, TAU } from './math.js';

// x and y are offsets in viewport heights, followed by wrist roll and yaw.
const swings = [
  [
    [0,0,0,0,0],[.15,.037,.025,.20,-.16],[.32,.095,.073,.77,-.57],
    [.48,-.13,-.012,-.44,.37],[.63,-.56,.16,-1.29,.55],
    [.77,-.48,.18,-.97,.30],[1,0,0,0,0],
  ],
  [
    [0,0,0,0,0],[.15,-.13,.063,-.28,.18],[.32,-.45,.17,-1.21,.55],
    [.48,-.20,.025,-.26,-.15],[.64,.086,.074,.82,-.46],
    [.81,.056,.094,.58,-.32],[1,0,0,0,0],
  ],
];

function interpolate(frames,time,result) {
  const right=frames.findIndex((frame,i)=>i>0&&frame[0]>=time);
  const a=frames[right-1], b=frames[right];
  const before=frames[right-2]??a, after=frames[right+1]??b;
  const span=b[0]-a[0], t=clamp((time-a[0])/span,0,1), t2=t*t, t3=t2*t;
  for(let i=1;i<=4;i++){
    const start=right>1 ? (b[i]-before[i])*span/(b[0]-before[0]) : 0;
    const end=right<frames.length-1 ? (after[i]-a[i])*span/(after[0]-a[0]) : 0;
    result[i-1]=(2*t3-3*t2+1)*a[i]+(t3-2*t2+t)*start+(-2*t3+3*t2)*b[i]+(t3-t2)*end;
  }
}

export function createSword(camera,scene,collision,audio,onImpact,equipment,probe,targets=[]) {
  const weapon=new T.Group();
  const hand=equipment.hand,blade=equipment.sword;
  weapon.add(hand,blade);camera.add(weapon);weapon.visible=false;
  const wrist=hand.getObjectByName('Unterarm');
  const aimQuaternion=new T.Quaternion();
  const forearmAxis=new T.Vector3(.57,-.36,.74).normalize(),elbow=new T.Vector3();
  weapon.traverse(mesh=>{
    if(!mesh.isMesh)return;
    mesh.receiveShadow=true;mesh.frustumCulled=false;
    mesh.material.fog=false;
    if(mesh.material.map)mesh.material.map.anisotropy=8;
  });
  blade.traverse(mesh=>{
    if(!mesh.isMesh)return;
    mesh.material.onBeforeCompile=shader=>{
      shader.uniforms.forestReflection=probe.uniform;
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform samplerCube forestReflection;')
        .replace('#include <opaque_fragment>', `
          vec3 toEye=normalize(vViewPosition);
          vec3 ray=inverseTransformDirection(reflect(-toEye,normal),viewMatrix);
          vec3 environment=textureLod(forestReflection,ray,clamp(roughnessFactor*5.2-.34,0.,6.)).rgb;
          environment=mix(vec3(dot(environment,vec3(.2126,.7152,.0722))),environment,.37);
          environment=mix(environment,vec3(.115,.118,.123),.16);
          float facing=clamp(dot(normal,toEye),0.,1.);
          vec3 fresnel=mix(diffuseColor.rgb,vec3(1.),pow(1.-facing,5.));
          outgoingLight+=environment*fresnel*metalnessFactor*(1.-roughnessFactor*.27);
          #include <opaque_fragment>`);
    };
  });
  const rand=random(33717);
  const max=50, array=new Float32Array(max*3);
  array.fill(-10000);
  const geometry=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(array,3));
  const material=new T.PointsMaterial({color:0x9b7852,size:.047,opacity:.76,transparent:true,depthWrite:false});
  material.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`
      vec2 grain=gl_PointCoord*2.-1.;
      float fragmentShape=abs(grain.x+grain.y*.34)*1.4+abs(grain.y)*.87;
      diffuseColor.a*=1.-smoothstep(.65,1.05,fragmentShape);
      #include <alphatest_fragment>`);
  };
  const dust=new T.Points(geometry,material);
  dust.frustumCulled=false;
  scene.add(dust);
  const particles=Array.from({length:max},()=>({age:0,v:new T.Vector3()}));
  const aim=new T.Vector3();
  const pose=[0,0,0,0];
  let timer=1,side=0,alternate=0,queued=false,hit=false,blocking=false,guard=0,nextParticle=0;
  let motion=1;

  function strike() {
    camera.getWorldDirection(aim);
    if(Math.abs(aim.y)>.93)return;
    const origin=camera.position;
    let contact=collision.strike(origin,aim,2.77);
    // Living targets (the cannibal) are hit when nothing solid is closer.
    let body=null;
    for(const target of targets){
      const hit=target.strike(origin,aim,2.77);
      if(hit&&(!contact||hit.distance<contact.distance)&&(!body||hit.distance<body.distance))body=hit;
    }
    if(body)contact={type:'body',distance:body.distance};
    if(!contact)return;
    const travel=contact.distance;
    const x=origin.x+aim.x*travel,z=origin.z+aim.z*travel,y=origin.y+aim.y*travel;

    for(let i=0;i<12;i++){
      const index=nextParticle++%max, particle=particles[index], angle=rand()*TAU;
      array[index*3]=x;array[index*3+1]=y;array[index*3+2]=z;
      particle.age=mix(.16,.42,rand());
      particle.v.set(Math.cos(angle)*mix(.3,2.3,rand())-aim.x*.5,mix(.05,1.9,rand()),Math.sin(angle)*mix(.3,2.3,rand())-aim.z*.5);
    }
    audio.hit();
    body?.hit();
    onImpact(contact.type);
  }

  return {
    rig:weapon,
    get swinging(){return timer>.16&&timer<.74;},
    get visible(){return weapon.visible;},
    show(value){weapon.visible=value;},
    motion(value){motion=value;},
    attack(){
      if(blocking)return;
      if(timer<.84){queued=true;return;}
      side=alternate++%2;timer=0;hit=false;queued=false;audio.swing();
    },
    block(value){blocking=value;},
    update(dt,time,{bob,stride,lookX,lookY,sprint,pitch,landing}){
      const previously=timer;
      timer=Math.min(1,timer+dt/(side?.57:.64));
      if(previously<.49&&timer>=.49&&!hit){hit=true;strike();}
      if(timer>.91&&queued)this.attack();
      interpolate(swings[side],timer,pose);
      guard=mix(guard,blocking?1:0,1-Math.exp(-dt*13));
      const x=100*(pose[0]-.28*guard+lookX*.055+Math.sin(bob)*.007*stride*motion);
      const y=100*(pose[1]+.061*guard-lookY*.036+Math.cos(bob*2)*.0045*stride*motion+
        Math.sin(time*1.44)*.0025*motion+.041*Number(sprint)+pitch*.014+landing*.9);
      const roll=.26+pose[2]-1.20*guard+lookX*.29+Math.sin(bob)*.018*stride*motion;
      const yaw=pose[3]-.38*guard-lookX*.81;
      const depth=.54,frame=2*depth*Math.tan(T.MathUtils.degToRad(camera.fov*.5));
      const reach=Math.min(camera.aspect*.215,.60);
      weapon.position.set(frame*(reach+x*.0075),frame*(-.307-y*.005),-depth-.028*Math.sin(timer*Math.PI));
      weapon.rotation.set(-.76+guard*.22+pose[2]*.16,.30+yaw,-roll*.92,'ZXY');
      weapon.updateMatrix();
      elbow.set(frame*Math.min(camera.aspect*.49,.86),-frame*.67,-.035);
      elbow.sub(weapon.position).applyQuaternion(aimQuaternion.copy(weapon.quaternion).invert()).sub(wrist.position).normalize();
      wrist.quaternion.setFromUnitVectors(forearmAxis,elbow);
      let changed=false;
      for(let i=0;i<max;i++){
        const p=particles[i];
        if(p.age<=0)continue;
        changed=true;p.age-=dt;p.v.y-=dt*4.6;
        const offset=i*3;
        array[offset]+=p.v.x*dt;array[offset+1]+=p.v.y*dt;array[offset+2]+=p.v.z*dt;
        if(p.age<=0)array[offset+1]=-10000;
      }
      if(changed)geometry.attributes.position.needsUpdate=true;
    },
  };
}
