import { Vector3 } from 'three';
import { channelSlope, clamp, riverBank, waterLevel } from './math.js';

// Intersect the actual rendered hull with the water, so submerged pebbles and
// rocks that only come near the stream don't produce phantom waves.
export function waterContact(geometry,matrix,x,z,extent){
  if(riverBank(x,z)>extent+.15)return null;
  const vertices=geometry.attributes.position,index=geometry.index;
  const point=new Vector3(),world=[];
  for(let i=0;i<vertices.count;i++){
    point.fromBufferAttribute(vertices,i).applyMatrix4(matrix);
    world.push([point.x,point.z,point.y-waterLevel(point.z)]);
  }
  const slope=channelSlope(z),scale=1/Math.hypot(slope,1),dx=slope*scale,dz=scale;
  let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity,crest=-Infinity;
  const waterline=[];
  for(const p of world)crest=Math.max(crest,p[2]);
  if(crest<.022)return null;
  for(let i=0,n=index?index.count:vertices.count;i<n;i+=3){
    for(let edge=0;edge<3;edge++){
      const a=world[index?index.getX(i+edge):i+edge];
      const j=i+(edge+1)%3,b=world[index?index.getX(j):j];
      if((a[2]<0)===(b[2]<0))continue;
      const f=a[2]/(a[2]-b[2]),px=a[0]+(b[0]-a[0])*f,pz=a[1]+(b[1]-a[1])*f;
      if(riverBank(px,pz)>.30)continue;
      const u=(px-x)*dz-(pz-z)*dx,v=(px-x)*dx+(pz-z)*dz;
      u0=Math.min(u0,u);u1=Math.max(u1,u);v0=Math.min(v0,v);v1=Math.max(v1,v);
      waterline.push({x:px,z:pz,u,v});
    }
  }
  const width=(u1-u0)*.5,length=(v1-v0)*.5;
  if(width<.075||length<.06)return null;
  const u=(u0+u1)*.5,v=(v0+v1)*.5;
  const front=Array(5).fill(null);
  for(const sample of waterline){
    const across=(sample.u-u0)/(2*width);
    if(across<.12||across>.88)continue;
    const i=Math.min(4,Math.floor((across-.12)/.76*5));
    if(!front[i]||front[i].v>sample.v)front[i]=sample;
  }
  const faces=front.flatMap(sample=>sample?[{x:sample.x-dx*.053,z:sample.z-dz*.053,side:(sample.u-u)/width}]:[]);
  return {x:x+u*dz+v*dx,z:z-u*dx+v*dz,width,length,dx,dz,faces,strength:clamp(crest/.32,.16,1)};
}
