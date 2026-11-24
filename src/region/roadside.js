import * as T from 'three';
import { anchor } from './geography.js';
import { random } from '../noise.js';
import { hikingTrail, mainRoad, parcels, terrainHeight } from './layout.js';

// The village grew along the road. Garden boundaries turn in at each driveway.
export function plantRoadside(group,textures,collision){
  const rng=random(42972), timber=[],iron=[],shrubs=[],wires=[];
  const treeGreen=new T.Color(),matrix=new T.Object3D();
  const hull=new T.BoxGeometry(1,1,1);
  function fenceHull(x,z,w,low){
    matrix.position.set(anchor.x-x,low-anchor.y+.48,anchor.z-z);matrix.scale.set(w,.96,.14);matrix.updateMatrix();
    collision.addMesh(matrix.position.x,matrix.position.z,hull,matrix.matrix,'fence');
  }
  const box=(list,x,y,z,sx,sy,sz,color)=>list.push([x,y,z,sx,sy,sz,color]);
  for(const {x,z,kind} of parcels()){
    const alongRoad=Math.abs(z)<40;
    if(!alongRoad)continue;
    const side=Math.sign(z), gardenZ=side*(8.6+rng()*2.2), wood=rng()>.28;
    const tint=rng()>.5?0x67584a:0x817362, gardenWidth=9+rng()*7;
    for(const sign of [-1,1]){
      const a=x+sign*2.6,b=x+sign*gardenWidth,n=Math.ceil(Math.abs(b-a)/2.45);
      if(wood)fenceHull((a+b)/2,gardenZ,Math.abs(b-a),terrainHeight((a+b)/2,gardenZ));
      for(let i=0;i<=n;i++){
        const px=a+(b-a)*i/n,pz=gardenZ+Math.sin(i*.7)*.09,y=terrainHeight(px,pz);
        if(wood){
          box(timber,px,y+.46,pz,.12,.97,.12,tint);
          if(i<n)for(const height of [.29,.69])box(timber,px+(b-a)/n/2,y+height,pz,Math.abs(b-a)/n+.03,.105,.07,tint);
        }else shrubs.push([px,y,pz,.7+rng()*.55]);
      }
      for(let n=0;n<4;n++){
        const px=x+sign*(3.3+rng()*gardenWidth),pz=z+side*(3+rng()*4);
        shrubs.push([px,terrainHeight(px,pz),pz,.65+rng()*1.4]);
      }
    }
    const px=x+2.2,pz=side*6.8,y=terrainHeight(px,pz);
    box(timber,px,y+.52,pz,.105,1.1,.105,0x685345);
    box(iron,px,y+1.06,pz,.40,.24,.25,kind==='inn'?0x885249:0x505853);
  }
  // Sparse roadside poles with sagging lines and ceramic insulators.
  let last;
  for(let x=-470;x<=476;x+=47){
    const z=mainRoad.value(x)-7.7,y=terrainHeight(x,z);
    collision.add(anchor.x-x,anchor.z-z,.14,'pole',7.15);
    box(timber,x,y+3.55,z,.22,7.15,.23,0x665441);
    box(timber,x,y+6.72,z,.19,.15,1.8,0x665441);
    for(const offset of [-.69,0,.69]){
      box(iron,x,y+6.9,z+offset,.11,.24,.11,0x999c8e);
      if(last){
        let a=[last.x,last.y+7.03,last.z+offset];
        for(let n=1;n<=8;n++){
          const t=n/8,b=[last.x+(x-last.x)*t,last.y+(y-last.y)*t+7.03-3.3*t*(1-t),last.z+(z-last.z)*t+offset];
          wires.push(...a,...b);a=b;
        }
      }
    }
    last={x,y,z};
  }
  function boxes(records){
    const mesh=new T.InstancedMesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({roughness:.94}),records.length);
    records.forEach(([x,y,z,w,h,d,c],i)=>{
      matrix.position.set(x,y,z);matrix.scale.set(w,h,d);matrix.updateMatrix();
      mesh.setMatrixAt(i,matrix.matrix);mesh.setColorAt(i,treeGreen.setHex(c));
    });
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.layers.enable(3);group.add(mesh);
  }
  // Rail timbers follow the actual curved deck in the valley.
  const beams=[];
  function rail(a,b,width,height,color){
    const from=new T.Vector3(...a), to=new T.Vector3(...b);
    const delta=to.clone().sub(from);
    matrix.position.copy(from).lerp(to,.5);
    matrix.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),delta.clone().normalize());
    matrix.scale.set(width,height,delta.length()+.03);matrix.updateMatrix();
    beams.push({matrix:matrix.matrix.clone(),color});
    const gameTransform=new T.Matrix4().makeRotationY(Math.PI);
    gameTransform.setPosition(anchor.x,-anchor.y,anchor.z).multiply(matrix.matrix);
    collision.addMesh(anchor.x-matrix.position.x,anchor.z-matrix.position.z,hull,gameTransform,'railing');
  }
  for(const side of [-1,1]){
    let previous=null;
    for(let z=5280;z<=5320;z+=4){
      const slope=hikingTrail.value(z+.5)-hikingTrail.value(z-.5);
      const offset=side*1.17/Math.hypot(1,slope);
      const x=hikingTrail.value(z)+offset, pz=z-slope*offset,y=hikingTrail.value(z,true)+.16;
      box(timber,x,y+.49,pz,.14,1.08,.14,0x736148);
      if(previous)rail(previous,[x,y+.96,pz],.13,.12,0x756650);
      previous=[x,y+.96,pz];
    }
    for(let x=2476;x<=2526;x+=5){
      const z=mainRoad.value(x)+side*3.55, y=mainRoad.value(x,true)+.17;
      box(iron,x,y+.33,z,.14,.72,.16,0x646960);
    }
  }
  matrix.rotation.set(0,0,0);
  boxes(timber);boxes(iron);
  const rails=new T.InstancedMesh(hull,new T.MeshStandardMaterial({roughness:.93}),beams.length);
  beams.forEach((part,i)=>{rails.setMatrixAt(i,part.matrix);rails.setColorAt(i,treeGreen.setHex(part.color));});
  rails.castShadow=true;rails.receiveShadow=true;rails.layers.enable(3);group.add(rails);
  const cable=new T.BufferGeometry();
  cable.setAttribute('position',new T.Float32BufferAttribute(wires,3));
  group.add(new T.LineSegments(cable,new T.LineBasicMaterial({color:0x393d38,transparent:true,opacity:.68})));
  const leaf=new T.PlaneGeometry(1,1);leaf.translate(0,.5,0);
  const foliage=new T.InstancedMesh(leaf,new T.MeshLambertMaterial({
    map:textures.fern,color:0x899373,side:T.DoubleSide,alphaTest:.45
  }),shrubs.length*3);
  shrubs.forEach(([x,y,z,h],i)=>{
    for(let k=0;k<3;k++){
      matrix.position.set(x,y-.025,z);matrix.scale.set(1.65*h,.94*h,1);
      matrix.rotation.set(0,i*4.21+k*Math.PI/3,0);matrix.updateMatrix();foliage.setMatrixAt(i*3+k,matrix.matrix);
    }
  });
  foliage.receiveShadow=true;foliage.castShadow=true;foliage.layers.enable(3);group.add(foliage);
}
