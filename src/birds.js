import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { altitude, clamp, mix, random, riverX, smooth, TAU } from './math.js';

function oval(x,y,z,sx,sy,sz,color,rx=0) {
  const mesh=new T.SphereGeometry(1,16,10);
  mesh.scale(sx,sy,sz).rotateX(rx).translate(x,y,z);
  const rgb=new T.Color(color);
  const colors=new Float32Array(mesh.attributes.position.count*3);
  for(let i=0;i<colors.length;i+=3)rgb.toArray(colors,i);
  mesh.setAttribute('color',new T.BufferAttribute(colors,3));
  return mesh;
}

function feather(a,b,width,bend,color) {
  const positions=[],uv=[],indices=[],colors=[];
  const rgb=new T.Color(color), start=new T.Vector3(...a), end=new T.Vector3(...b);
  const side=new T.Vector3(-(b[2]-a[2]),0,b[0]-a[0]).normalize();
  for(let i=0;i<=6;i++){
    const t=i/6,r=width*(.11+.89*Math.pow(Math.sin(Math.PI*t),.49));
    for(let j=0;j<3;j++){
      const u=j/2,v=start.clone().lerp(end,t).addScaledVector(side,(2*u-1)*r);
      v.y+=bend*t*t+(j===1?.018:0)*Math.sin(t*Math.PI);
      positions.push(v.x,v.y,v.z);uv.push(u*.74+.1,t*.84+.08);rgb.toArray(colors,colors.length);
    }
    if(i>0)for(let j=0;j<2;j++){
      const p=(i-1)*3+j;
      indices.push(p,p+3,p+1,p+1,p+3,p+4);
    }
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  g.setIndex(indices);g.computeVertexNormals();
  return g;
}

function wing(side,tip) {
  const shapes=[];
  if(tip){
    for(let i=0;i<8;i++){
      const t=i/7;
      shapes.push(feather([side*(-.035+.13*t),0,.005-i*.008],
        [side*(.107+.181*t),-.011,.255-.19*t],.023,-.018,i%2===0?'#ada9a4':'#c3c0b9'));
    }
  }else{
    shapes.push(oval(side*.129,-.006,.030,.191,.031,.083,'#c7c3ba'));
    for(let i=0;i<9;i++){
      const t=i/8;
      shapes.push(feather([side*(.026+.252*t),.001,-.017],
        [side*(.062+.246*t),.001,.189+.033*t],.027,-.023,'#b1ada7'));
    }
  }
  return mergeGeometries(shapes);
}

export function birdParts() {
  const body=mergeGeometries([
    oval(0,0,.028,.088,.097,.192,'#b4b1a9',.24),
    oval(0,.040,-.108,.060,.077,.102,'#b5b1aa',-.25),
  ]);
  const head=mergeGeometries([
    oval(0,.020,-.022,.052,.054,.070,'#c3c1bc'),
    oval(0,.011,-.095,.019,.022,.052,'#575451'),
    oval(0,.003,-.132,.014,.014,.022,'#504c47',-.30),
    oval(-.043,.032,-.057,.0115,.011,.010,'#24221e'),
    oval(.043,.032,-.057,.0115,.011,.010,'#24221e'),
  ]);
  const tail=mergeGeometries(Array.from({length:9},(_,i)=>{
    const t=(i-4)/4;
    return feather([t*.036,0,0],[t*.087,-.01,.248-.075*Math.abs(t)],.023,-.022,'#a8a39c');
  }));
  const feet=mergeGeometries([-.048,.048].flatMap(x=>[
    oval(x,-.098,.004,.009,.045,.009,'#6a6053',.21),
    ...[-1,0,1].map(side=>oval(x+side*.013,-.138,-.023,.006,.007,.024,'#61574c')),
  ]));
  return [body,head,tail,feet,wing(-1,false),wing(1,false),wing(-1,true),wing(1,true)];
}

// Joint hierarchy of a bird: body, head, tail, feet, two shoulders with a wrist each.
// birdParts()[i] hangs on rig.parts[i] (body, head, tail, feet, inner wings, wing tips).
export function createBirdRig() {
  const bird=new T.Object3D(),head=new T.Object3D(),tail=new T.Object3D(),feet=new T.Object3D();
  const shoulders=[new T.Object3D(),new T.Object3D()],wrists=[new T.Object3D(),new T.Object3D()];
  bird.add(head,tail,feet,...shoulders);
  bird.rotation.order='YXZ';
  head.position.set(0,.075,-.145);tail.position.set(0,-.013,.145);
  for(let i=0;i<2;i++){
    const sign=i===0?-1:1;
    shoulders[i].position.set(sign*.052,.024,-.056);
    shoulders[i].rotation.order='YZX';wrists[i].rotation.order='YZX';
    wrists[i].position.set(sign*.268,0,.047);shoulders[i].add(wrists[i]);
  }
  return {bird,head,tail,feet,shoulders,wrists,parts:[bird,head,tail,feet,...shoulders,...wrists]};
}

// Pose of head, tail, legs and wings. spread 0 = folded on a perch, 1 = wings out;
// wingbeat -1..1 is the stroke, glide 0..1 holds the wings still, legs 0..1 tucks the feet.
export function poseBird(rig,{time,phase,spread,wingbeat,glide,legs}) {
  const {head,tail,feet,shoulders,wrists}=rig;
  head.rotation.set(.16*Math.sin(time*1.25+phase)*(1-spread),.63*Math.sin(time*.88+phase)*(1-spread),0);
  tail.rotation.x=mix(-.27,.10+wingbeat*.12,spread);
  tail.scale.x=mix(.69,1.14,spread);
  feet.scale.setScalar(Math.max(.001,legs));
  feet.rotation.x=(1-legs)*1.32;
  for(let i=0;i<2;i++){
    const sign=i===0?-1:1;
    const downstroke=wingbeat>=0?wingbeat*.82:wingbeat*.71;
    shoulders[i].rotation.z=sign*mix(-.58,.08+downstroke*(1-glide*.93),spread);
    shoulders[i].rotation.y=sign*mix(-1.27,-.11-wingbeat*.16*(1-glide),spread);
    wrists[i].rotation.z=sign*mix(-.40,-.11-Math.sin(time*4+wingbeat)*.26*(1-glide),spread);
    wrists[i].rotation.y=sign*mix(-.68,-.10+(1-glide)*Math.max(0,wingbeat)*.29,spread);
  }
}

export function createBirds(scene,textures,perches,collision,audio) {
  const rng=random(83922);
  const target=new T.Vector3(), ahead=new T.Vector3(), right=new T.Vector3();
  const roster=[];
  const stations=[-5,-14,-30,-44,-61,-78,-94,-113,-125,-141,-161,-187];
  const reserved=new Set();
  for(const z of stations){
    const bank=riverX(z);
    let best=null, nearest=Infinity;
    for(const place of perches){
      if(reserved.has(place))continue;
      const score=Math.abs(place.z-z)*1.8+Math.abs(place.x-bank)*.73;
      if(score<nearest){nearest=score;best=place;}
    }
    if(best){
      reserved.add(best);
      roster.push({home:best.clone(),position:best.clone(),velocity:new T.Vector3(),
        state:'perched',age:0,facing:rng()*TAU,phase:rng()*TAU,size:mix(.83,1.16,rng()),climb:0,path:0,turn:0});
    }
  }
  for(let group=0;group<3;group++)for(let i=0;i<6;i++){
    roster.push({state:'sky',group,offset:i*.112,phase:rng()*TAU,side:(rng()-.5)*8,height:(rng()-.5)*6,
      size:mix(.86,1.13,rng()),position:new T.Vector3(),velocity:new T.Vector3()});
  }
  const material=new T.MeshPhysicalMaterial({map:textures.feathers,vertexColors:true,side:T.DoubleSide,
    roughness:.85,specularIntensity:.27});
  const batches=birdParts().map(geometry=>{
    const inst=new T.InstancedMesh(geometry,material,roster.length);
    inst.count=0;inst.frustumCulled=false;inst.receiveShadow=true;
    inst.instanceMatrix.setUsage(T.DynamicDrawUsage);scene.add(inst);
    return inst;
  });
  const rig=createBirdRig(),{bird,parts}=rig;
  let flushed=0;
  function flightPath(b,t,out) {
    const a=t*(.088+b.group*.009)+b.group*2.19+b.offset;
    out.set(Math.cos(a)*(45+b.group*17)+b.side+5,
      43+b.group*14+b.height+6.6*Math.sin(a*1.35+b.group),
      -87-b.group*52+Math.sin(a)*(44+b.group*18));
  }

  function update(dt,time,camera,active,speed,swinging) {
    let visible=0,airborne=0;
    const cameraPos=camera.position;
    for(const b of roster){
      const p=b.position,v=b.velocity;
      let bank=0,wingbeat=0,glide=0,spread=0,legs=1;
      if(b.state==='sky'){
        flightPath(b,time,p);flightPath(b,time+.045,ahead);
        v.copy(ahead).sub(p);
        bank=.25+.18*Math.sin(time*.36+b.phase);
        glide=smooth(-.32,.68,Math.sin(time*.91+b.phase));
        spread=1;legs=0;wingbeat=Math.sin(time*TAU*(3.25+b.group*.14)+b.phase);
      }else if(b.state==='perched'){
        p.copy(b.home);p.y+=.138*b.size;
        const dist=p.distanceTo(cameraPos);
        const alarmDist=(swinging?10.3:mix(4.4,8.2,smooth(.9,5.6,speed)));
        if(active&&dist<alarmDist){
          b.state='departing';b.age=-mix(.075,.32,rng());v.set(0,0,0);
          target.set(p.x-cameraPos.x,0,(p.z-cameraPos.z)*.85-.92).normalize();
          b.facing=Math.atan2(-target.x,-target.z);
          b.turn=(rng()-.5)*.8;b.climb=mix(2.6,4.1,rng());flushed++;
          audio.wingbeat(dist,clamp(target.dot(right),-.8,.8));
        }
      }else{
        b.age+=dt;
        if(b.age>0){
          spread=smooth(0,.24,b.age);
          legs=1-smooth(.10,.51,b.age);
          wingbeat=Math.sin(b.age*TAU*mix(6,4.15,smooth(.65,3.8,b.age))+1.35);
          glide=smooth(1.7,4.1,b.age)*smooth(.02,.78,Math.sin(b.age*1.5+b.phase));
          if(b.age<8.4){
            b.facing+=b.turn*dt*smooth(.28,.92,b.age)*(1-smooth(5.5,8,b.age));
            const dx=-Math.sin(b.facing),dz=-Math.cos(b.facing);
            const terrain=altitude(p.x+dx*4,p.z+dz*4);
            let obstacle=terrain+.65;
            collision.around(p.x+dx*5,p.z+dz*5,5,item=>{
              if(item.type!=='tree'||Math.hypot(p.x+dx*4-item.x,p.z+dz*4-item.z)>3.2)return;
              obstacle=Math.max(obstacle,altitude(item.x,item.z)+item.height*.50);
            });
            const rise=mix(b.climb,1.1,smooth(1.6,6.2,b.age))+clamp((obstacle-p.y)*1.22,0,5);
            const speed=mix(2,9.3,smooth(.03,1.65,b.age));
            v.lerp(target.set(dx*speed,rise,dz*speed),1-Math.exp(-dt*5.7));
            bank=b.turn*.56;
          }else{
            target.copy(b.home).sub(p);
            const horizontal=Math.hypot(target.x,target.z);
            const approach=mix(1.25,8.1,smooth(1,16,horizontal));
            const landingHeight=b.home.y+.138*b.size;
            v.lerp(target.set(target.x,0,target.z).normalize().multiplyScalar(approach)
              .setY(clamp((landingHeight+Math.min(horizontal*.25,8)-p.y)*1.47,-5,2)),1-Math.exp(-dt*3.4));
            legs=1-smooth(.25,3.6,horizontal);
            if(horizontal<.54&&Math.abs(p.y-landingHeight)<.44){b.state='perched';b.age=0;}
          }
          p.addScaledVector(v,dt);
        }
      }
      if(spread>.5)airborne++;
      if(p.distanceToSquared(cameraPos)>350**2)continue;
      bird.position.copy(p);
      bird.scale.setScalar(b.size);
      const inFlight=spread>.04&&v.lengthSq()>.0001;
      bird.rotation.set(inFlight?clamp(Math.atan2(v.y,Math.hypot(v.x,v.z))*.62,-.52,.62):.13,
        inFlight?Math.atan2(-v.x,-v.z):b.facing,bank);
      poseBird(rig,{time,phase:b.phase,spread,wingbeat,glide,legs});
      bird.updateMatrixWorld(true);
      for(let i=0;i<parts.length;i++)batches[i].setMatrixAt(visible,parts[i].matrixWorld);
      visible++;
    }
    for(const batch of batches){batch.count=visible;batch.instanceMatrix.needsUpdate=true;}
    stats={perched:roster.filter(b=>b.state==='perched').length,airborne,flushed};
    right.setFromMatrixColumn(camera.matrixWorld,0);
  }
  let stats;
  return {update,state:()=>stats,homes:()=>roster.filter(b=>b.home).map(b=>b.home.toArray())};
}
