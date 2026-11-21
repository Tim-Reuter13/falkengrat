import { Box3, Ray, Triangle, Vector3 } from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Octree } from 'three/addons/math/Octree.js';
import { altitude, clamp } from './math.js';

const radius=.255, stepHeight=.28, bodyHeight=1.74, cellSize=5;
const cell=value=>Math.floor(value/cellSize);

function buildTree(geometry,matrix){
  const {position}=geometry.attributes,index=geometry.index;
  const vertices=Array.from({length:position.count},(_,i)=>new Vector3().fromBufferAttribute(position,i).applyMatrix4(matrix));
  const tree=new Octree();
  for(let i=0,n=index?index.count:position.count;i<n;i+=3){
    const a=vertices[index?index.getX(i):i],b=vertices[index?index.getX(i+1):i+1],c=vertices[index?index.getX(i+2):i+2];
    tree.addTriangle(new Triangle(a,b,c));
  }
  return tree.build();
}

export function makeCollision(){
  const cells=new Map(),entries=[];
  const capsule=new Capsule(new Vector3(),new Vector3(),radius);
  const ray=new Ray(),normal=new Vector3(),hit=new Vector3(),candidate=new Vector3(),triPoint=new Vector3();
  const edge=new Vector3(),delta=new Vector3();
  const faces=[];
  const meshTree=o=>o.tree??=(buildTree(o.geometry,o.matrix));

  function register(entry){
    entries.push(entry);
    const {bounds:{min,max}}=entry;
    for(let i=cell(min.x);i<=cell(max.x);i++)for(let j=cell(min.z);j<=cell(max.z);j++){
      const key=i+','+j;
      if(!cells.has(key))cells.set(key,[]);
      cells.get(key).push(entry);
    }
  }

  function around(x,z,reach,visit){
    const visited=new Set();
    for(let i=cell(x-reach);i<=cell(x+reach);i++)for(let j=cell(z-reach);j<=cell(z+reach);j++){
      const group=cells.get(i+','+j);
      if(!group)continue;
      for(const o of group){
        const {min,max}=o.bounds;
        if(visited.has(o)||x+reach<min.x||x-reach>max.x||z+reach<min.z||z-reach>max.z)continue;
        visited.add(o);visit(o);
      }
    }
  }

  // The axis is vertical. An edge's nearest point is either in the vertical
  // span of the axis or nearest to one of the two end caps.
  function nearestEdge(a,b){
    const start=capsule.start,end=capsule.end;
    edge.subVectors(b,a);delta.subVectors(start,a);
    const horizontal=edge.x*edge.x+edge.z*edge.z;
    const lengthSq=edge.lengthSq();
    if(lengthSq<1e-10){candidate.copy(a);return;}
    const t=horizontal>1e-10?(delta.x*edge.x+delta.z*edge.z)/horizontal:0;
    const y=a.y+edge.y*clamp(t,0,1);
    if(y>=start.y&&y<=end.y){candidate.copy(a).addScaledVector(edge,clamp(t,0,1));return;}
    const cap=y<start.y?start:end;
    candidate.copy(a).addScaledVector(edge,clamp(delta.subVectors(cap,a).dot(edge)/lengthSq,0,1));
  }

  function triangleSide(triangle){
    const start=capsule.start,end=capsule.end;
    triangle.getNormal(normal);
    if(Math.abs(normal.y)>.995)return 0;
    const side=delta.subVectors(start,triangle.a).dot(normal);
    const upper=side+(end.y-start.y)*normal.y;
    if(Math.min(side,upper)>=radius||Math.max(side,upper)<-.035)return 0;
    let best=radius*radius;
    const consider=point=>{
      delta.set(start.x-point.x,clamp(point.y,start.y,end.y)-point.y,start.z-point.z);
      const dist=delta.lengthSq();
      if(dist<best){best=dist;triPoint.copy(delta);}
    };
    triangle.closestPointToPoint(start,candidate);consider(candidate);
    triangle.closestPointToPoint(end,candidate);consider(candidate);
    nearestEdge(triangle.a,triangle.b);consider(candidate);
    nearestEdge(triangle.b,triangle.c);consider(candidate);
    nearestEdge(triangle.c,triangle.a);consider(candidate);
    // The face can cross the axis itself, with both caps and all edges further away.
    if(side*upper<0){
      candidate.copy(start).lerp(end,side/(side-upper));
      if(triangle.containsPoint(candidate)){best=0;triPoint.copy(normal);}
    }
    if(best>=radius*radius)return 0;
    const dist=Math.sqrt(best);
    if(dist>.00001)triPoint.multiplyScalar(1/dist);
    if(triPoint.dot(normal)<-.065)triPoint.copy(normal);
    const horizontal=Math.hypot(triPoint.x,triPoint.z);
    // Supporting faces are handled by the vertical ground query.
    if(horizontal<.30||triPoint.y>.87)return 0;
    triPoint.x/=horizontal;triPoint.z/=horizontal;
    return Math.min(.38,(radius-dist)/horizontal);
  }

  function floorAt(x,z,ceiling){
    let floor=altitude(x,z);
    if(floor>=ceiling)return floor;
    ray.origin.set(x,ceiling+.001,z);ray.direction.set(0,-1,0);
    around(x,z,0,o=>{
      if(!o.geometry||o.bounds.max.y<floor||o.bounds.min.y>ceiling)return;
      faces.length=0;meshTree(o).getRayTriangles(ray,faces);
      for(const t of faces){
        if(ray.intersectTriangle(t.a,t.b,t.c,true,hit)&&hit.y>floor&&t.getNormal(normal).y>.47)floor=hit.y;
      }
    });
    return floor;
  }

  return {
    add(x,z,r,type,height=0){
      const y=altitude(x,z);
      register({x,z,radius:r,type,height,bounds:new Box3(new Vector3(x-r,y-.05,z-r),new Vector3(x+r,y+height,z+r))});
    },
    addMesh(x,z,geometry,matrix,type){
      if(!geometry.boundingBox)geometry.computeBoundingBox();
      const bounds=geometry.boundingBox.clone().applyMatrix4(matrix);
      const y=altitude(x,z),height=bounds.max.y-y;
      if(height<.19||x<-150||x>150||z<-242||z>98)return;
      const r=Math.max(x-bounds.min.x,bounds.max.x-x,z-bounds.min.z,bounds.max.z-z);
      register({x,z,radius:r,type,height,geometry,matrix:matrix.clone(),bounds});
    },
    forEach(visit){entries.forEach(visit);},
    around,floorAt,
    move(position,velocity,dt,grounded){
      position.x=clamp(position.x+velocity.x*dt,-139,139);
      position.z=clamp(position.z+velocity.z*dt,-228,88);
      for(let pass=0;pass<4;pass++){
        const terrain=altitude(position.x,position.z);
        const foot=grounded?Math.max(position.y,terrain):position.y;
        const leg=grounded?stepHeight:.045;
        capsule.start.set(position.x,foot+radius+leg,position.z);
        capsule.end.set(position.x,foot+bodyHeight-radius,position.z);
        let depth=.001,pushX=0,pushZ=0;
        around(position.x,position.z,radius+.035,o=>{
          if(!capsule.intersectsBox(o.bounds))return;
          if(o.geometry){
            faces.length=0;meshTree(o).getCapsuleTriangles(capsule,faces);
            for(const triangle of faces){
              const penetration=triangleSide(triangle);
              if(penetration<=depth)continue;
              depth=penetration;pushX=triPoint.x;pushZ=triPoint.z;
            }
          }else{
            const dx=position.x-o.x,dz=position.z-o.z,d=Math.hypot(dx,dz);
            const penetration=o.radius+radius-d;
            if(penetration<=depth)return;
            depth=penetration;pushX=d>.0001?dx/d:1;pushZ=d>.0001?dz/d:0;
          }
        });
        if(!pushX&&!pushZ)break;
        position.x+=pushX*(depth+.002);position.z+=pushZ*(depth+.002);
        const into=Math.min(0,velocity.x*pushX+velocity.z*pushZ);
        velocity.x-=into*pushX;velocity.z-=into*pushZ;
      }
    },
    strike(origin,direction,reach){
      ray.set(origin,direction);
      let closest=reach,target=null;
      around(origin.x,origin.z,reach,o=>{
        if(!ray.intersectsBox(o.bounds))return;
        if(o.geometry){
          faces.length=0;meshTree(o).getRayTriangles(ray,faces);
          for(const t of faces){
            if(!ray.intersectTriangle(t.a,t.b,t.c,true,hit))continue;
            const distance=origin.distanceTo(hit);
            if(distance<closest){closest=distance;target=o;}
          }
        }else{
          const x=origin.x-o.x,z=origin.z-o.z;
          const a=direction.x**2+direction.z**2,b=x*direction.x+z*direction.z;
          const discriminant=b*b-a*(x*x+z*z-o.radius*o.radius);
          if(a<.001||discriminant<0)return;
          const distance=(-b-Math.sqrt(discriminant))/a,y=origin.y+direction.y*distance;
          if(distance>=0&&distance<closest&&y>=o.bounds.min.y&&y<=o.bounds.max.y){closest=distance;target=o;}
        }
      });
      return target?{type:target.type,distance:closest}:null;
    },
  };
}
