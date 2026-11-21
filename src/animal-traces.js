// Shared by the terrain mesh, vegetation mask and visible tracks.
export const rootings=[
  {x:5.7,z:-3.8,rx:1.75,rz:.94,angle:-.38},
  {x:-2.7,z:-12,rx:2.16,rz:1.23,angle:.46},
  {x:2.2,z:-25.8,rx:2.6,rz:1.48,angle:-.88},
  {x:-5.5,z:-46.8,rx:2.32,rz:1.34,angle:.70},
  {x:6.5,z:-69.6,rx:2.72,rz:1.61,angle:-.18},
  {x:-7.9,z:-90.6,rx:2.08,rz:1.42,angle:.77},
  {x:-12.5,z:-107.9,rx:2.5,rz:1.26,angle:.51},
  {x:1.2,z:-127.4,rx:2.22,rz:1.30,angle:.83},
  {x:-9.8,z:-142.6,rx:2.71,rz:1.51,angle:-.48},
  {x:6.4,z:-170.8,rx:2.36,rz:1.28,angle:-.19},
].map(p=>({...p,cos:Math.cos(p.angle),sin:Math.sin(p.angle)}));

export function rootingMask(x,z,roughness){
  if(x<-17||x>11||z<-175||z>0)return 0;
  for(const p of rootings){
    const dz=z-p.z;
    if(Math.abs(dz)>3.4)continue;
    const dx=x-p.x;
    const u=(dx*p.cos-dz*p.sin)/p.rx,v=(dx*p.sin+dz*p.cos)/p.rz;
    const edge=(1-Math.hypot(u,v)+roughness*.29)/.42;
    if(edge<=0)return 0;
    const t=Math.min(1,edge);return t*t*(3-2*t);
  }
  return 0;
}
