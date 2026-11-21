import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { altitude, mix, noise, pathX, random, riverBank, riverWidth, riverX, TAU, waterLevel } from './math.js';
import { waterContact } from './water-contact.js';

function rootTube(points,radius,seed){
  const curve=new T.CatmullRomCurve3(points);
  const positions=[],indices=[],uv=[];
  const up=new T.Vector3(0,1,0),along=new T.Vector3(),side=new T.Vector3(),lift=new T.Vector3();
  const center=new T.Vector3(),length=curve.getLength(),segments=Math.max(9,Math.ceil(length*6)),rings=9;
  for(let i=0;i<=segments;i++){
    const t=i/segments;
    curve.getPointAt(t,center);curve.getTangentAt(t,along);
    side.crossVectors(up,along).normalize();
    lift.crossVectors(along,side).normalize();
    const taper=radius*mix(1,.055,t**.80);
    for(let j=0;j<=rings;j++){
      const a=TAU*j/rings;
      const s=Math.cos(a)*taper*(1+Math.sin(a*3+seed+t*13)*.11);
      const l=Math.sin(a)*taper*.81;
      positions.push(center.x+s*side.x+l*lift.x,center.y+s*side.y+l*lift.y,center.z+s*side.z+l*lift.z);
      uv.push(j/rings,t*length*1.35);
      if(i<segments&&j<rings){
        const k=i*(rings+1)+j;
        indices.push(k,k+1,k+rings+1,k+1,k+rings+2,k+rings+1);
      }
    }
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry;
}

export function placeDeadwood(scene,textures,collision){
  const bark=new T.MeshPhysicalMaterial({map:textures.bark,normalMap:textures.barkNormal,
    normalScale:new T.Vector2(.58,.58),roughness:.99,specularIntensity:.17});
  const endgrain=new T.MeshPhysicalMaterial({map:textures.endgrain,normalMap:textures.endgrainNormal,
    normalScale:new T.Vector2(.53,.53),roughness:.92,specularIntensity:.15});
  function makeLog(top,bottom,height,seed,weathered=false){
    const geometry=new T.CylinderGeometry(top,bottom,height,25,11);
    const p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),a=Math.atan2(z,x);
      const r=Math.hypot(x,z);
      const ridge=1+.051*Math.sin(a*5+seed)+.023*Math.cos(a*11);
      const splinter=weathered?(y>0?1:.48)*Math.abs(y/height)**7*Math.sin(a*7+seed)*4.3:0;
      p.setXYZ(i,x*ridge+.038*(y/height+.5)**2,
        y+Math.min(1,r/top)*((.018*Math.cos(a*3+seed)+.011*Math.sin(a*7))*(y/height+.53)+splinter),
        z*ridge-.016*(y/height+.5));
      if(weathered&&Math.abs(n.getY(i))<.8)uv.setY(i,uv.getY(i)*height*1.30);
    }
    geometry.computeVertexNormals();
    const log=new T.Mesh(geometry,[bark,endgrain,endgrain]);
    log.castShadow=true;log.receiveShadow=true;scene.add(log);
    return log;
  }
  const stumpZ=-21,stumpX=pathX(stumpZ)+2;
  const stump=makeLog(.385,.51,1.31,1.7);
  stump.position.set(stumpX,altitude(stumpX,stumpZ)+.46,stumpZ);
  stump.rotation.z=.055;
  stump.updateMatrix();
  collision.addMesh(stumpX,stumpZ,stump.geometry,stump.matrix,'stump');
  const z=-70.4,x=riverX(z)+riverWidth(z)*.79;
  const driftwood=makeLog(.188,.246,3.54,2.4);
  driftwood.rotation.set(.16,.18,1.19,'YXZ');
  driftwood.position.set(x,waterLevel(z)+.055,z);
  driftwood.updateMatrix();
  collision.addMesh(x,z,driftwood.geometry,driftwood.matrix,'driftwood');
  const wakes=[waterContact(driftwood.geometry,driftwood.matrix,x,z,1.9)].filter(Boolean);

  const rng=random(12913);
  const fallenSites=[
    [6.9,-5.7,6.1,-.28,.39],[-2.8,-18.4,8.1,-.45,.43],
    [14.9,-30.8,8.4,.74,.45],[-6.3,-43.1,7.5,-.35,.49],
    [5.1,-67.3,7.7,.17,.42],[1.5,-84.4,6.7,.94,.33],
    [-14.5,-102.3,8.6,-.26,.58],[-4.8,-124.9,9.3,.57,.53],
    [17.6,-139.8,8.8,.78,.46],[-6.8,-166.4,6.8,1.22,.39],
    [-4.3,-194.5,8.3,.71,.47],
  ];
  const up=new T.Vector3(0,1,0),line=new T.Vector3(),dir=new T.Vector3(),cross=new T.Vector3();
  const start=new T.Vector3(),end=new T.Vector3(),point=new T.Vector3();
  const decorative=[];
  const clump=new T.IcosahedronGeometry(1,3),clumpPos=clump.attributes.position;
  for(let i=0;i<clumpPos.count;i++){
    const px=clumpPos.getX(i),py=clumpPos.getY(i),pz=clumpPos.getZ(i);
    const scale=.75+noise(px*3.4+py*1.98,pz*4.9-py)*.38;
    clumpPos.setXYZ(i,px*scale,py*scale,pz*scale);
  }
  clump.computeVertexNormals();
  const rootSoil=new T.MeshPhysicalMaterial({color:0xb8a18e,map:textures.earth,normalMap:textures.groundNormal,
    normalScale:new T.Vector2(.82,.82),roughness:.98,specularIntensity:.1});
  for(const [index,[x,z,length,angle,radius]] of fallenSites.entries()){
    const dx=Math.cos(angle),dz=Math.sin(angle);
    start.set(x-dx*length*.5,0,z-dz*length*.5);
    end.set(x+dx*length*.5,0,z+dz*length*.5);
    start.y=altitude(start.x,start.z)+radius*.67;
    end.y=altitude(end.x,end.z)+radius*.15;
    line.subVectors(end,start);dir.copy(line).normalize();
    cross.set(-dz,0,dx);
    const log=makeLog(radius*.41,radius,line.length(),rng()*TAU,true);
    log.position.copy(start).lerp(end,.5);
    log.quaternion.setFromUnitVectors(up,dir);log.updateMatrix();
    collision.addMesh(x,z,log.geometry,log.matrix,'fallen');
    const wake=waterContact(log.geometry,log.matrix,x,z,length*.58);
    if(wake)wakes.push(wake);
    if(index%3!==2&&riverBank(start.x,start.z)>.18){
      const soil=new T.Mesh(clump,rootSoil);
      soil.position.copy(start).addScaledVector(dir,-.21);
      soil.position.y+=radius*.43;
      soil.rotation.set(.34,-angle-Math.PI*.5,(index%2-.5)*.49,'YXZ');
      soil.scale.set(radius*2.35,radius*1.67,radius*.65);
      soil.castShadow=soil.receiveShadow=true;scene.add(soil);
      soil.updateMatrix();
      collision.addMesh(soil.position.x,soil.position.z,clump,soil.matrix,'root');
    }
    for(let k=0;k<8;k++){
      const t=mix(.16,.88,(k+.42)/8),sign=k%2?-1:1;
      const branchLength=mix(.48,1.74,rng())*mix(1.0,.62,t);
      const branchBase=point.copy(start).lerp(end,t).clone();
      const fork=branchBase.clone().addScaledVector(cross,sign*branchLength*.64).addScaledVector(dir,branchLength*.29);
      fork.y+=mix(.035,.49,rng());
      const tip=fork.clone().addScaledVector(cross,sign*branchLength*.42).addScaledVector(dir,branchLength*.35);
      tip.y+=mix(-.11,.25,rng());
      decorative.push(rootTube([branchBase,fork,tip],radius*mix(.24,.10,t),k));
      if(k%2===1){
        const offshoot=fork.clone().lerp(tip,.7).addScaledVector(dir,.48);
        offshoot.y+=.13;
        decorative.push(rootTube([fork,fork.clone().lerp(offshoot,.51),offshoot],radius*.095,k+3));
      }
    }
    for(let k=0;k<5;k++){
      const side=(k-2)*.49;
      const rootBase=start.clone().addScaledVector(cross,side*radius*.36);
      const torn=rootBase.clone().addScaledVector(dir,-mix(.54,1.13,rng())).addScaledVector(cross,side);
      torn.y+=.33+mix(.13,.74,rng());
      const ripped=torn.clone().addScaledVector(cross,side*.54).addScaledVector(dir,-.47);
      ripped.y-=.40+rng()*.33;
      decorative.push(rootTube([rootBase,torn,ripped],radius*.37,k+5));
    }
  }

  const trees=[];
  collision.forEach(o=>{if(o.type==='tree'&&o.z<4&&o.z>-207&&Math.abs(o.x-pathX(o.z))<13)trees.push(o);});
  const selected=new Set();
  for(const station of [-7,-13,-23,-34,-48,-59,-73,-86,-102,-112,-128,-145,-166,-183,-204]){
    let best=null,score=Infinity;
    for(const tree of trees){
      const delta=Math.abs(tree.z-station)+Math.abs(tree.x-pathX(station))*.32;
      if(!selected.has(tree)&&delta<score){best=tree;score=delta;}
    }
    if(!best||score>10)continue;
    selected.add(best);
    const {x,z,radius}=best;
    const roots=[];
    for(let j=0;j<5;j++){
      const towardPath=x>pathX(z)?Math.PI:0;
      const angle=towardPath+j*TAU/5+(rng()-.5)*.51;
      const length=mix(1.66,3.55,rng());
      const dx=Math.cos(angle),dz=Math.sin(angle);
      const route=[new T.Vector3(x,altitude(x,z)+radius*.73,z)];
      const bend=(rng()-.5)*.84;
      for(let k=1;k<=5;k++){
        const t=k/5,across=bend*Math.sin(t*Math.PI);
        const px=x+dx*length*t+dz*across,pz=z+dz*length*t-dx*across;
        route.push(new T.Vector3(px,altitude(px,pz)+mix(.025,-.091,t)+.065*Math.sin(t*7+j),pz));
      }
      if(riverBank(route[3].x,route[3].z)<-.20)continue;
      roots.push(rootTube(route,Math.min(.285,radius*.57),j));
      const fork=route[2];
      const v=new T.Vector3(fork.x+dx*.92-dz*.67,0,fork.z+dz*.92+dx*.67);
      v.y=altitude(v.x,v.z)-.038;
      roots.push(rootTube([fork,fork.clone().lerp(v,.59),v],radius*.21,j+1));
    }
    if(!roots.length)continue;
    const geometry=mergeGeometries(roots);
    const mesh=new T.Mesh(geometry,bark);
    mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);
    collision.addMesh(x,z,geometry,mesh.matrix,'root');
  }
  if(decorative.length){
    const mesh=new T.Mesh(mergeGeometries(decorative),bark);
    mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);
  }
  return {wakes,fallen:fallenSites.length,rootSites:selected.size};
}
