import { riverWidth, riverX, waterLevel } from '../valley-stream.js';
import { clamp, mix, pathX, smooth } from '../noise.js';
import { bounds, creek, creekHeight, forestRoad, hikingTrail, lake, lakeOutflow, mainRoad,
  outflowHeight, profile, river, riverHeight, sites, terrainHeight, villageLanes, parcels } from './layout.js';

// Keep the original valley in its authored metre coordinates. Map north is game +Z.
export const anchor = { x: sites.lookout.x + pathX(-118), z: sites.lookout.z - 118, y: 535 };
export const toGame = (x,z) => ({ x: anchor.x - x, z: anchor.z - z });
export const toMap = toGame;
export const core = { west: 104, east: 872, north: 6704, south: 7472 };
export const insideCore = (x,z) => x >= core.west && x <= core.east && z >= core.north && z <= core.south;
export const worldBounds = { minX: anchor.x-bounds.east, maxX: anchor.x-bounds.west,
  minZ: anchor.z-bounds.south, maxZ: anchor.z-bounds.north };

const mouth = 6270, join = anchor.z-178, source = anchor.z+470;
const lower = profile([[mouth, creek.value(mouth)], [6410, -231], [6540, -18], [6650, 215],
  [join-32, anchor.x-riverX(210)], [join, anchor.x-riverX(178)]]);
export const tributary = {
  first:mouth,last:source+79,
  value(z) { return z < join ? lower.value(z) : anchor.x-riverX(anchor.z-z); },
  level(z) { return z < join ? mix(creekHeight(mouth),anchor.y+waterLevel(178),(z-mouth)/(join-mouth)) : anchor.y+waterLevel(anchor.z-z); },
  width(z) { return riverWidth(anchor.z-z)*
    (1-smooth(source,source+79,z)); },
  join, source,
};

const streamEdges = [[river, 13, riverHeight], [creek, 4, creekHeight], [lakeOutflow, 5, outflowHeight]];
export function mapWater(x,z) {
  let bank=Infinity, level=-Infinity, side=0;
  for (const [trace,width,surface] of streamEdges) {
    if (z<trace.first || z>trace.last) continue;
    const offset=trace.value(z)-x, d=Math.abs(offset)-width;
    if (d<bank) { bank=d; level=surface(z); side=-offset; }
  }
  if (z>=tributary.first && z<=tributary.last) {
    const offset=tributary.value(z)-x, d=Math.abs(offset)-tributary.width(z);
    if (d<bank) { bank=d; level=tributary.level(z); side=-offset; }
  }
  const dx=x-lake.x,dz=z-lake.z;
  const shore=(Math.hypot(dx/lake.rx,dz/lake.rz)-.93)*lake.rz;
  if(shore<bank) return {bank:shore,level:lake.level-anchor.y,side:dx};
  return {bank,level:level-anchor.y,side};
}

function bedrock(x,z) {
  let y=terrainHeight(x,z);
  if(z>=tributary.first && z<=tributary.last) {
    const d=Math.abs(x-tributary.value(z)), w=tributary.width(z);
    if(d<w+48) {
      const yBed=tributary.level(z)-.72+Math.min(1,d/Math.max(.1,w))**2*.72+Math.max(0,d-w)*.21;
      y=mix(yBed,y,smooth(w,w+48,d));
    }
  }
  return y;
}
// All three LODs and the detailed valley agree at the hand-authored mesh boundary.
export function seamHeight(x,z) {
  const u=clamp(x,core.west,core.east),v=clamp(z,core.north,core.south);
  const dx=Math.min(Math.abs(x-core.west),Math.abs(x-core.east));
  const dz=Math.min(Math.abs(z-core.north),Math.abs(z-core.south));
  const horizontal=dz<dx;
  const along=horizontal?u:v, edge=horizontal?(Math.abs(z-core.north)<Math.abs(z-core.south)?core.north:core.south):
    (Math.abs(x-core.west)<Math.abs(x-core.east)?core.west:core.east);
  // 16 m stations are relative to the tile grid (both region origins are multiples of 8, not 16).
  const start=horizontal?core.west:core.north;
  const k=start+Math.floor((along-start)/16)*16;
  const at=p=>horizontal?bedrock(p,edge):bedrock(edge,p);
  return mix(at(k),at(k+16),(along-k)/16);
}
export function regionalBed(x,z) {
  const y=bedrock(x,z);
  if(x<core.west-16||x>core.east+16||z<core.north-16||z>core.south+16)return y;
  const d=Math.min(Math.abs(x-core.west),Math.abs(x-core.east),Math.abs(z-core.north),Math.abs(z-core.south));
  return d>=16?y:mix(seamHeight(x,z),y,smooth(0,16,d));
}

const cacheSize=1<<17, keys=new Float64Array(cacheSize).fill(NaN), heights=new Float64Array(cacheSize);
function sample(i,j) {
  const k=(i+8192)*16384+j+8192, s=(Math.imul(i,73856093)^Math.imul(j,19349663))&(cacheSize-1);
  if(keys[s]!==k){keys[s]=k;heights[s]=regionalBed(bounds.west+i*4,bounds.north+j*4);}
  return heights[s];
}
export function regionalGround(x,z) {
  const u=(x-bounds.west)/4,v=(z-bounds.north)/4,i=Math.floor(u),j=Math.floor(v),s=u-i,t=v-j;
  const b=sample(i+1,j),c=sample(i,j+1);
  const y=s+t<=1 ? sample(i,j)*(1-s-t)+b*s+c*t : sample(i+1,j+1)*(s+t-1)+b*(1-t)+c*(1-s);
  return y-anchor.y;
}

export function deckHeight(x,z,y) {
  if(Math.abs(z-mainRoad.value(x))<3.65) y=Math.max(y,mainRoad.value(x,true)+.17-anchor.y);
  if(z>=0&&z<=forestRoad.last&&Math.abs(x-forestRoad.value(z))<2.6) y=Math.max(y,forestRoad.value(z,true)+.15-anchor.y);
  if(z>=5280&&z<=5320&&Math.abs(x-hikingTrail.value(z))<1.25*Math.hypot(1,hikingTrail.value(z+.5)-hikingTrail.value(z-.5))) y=Math.max(y,hikingTrail.value(z,true)+.16-anchor.y);
  return y;
}

const lots=parcels();
export function clearGround(x,z) {
  if(Math.abs(z-mainRoad.value(x))<5.2 || (x>-114&&x<4&&z>0&&z<9))return true;
  if(z>=0&&z<=forestRoad.last&&Math.abs(x-forestRoad.value(z))<3.5)return true;
  if(z>=hikingTrail.first&&z<=hikingTrail.last&&Math.abs(x-hikingTrail.value(z))<1.9)return true;
  if(x>=-264&&x<=-226&&z>=3934&&z<=3964)return true;
  if(Math.abs(x)<480&&Math.abs(z)<155){
    if(lots.some(p=>Math.abs(x-p.x)<7&&Math.abs(z-p.z)<7))return true;
    if(lots.some(p=>Math.abs(p.z)<40&&Math.abs(x-p.x)<1.55 && z*p.z>=0 && Math.abs(z)<=Math.abs(p.z)))return true;
    for(const lane of villageLanes)for(let i=1;i<lane.length;i++){
      const [a,b]=lane[i-1],[c,d]=lane[i],dx=c-a,dz=d-b;
      const t=clamp(((x-a)*dx+(z-b)*dz)/(dx*dx+dz*dz),0,1);
      if(Math.hypot(x-a-t*dx,z-b-t*dz)<2.8)return true;
    }
  }
  return false;
}
