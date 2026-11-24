import { rootingMask } from './animal-traces.js';

export * from './noise.js';
import { clamp, fbm, mix, noise, pathX, smooth } from './noise.js';
import { anchor, core, regionalGround, regionalBed, mapWater } from './region/geography.js';

import { riverBank, riverX, waterLevel } from './valley-stream.js';
export * from './valley-stream.js';

export const riverGlsl=`
  float channelAt(float z){
    return 12.5+9.2*sin((z+30.)*.035)+5.8*sin((z+24.)*.062)+.009*z-10.*exp(-pow(abs(z-2.),2.)/580.);
  }
  float riverBankAt(vec2 p){
    return abs(p.x-channelAt(p.y))-(3.65+1.05*sin(p.y*.040+1.1)+.65*sin(p.y*.093));
  }
  float riverLevelAt(float z){return 6.7-z*.034+.09*sin(z*.15);}
`;

function landform(x, z) {
  const pathDistance = Math.abs(x - pathX(z));
  const hills = (fbm(x * .029, z * .028) - .5) * 11
    + Math.sin(x * .017 + z * .012) * 6
    + noise(x * .008 + 8, z * .009) * 19;
  const trail = 9.1 + Math.sin(-z * .038) * 1.22 - z * .041
    + Math.sin(-z * .014) * 2.6;
  const incline = smooth(1.15, 12, pathDistance);
  const crest = 8.5 * Math.exp(-((z + 112) ** 2) / 560 - ((x + 1) ** 2) / 540);
  const shoulder = 15 * Math.exp(-((x + 36) ** 2) / 760 - ((z + 66) ** 2) / 2500);
  const distance=-z;
  const valleyWall=smooth(140,267,distance)*smooth(14,92,Math.abs(x-riverX(z)))*
    (18+62*fbm(x*.017+41,z*.020)+12*Math.sin(z*.043+x*.015));
  const lateralRise=14*smooth(12,68,pathDistance)*(fbm(x*.051,z*.037)-.32);
  const folds=(noise(x*.178+17,z*.186)-.50)*mix(.26,2.12,incline);
  const ledges=1-Math.abs(noise(x*.17+z*.094,z*.11)*2-1);
  const small=(noise(x*.83,z*.77)-.5)*mix(.042,.095,incline);
  const disturbed=rootingMask(x,z,noise(x*1.32,z*1.41)-.5);
  const scar=(noise(x*.83+24,z*1.34+19)*.27-.20)*disturbed;
  const natural=trail + incline*(hills*.67-5.0+shoulder)+crest+valleyWall+lateralRise+folds
    + smooth(.14,.98,ledges)*mix(.08,.47,incline)+small+scar;
  const bank=riverBank(x,z);
  if(bank>26)return natural;
  const water=waterLevel(z), silt=noise(x*1.17,z*.69)-.5;
  if(bank<=0)return water-.038-.78*smooth(0,2.95,-bank)+silt*.062*smooth(0,.8,-bank);
  const side=Math.sign(x-riverX(z));
  const bar=side*Math.sin(z*.056+1.3);
  const gravel=water-.038+bank*(.25+bar*.092)*smooth(0,.80,bank)+smooth(.40,3.2,bank)*(silt*.19+.22*ledges);
  const toe=clamp(10+Math.max(0,natural-water)*.55-bar*3,8,26);
  return mix(gravel+scar*.83,natural,smooth(1.1,toe,bank));
}

function terrainAxis(min,max,innerMin,innerMax,outerMin,outerMax) {
  const axis=[];
  for(let value=min;value<max;){
    axis.push(value);
    value+=value>=innerMin&&value<innerMax?.40:value>=outerMin&&value<outerMax?1.1:3.2;
  }
  axis.push(max);
  return axis;
}

let grid;
export function getTerrainGrid(){
  if(grid)return grid;
  const xMin=anchor.x-core.east, xMax=anchor.x-core.west;
  const zMin=anchor.z-core.south, zMax=anchor.z-core.north;
  function axis(min,max,...steps) {
    const values=new Set(terrainAxis(min,max,...steps));
    for(let n=min;n<max;n+=16)values.add(n);
    return [...values].sort((a,b)=>a-b).filter((v,i,all)=>!i||v-all[i-1]>.00001);
  }
  const xs=axis(xMin,xMax,-36,45,-150,157);
  const zs=axis(zMin,zMax,-149,20,-246,93);
  const elevations=new Float32Array(xs.length*zs.length);
  for(let j=0;j<zs.length;j++)for(let i=0;i<xs.length;i++){
    const x=xs[i],z=zs[j];
    const d=Math.min(x-xMin,xMax-x,z-zMin,zMax-z);
    let weight=smooth(0,95,d);
    // Retain the surveyed streambed up to both ends of the detailed water mesh.
    if(z>=-470&&z<=178)weight=Math.max(weight,(1-smooth(5,17,Math.abs(x-riverX(z))))*smooth(0,22,d));
    const local=weight>0?landform(x,z):0;
    elevations[j*xs.length+i]=weight>=1?local:mix(regionalBed(anchor.x-x,anchor.z-z)-anchor.y,local,weight);
  }
  grid={xs,zs,elevations};
  return grid;
}

function interval(axis,value) {
  let left=0,right=axis.length-1;
  while(right-left>1){
    const middle=(left+right)>>1;
    if(value<axis[middle])right=middle;else left=middle;
  }
  return left;
}

// Place feet, roots and stones on the same triangle the GPU actually draws.
export function altitude(x,z){
  const mx=anchor.x-x,mz=anchor.z-z;
  if(mx<core.west||mx>core.east||mz<core.north||mz>core.south)return regionalGround(mx,mz);
  const {xs,zs,elevations}=getTerrainGrid();
  const i=interval(xs,x),j=interval(zs,z),n=xs.length,base=j*n+i;
  const u=clamp((x-xs[i])/(xs[i+1]-xs[i]),0,1),v=clamp((z-zs[j])/(zs[j+1]-zs[j]),0,1);
  const a=elevations[base],b=elevations[base+1],c=elevations[base+n],d=elevations[base+n+1];
  return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
}

export const overlook = { x: pathX(-118), z: -118 };

export function waterAt(x,z){
  if(z>=-470&&z<=178&&Math.abs(x-riverX(z))<45)return {bank:riverBank(x,z),level:waterLevel(z),side:riverX(z)-x};
  return mapWater(anchor.x-x,anchor.z-z);
}
