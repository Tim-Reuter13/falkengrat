import { Box3, Vector3 } from 'three';
import { altitude, clamp, noise, random, smooth } from '../math.js';
import { anchor, clearGround, mapWater } from './geography.js';
import { bounds, openLand } from './layout.js';

const span=32;
const cellX=x=>Math.floor((x-bounds.west)/span);
const cellZ=z=>Math.floor((z-bounds.north)/span);

export function createWoodland(){
  // Physics and the renderer request the same seeded records independently.
  const cells=new Map();
  function cell(i,j){
    const key=i+j*1024;
    if(cells.has(key))return cells.get(key);
    const rng=random(Math.imul(i+812,25147)^Math.imul(j+731,234341));
    const trees=[];
    for(let n=0;n<16;n++){
      const mx=bounds.west+(i+(n%4+rng())/4)*span, mz=bounds.north+(j+((n>>2)+rng())/4)*span;
      const x=anchor.x-mx,z=anchor.z-mz;
      if(mx<bounds.west||mx>bounds.east||mz<bounds.north||mz>bounds.south)continue;
      if(x>-231&&x<231&&z>-373&&z<123||Math.abs(x)<276&&z<=-166&&z>=-454)continue;
      const grove=noise(mx*.013+13,mz*.013), clearing=noise(mx*.004,mz*.004+8);
      const meadow=openLand(mx,mz),village=Math.abs(mx)<800&&Math.abs(mz)<375;
      if(meadow&&(!village||Math.abs(mz)<13)||clearGround(mx,mz))continue;
      if(rng()>(meadow?(Math.abs(mz)<63?.15:.38):.16+.82*grove)*(.55+.45*clearing))continue;
      if(mapWater(mx,mz).bank<1.5)continue;
      const y=altitude(x,z);
      if(y+anchor.y>1030)continue;
      const height=(6+18*rng()**.76)*(1-.45*smooth(800,1030,y+anchor.y)),r=height*.022;
      trees.push({x,y,z,height,radius:r,type:'tree',species:rng()<.56?0:1,width:height*.53,
        angle:rng()*Math.PI*2,seed:rng(),tone:.57+rng()*.44,
        bounds:new Box3(new Vector3(x-r,y-.12,z-r),new Vector3(x+r,y+height,z+r))});
    }
    if(cells.size>=5600)cells.delete(cells.keys().next().value);
    cells.set(key,trees);
    return trees;
  }
  function tile(mx,mz){
    const groups=[[],[]],i0=cellX(mx),j0=cellZ(mz);
    for(let j=j0;j<j0+8;j++)for(let i=i0;i<i0+8;i++)
      for(const t of cell(i,j))groups[t.species].push(t);
    return groups;
  }
  function nearby(x,z,reach,visit){
    const mx=anchor.x-x,mz=anchor.z-z,rad=reach+.75;
    for(let j=cellZ(mz-rad);j<=cellZ(mz+rad);j++)for(let i=cellX(mx-rad);i<=cellX(mx+rad);i++)
      for(const t of cell(i,j))if(Math.abs(t.x-x)<=reach+t.radius&&Math.abs(t.z-z)<=reach+t.radius)visit(t);
  }
  return {tile,nearby};
}

const floorKeys=new Float64Array(65536).fill(NaN), fields=new Array(floorKeys.length);
export function outerFloor(x,z){
  const i=Math.floor(x),j=Math.floor(z),k=(i+32768)*65536+j+32768;
  const h=(Math.imul(i,4231)^Math.imul(j,9851))&65535;
  if(floorKeys[h]!==k){
    const mx=anchor.x-i-.5,mz=anchor.z-j-.5, w=mapWater(mx,mz);
    const trail=clearGround(mx,mz)||w.bank<.55;
    const cover=clamp(noise(mx*.062,mz*.062)*1.2-.14,0,1);
    const village=Math.abs(mx)<470&&Math.abs(mz)<155;
    fields[h]={trail:+trail,grass:(village?.39:.83)*cover,moisture:1-smooth(0,26,w.bank),shade:0};
    floorKeys[h]=k;
  }
  return fields[h];
}
