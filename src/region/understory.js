import * as T from 'three';
import { altitude, noise, random, smooth, waterAt } from '../math.js';
import { outerFloor } from './woodland.js';

export function createRegionalUnderstory(scene,textures){
  const fernGeo=new T.PlaneGeometry(1,1);fernGeo.translate(0,.48,0);
  const ferns=new T.InstancedMesh(fernGeo,new T.MeshLambertMaterial({
    map:textures.fern,color:0x889476,side:T.DoubleSide,alphaTest:.36
  }),1800);
  const stones=new T.InstancedMesh(new T.IcosahedronGeometry(1,0),new T.MeshStandardMaterial({
    map:textures.granite,normalMap:textures.rockNormal,roughness:1,color:0x9b9d8d
  }),820);
  for(const mesh of [ferns,stones]){mesh.count=0;mesh.receiveShadow=true;scene.add(mesh);}
  const dummy=new T.Object3D();
  let lastX=Infinity,lastZ=Infinity;
  return (px,pz)=>{
    const cx=Math.floor(px/12),cz=Math.floor(pz/12);
    if(cx===lastX&&cz===lastZ)return;
    lastX=cx;lastZ=cz;
    let leaves=0,rocks=0;
    for(let j=cz-4;j<=cz+4;j++)for(let i=cx-4;i<=cx+4;i++){
      const rng=random(Math.imul(i+887,93787)^Math.imul(j+145,32993));
      for(let n=0;n<9;n++){
        const x=(i+rng())*12,z=(j+rng())*12;
        if(Math.abs(x)<126&&z>-244&&z<66)continue;
        const field=outerFloor(x,z),water=waterAt(x,z),y=altitude(x,z);
        if(water.bank < -2 || field.trail&&water.bank>1)continue;
        const damp=1-smooth(2,17,water.bank);
        if(rng()<.15+damp*.55){
          const h=.045+rng()*.105;
          dummy.position.set(x,y+.08*h,z);dummy.rotation.set(.14*rng(),rng()*6.28,.21*rng());
          dummy.scale.set(h*(1.4+rng()),h,h*(1+rng()));dummy.updateMatrix();
          stones.setMatrixAt(rocks++,dummy.matrix);
        }else if(rng()<noise(x*.067,z*.067)*(.35+damp*.45)){
          const h=.19+rng()*.48,heading=rng()*6.28;
          dummy.position.set(x,y-.06*h,z);dummy.scale.set(h*(1.35+rng()*.65),h,1);
          for(let k=0;k<2;k++){
            dummy.rotation.set(0,heading+k*Math.PI/2,0);dummy.updateMatrix();ferns.setMatrixAt(leaves++,dummy.matrix);
          }
        }
      }
    }
    for(const [mesh,count] of [[ferns,leaves],[stones,rocks]]){
      mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(count)mesh.computeBoundingSphere();
    }
  };
}
