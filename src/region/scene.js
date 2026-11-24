import * as T from 'three';
import { clamp, noise, random, smooth } from '../math.js';
import {
  bounds, sites, mainRoad, forestRoad, hikingTrail, river, creek, lake, lakeOutflow,
  riverHeight, creekHeight, outflowHeight, roadHalfWidth, terrainHeight, openLand,
  parcels, villageLanes,
} from './layout.js';

import { anchor, core, insideCore, regionalBed, tributary } from './geography.js';
import { plantRoadside } from './roadside.js';
import { createRegionalUnderstory } from './understory.js';
import { altitude } from '../math.js';

const tileSize = 256;
const columns = Math.ceil((bounds.east - bounds.west) / tileSize);
const rows = Math.ceil((bounds.south - bounds.north) / tileSize);
const forestColor = new T.Color(0x273b32);
const meadowColor = new T.Color(0x62734b);
const cliffColor = new T.Color(0x73756d);
const shadeColor = new T.Color(0x172b24);
const tint = new T.Color();

function terrain(x0, z0, width, depth, nx, nz, borders) {
  const positions = [], colors = [], indices = [];
  const land = (x, z) => regionalBed(Math.min(x, bounds.east), Math.min(z, bounds.south));
  function vertex(x, z, height) {
    const cover = noise(x * .0023, z * .0023);
    const small = noise(x * .026, z * .026 + 18);
    tint.copy(forestColor).lerp(shadeColor, cover * .48);
    if (openLand(x, z)) tint.lerp(meadowColor, .68 + .27 * small);
    tint.lerp(cliffColor, smooth(740, 975, height + cover * 93));
    tint.multiplyScalar(.84 + .31 * small);
    positions.push(x, height, z);
    colors.push(tint.r, tint.g, tint.b);
  }

  // Fine vertices on a shared edge follow the exact segment drawn by the lower LOD.
  function stitch(u, segments, heightAt) {
    const lo = Math.min(segments - 1, Math.floor(u * segments));
    const t = u * segments - lo;
    return T.MathUtils.lerp(heightAt(lo / segments), heightAt((lo + 1) / segments), t);
  }
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + width * i / nx, z = z0 + depth * j / nz;
    let height = land(x, z);
    if (borders && (j === 0 || j === nz)) {
      height = stitch(i / nx, borders[j === 0 ? 0 : 2], u => land(x0 + u * width, z));
    } else if (borders && (i === 0 || i === nx)) {
      height = stitch(j / nz, borders[i === 0 ? 3 : 1], u => land(x, z0 + u * depth));
    }
    vertex(x, z, height);
  }
  const stride = nx + 1;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if(width>tileSize && insideCore(x0+(i+.5)*width/nx,z0+(j+.5)*depth/nz))continue;
    const a = j * stride + i;
    indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function streamTiles(scene, forest, woodland, textures) {
  const flags = new Uint8Array(columns * rows);
  const mask = new T.DataTexture(flags, columns, rows, T.RedFormat);
  mask.needsUpdate = true;
  const low = new T.MeshLambertMaterial({ vertexColors: true });
  low.onBeforeCompile = shader => {
    shader.uniforms.nearTiles = { value: mask };
    shader.vertexShader = 'varying vec2 tilePoint;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\ntilePoint = position.xz;');
    shader.fragmentShader = 'varying vec2 tilePoint;\nuniform sampler2D nearTiles;\n' +
      shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        vec2 tile = floor((tilePoint - vec2(${bounds.west}.0, ${bounds.north}.0)) / ${tileSize}.0);
        if (texture2D(nearTiles, (tile + .5) / vec2(${columns}.0, ${rows}.0)).r > .5) discard;`);
  };
  const distant = new T.Mesh(terrain(bounds.west, bounds.north, columns * tileSize, rows * tileSize,
    columns, rows), low);
  scene.add(distant);
  const near = new T.MeshStandardMaterial({roughness:.98,vertexColors:true});
  near.onBeforeCompile=shader=>{
    shader.uniforms.needles={value:textures.needles}; shader.uniforms.meadow={value:textures.meadow};
    shader.uniforms.granite={value:textures.granite}; shader.uniforms.groundRelief={value:textures.groundNormal};
    shader.vertexShader='varying vec3 landPos;\n'+shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nlandPos=position;');
    shader.fragmentShader='varying vec3 landPos; uniform sampler2D needles,meadow,granite,groundRelief;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>', `
      vec2 p=landPos.xz;
      vec2 bend=.38*vec2(sin(p.y*.051)+cos(p.x*.084),cos(p.y*.076)+sin(p.x*.048));
      vec2 uv=p*.34+bend, uv2=mat2(.8,-.6,.6,.8)*p*.23-bend;
      float patchMix=.5+.25*sin(p.x*.049+p.y*.015)+.25*cos(p.y*.062-p.x*.021);
      vec3 litter=mix(texture2D(needles,uv).rgb,texture2D(needles,uv2).rgb,patchMix);
      vec3 grass=mix(texture2D(meadow,uv).rgb,texture2D(meadow,uv2).rgb,1.-patchMix);
      float grassland=smoothstep(.042,.114,vColor.g);
      float cliff=smoothstep(775.,1020.,landPos.y+patchMix*78.);
      vec3 surface=mix(mix(litter,grass,.22+.70*grassland),texture2D(granite,uv*.41).rgb,cliff);
      diffuseColor.rgb*=surface*(.76+.40*patchMix);
    `).replace('#include <normal_fragment_maps>',`
      vec2 grad=texture2D(groundRelief,landPos.xz*.51).rg*2.-1.;
      vec3 t=normalize(mat3(viewMatrix)*vec3(-1.,0.,0.));
      vec3 b=normalize(mat3(viewMatrix)*vec3(0.,0.,-1.));
      normal=normalize(normal+.17*(t*grad.x+b*grad.y));
    `);
  };
  const tiles = new Map();
  let queue = [], centerX = -1, centerZ = -1;

  const divisions = detail => [16, 32, 64][detail];

  function load({ i, j, detail, key, borders, signature }) {
    const x0 = bounds.west + i * tileSize, z0 = bounds.north + j * tileSize;
    const width = tileSize, depth = tileSize;
    const size = divisions(detail);
    const old=tiles.get(key);
    if(old?.ground){scene.remove(old.ground);old.ground.geometry.dispose();}
    const ground=insideCore(x0+width/2,z0+depth/2)?null:new T.Mesh(terrain(x0,z0,width,depth,size,size,borders),near);
    if(ground){ground.receiveShadow=true;scene.add(ground);}
    const release=old?.release??forest.addStand(woodland.tile(x0,z0));
    flags[key] = 255;
    mask.needsUpdate = true;
    tiles.set(key, { ground, release, signature });
  }

  function remove(tile) {
    if(tile.ground){scene.remove(tile.ground);tile.ground.geometry.dispose();}
    tile.release();
  }

  function update(x, z, initial = false) {
    const i = clamp(Math.floor((x - bounds.west) / tileSize), 0, columns - 1);
    const j = clamp(Math.floor((z - bounds.north) / tileSize), 0, rows - 1);
    if (i !== centerX || j !== centerZ) {
      centerX = i; centerZ = j;
      const next = new Map();
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const col = i + dx, row = j + dz;
        if (col < 0 || row < 0 || col >= columns || row >= rows) continue;
        const level = Math.max(Math.abs(dx), Math.abs(dz)), key = row * columns + col;
        next.set(key, { i: col, j: row, key, distance: dx * dx + dz * dz, detail: Math.min(2, 3 - level) });
      }
      for (const [key, tile] of tiles) {
        if (next.has(key)) continue;
        remove(tile);
        tiles.delete(key);
        flags[key] = 0;
        mask.needsUpdate = true;
      }
      for (const patch of next.values()) {
        const { i: col, j: row, detail } = patch;
        patch.borders = [[col, row - 1], [col + 1, row], [col, row + 1], [col - 1, row]]
          .map(([nx, nz]) => {
            if (nx < 0 || nx >= columns || nz < 0 || nz >= rows) return divisions(detail);
            const ax=bounds.west+nx*tileSize+128,az=bounds.north+nz*tileSize+128;
            if(insideCore(ax,az))return 16;
            const neighbor = next.get(nz * columns + nx);
            return neighbor ? divisions(Math.min(detail, neighbor.detail)) : 1;
          });
        patch.signature = [detail, ...patch.borders].join(',');
      }
      queue = [...next.values()].filter(item => tiles.get(item.key)?.signature !== item.signature)
        .sort((a, b) => a.distance - b.distance);
    }
    const start = performance.now();
    let changes = 0;
    while (queue.length && changes < (initial ? 1 : 2) &&
      (changes === 0 || initial || performance.now() - start < 3.5)) {
      load(queue.shift());
      changes++;
    }
  }
  return { update, stats: () => ({ loaded: tiles.size, queued: queue.length }) };
}

function batch(scene, color, options = {}) {
  const vertices = [], indices = [];
  return {
    quad(a, b, c, d) {
      const i = vertices.length / 3;
      vertices.push(...a, ...b, ...c, ...d);
      indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    },
    triangle(a, b, c) {
      const i = vertices.length / 3;
      vertices.push(...a, ...b, ...c);
      indices.push(i, i + 1, i + 2);
    },
    add() {
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const material=new T.MeshStandardMaterial({color,side:T.DoubleSide,roughness:options.water?.28:.96});
      material.onBeforeCompile=shader=>{
        shader.vertexShader='varying vec3 routePoint;\n'+shader.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\nroutePoint=position;');
        shader.fragmentShader='varying vec3 routePoint;\n'+shader.fragmentShader;
        if(options.water){
          shader.uniforms.flowTime=scene.userData.clock;
          shader.fragmentShader='uniform float flowTime;\n'+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`
            vec2 uv=routePoint.xz;
            float a=sin(dot(uv,vec2(2.6,.8))+flowTime*1.5+sin(uv.y*.61));
            float b=sin(dot(uv,vec2(-1.7,3.3))-flowTime*1.8);
            normal=normalize(normal+mat3(viewMatrix)*vec3(a*.071,0.,b*.059));
            diffuseColor.rgb*=.78+.22*pow(1.-abs(dot(normal,normalize(vViewPosition))),3.);
          `);
        }else{
          shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`
            vec2 p=routePoint.xz;
            vec2 cell=floor(p*47.);
            float grit=fract(sin(dot(mod(cell,512.),vec2(17.13,43.71)))*3274.23);
            float detail=1.-smoothstep(.012,.07,max(fwidth(p.x),fwidth(p.y)));
            diffuseColor.rgb*=(.94+.05*sin(p.x*.37+sin(p.y*.28)))*mix(1.,.71+.58*grit,detail);
          `);
        }
      };
      if(options.aggregate){
        const compile=material.onBeforeCompile;
        material.onBeforeCompile=shader=>{
          compile(shader);shader.uniforms.aggregate={value:options.aggregate};
          shader.fragmentShader='uniform sampler2D aggregate;\n'+shader.fragmentShader.replace('#include <roughnessmap_fragment>',`
            #include <roughnessmap_fragment>
            vec2 st=routePoint.xz;
            vec3 a=texture2D(aggregate,st*.92).rgb;
            vec3 b=texture2D(aggregate,mat2(.8,.6,-.6,.8)*st*.43).rgb;
            float grains=clamp(dot(mix(a,b,.42),vec3(.21,.72,.07))*2.9,.35,1.3);
            diffuseColor.rgb*=.64+.48*grains;
          `);
        };
      }
      material.customProgramCacheKey=()=>options.aggregate?'aggregate':options.water?'region-water':'region-road';
      const mesh=new T.Mesh(geo,material);mesh.receiveShadow=true;scene.add(mesh);
    },
  };
}

function ribbon(layer, trace, xAxis, width, height, step, first = trace.first, last = trace.last, shift = 0) {
  function edge(at, side) {
    const lateral = trace.value(at);
    const slope = (trace.value(at + .5) - trace.value(at - .5));
    const r = (width / 2 * side + shift) / Math.hypot(slope, 1);
    const along = at - r * slope, cross = lateral + r, y = height(at);
    return xAxis ? [along, y, cross] : [cross, y, along];
  }
  let a = edge(first, -1), b = edge(first, 1);
  for (let at = first; at < last;) {
    at = Math.min(last, at + step);
    const c = edge(at, -1), d = edge(at, 1);
    layer.quad(a, b, c, d);
    a = c; b = d;
  }
}

function drawRoutes(scene,textures) {
  const asphalt = batch(scene, 0x4c5050, { aggregate:textures.granite });
  const gravel = batch(scene, 0x918774, { aggregate:textures.earth });
  const trail = batch(scene, 0x9a8768, { aggregate:textures.needles });
  const paint = batch(scene, 0xdbd9c6);
  const water = batch(scene, 0x677e77, { water: true });
  const bridge = batch(scene, 0x746e5a);
  const paved = x => mainRoad.value(x, true) + .17;
  const secondary = z => forestRoad.value(z, true) + .15;
  const pathHeight = z => hikingTrail.value(z, true) + .13;
  ribbon(gravel,mainRoad,true,roadHalfWidth*2+2.1,x=>paved(x)-.045,12);
  ribbon(asphalt, mainRoad, true, roadHalfWidth * 2, paved, 12);
  ribbon(gravel, forestRoad, false, 5.2, secondary, 8);
  // The final approach follows the original forest floor into its painted footpath.
  const approachEnd=anchor.z-87;
  const trailY=z=>z<core.north?pathHeight(z):altitude(anchor.x-hikingTrail.value(z),anchor.z-z)+anchor.y+.055;
  ribbon(trail,hikingTrail,false,2.45,trailY,2,hikingTrail.first,approachEnd);
  const tributaryStrip=(start,end)=>{for(let z=start;z<end;z+=2){
    const next=Math.min(end,z+2);
    const edge=t=>[-1,1].map(sign=>[tributary.value(t)+sign*tributary.width(t),tributary.level(t)+.015,t]);
    water.quad(...edge(z),...edge(next));
  }};
  tributaryStrip(tributary.first,tributary.join);
  tributaryStrip(tributary.source,tributary.last);
  ribbon(water, river, false, 24, z => riverHeight(z) + .015, 11);
  ribbon(water, creek, false, 6.9, z => creekHeight(z) + .02, 8);
  ribbon(water, lakeOutflow, false, 7.5, z => outflowHeight(z) + .025, 9);
  const surface = [lake.x, lake.level, lake.z];
  for (let n = 0; n < 64; n++) {
    const shore = angle => [lake.x + Math.cos(angle) * lake.rx * .93, lake.level,
      lake.z + Math.sin(angle) * lake.rz * .93];
    water.triangle(surface, shore((n + 1) * Math.PI / 32), shore(n * Math.PI / 32));
  }

  // Eastbound right turn. The two through lanes retain their axes and the shoulder widens into a pocket.
  const pocket = (x, inner, outer) => [inner, outer].map(z => [x, paved(x) + .016, z]);
  function edge(x) { return 3.43 + smooth(-112, -77, x) * 2.95 + smooth(-10, -2, x) * 1.65; }
  for (let x = -112; x < -1; x += 2) {
    const next = Math.min(-1, x + 2);
    asphalt.quad(...pocket(x, 3.42, edge(x)), ...pocket(next, 3.42, edge(next)));
  }
  for (let x = mainRoad.first + 4; x < mainRoad.last - 7; x += 14) {
    ribbon(paint, mainRoad, true, .105, p => paved(p) + .019, 4, x, x + 4);
  }
  for (let x = -76; x < -12; x += 8) {
    ribbon(paint, mainRoad, true, .12, p => paved(p) + .038, 4, x, x + 4, 3.52);
  }
  const arrowY = paved(-43) + .045;
  paint.quad([-50, arrowY, 4.73], [-50, arrowY, 4.98], [-42, arrowY, 4.73], [-42, arrowY, 4.98]);
  paint.quad([-42.25, arrowY, 4.73], [-42, arrowY, 4.73], [-42.25, arrowY, 5.59], [-42, arrowY, 5.59]);
  paint.triangle([-42.8, arrowY, 5.45], [-41.48, arrowY, 5.45], [-42.13, arrowY, 6.02]);

  ribbon(bridge, mainRoad, true, .34, p => paved(p) + .66, 3, 2476, 2526, -3.55);
  ribbon(bridge, mainRoad, true, .34, p => paved(p) + .66, 3, 2476, 2526, 3.55);
  ribbon(bridge, hikingTrail, false, 2.5, p => pathHeight(p) + .027, 2, 5280, 5320);
  for (const side of [-1, 1]) {
    const z0 = mainRoad.value(2476) + side * 3.6, z1 = mainRoad.value(2526) + side * 3.6;
    bridge.quad([2476, paved(2476), z0], [2476, paved(2476) - .74, z0],
      [2526, paved(2526), z1], [2526, paved(2526) - .74, z1]);
  }
  for (const lane of villageLanes) {
    for (let n = 1; n < lane.length; n++) {
      const [x0, z0] = lane[n - 1], [x1, z1] = lane[n];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const ox = (z1 - z0) / len * 2.1, oz = (x0 - x1) / len * 2.1;
      const y0 = terrainHeight(x0, z0) + .12, y1 = terrainHeight(x1, z1) + .12;
      gravel.quad([x0 + ox, y0, z0 + oz], [x0 - ox, y0, z0 - oz],
        [x1 + ox, y1, z1 + oz], [x1 - ox, y1, z1 - oz]);
    }
  }
  for (const { x, z } of parcels()) {
    let footX = x, footZ = mainRoad.value(x), distance = (z - footZ) ** 2;
    const spurX = forestRoad.value(z);
    if (z >= 0 && (x - spurX) ** 2 < distance) {
      footX = spurX;
      footZ = z;
      distance = (x - spurX) ** 2;
    }
    for (const lane of villageLanes) {
      for (let n = 1; n < lane.length; n++) {
        const [ax, az] = lane[n - 1], [bx, bz] = lane[n];
        const dx = bx - ax, dz = bz - az;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
        const sx = ax + dx * t, sz = az + dz * t;
        const length = (x - sx) ** 2 + (z - sz) ** 2;
        if (length < distance) { footX = sx; footZ = sz; distance = length; }
      }
    }
    const dx = x - footX, dz = z - footZ;
    const length = Math.sqrt(distance), ox = dz / length * 1.24, oz = -dx / length * 1.24;
    const y0 = terrainHeight(footX, footZ) + .097, y1 = terrainHeight(x, z) + .097;
    gravel.quad([footX + ox, y0, footZ + oz], [footX - ox, y0, footZ - oz],
      [x + ox, y1, z + oz], [x - ox, y1, z - oz]);
  }
  for (const layer of [asphalt, gravel, trail, paint, water, bridge]) layer.add();
}

function drawVillage(scene) {
  const buildings = parcels();
  const shell = new T.BoxGeometry(1, 1, 1);
  const roof = new T.BufferGeometry();
  roof.setAttribute('position', new T.Float32BufferAttribute([
    -.56, 0, -.55, .56, 0, -.55, 0, 1, -.55,
    -.56, 0, .55, .56, 0, .55, 0, 1, .55,
  ], 3));
  roof.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 2, 5, 4, 2, 4, 1]);
  roof.computeVertexNormals();
  const base = new T.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const siding=new T.MeshStandardMaterial({roughness:.94});
  siding.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 boards;\n'+shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nboards=(instanceMatrix*vec4(position,1.)).xyz;');
    shader.fragmentShader='varying vec3 boards;\n'+shader.fragmentShader.replace('#include <color_fragment>',`
      #include <color_fragment>
      float v=boards.y*5.8;
      float fade=1.-smoothstep(.12,.9,fwidth(v));
      float seam=smoothstep(.015,.10,fract(v));
      float wood=.95+.05*sin((boards.x+boards.z)*2.2+floor(v)*3.6);
      diffuseColor.rgb*=mix(1.,(.65+.35*seam)*wood,fade);
    `);
  };
  const walls = new T.InstancedMesh(shell, siding, buildings.length);
  const roofs = new T.InstancedMesh(roof, base, buildings.length);
  const details = new T.InstancedMesh(shell, base, buildings.length * 4);
  const trim=new T.InstancedMesh(shell,base,buildings.length*24);
  let parts=0;
  const instance = new T.Object3D();
  const color = new T.Color();
  const palette = [0x807764, 0xa29680, 0x6a6b63, 0x74614d, 0x9b9280, 0x8c8270];
  const roofColors = [0x403f3c, 0x514443, 0x595449, 0x353c3f];
  function put(mesh, id, x, y, z, wide, high, deep, hex) {
    instance.position.set(x, y, z);
    instance.scale.set(wide, high, deep);
    instance.updateMatrix();
    mesh.setMatrixAt(id, instance.matrix);
    mesh.setColorAt(id, color.setHex(hex));
  }
  const solids = buildings.map(({ x, z, kind }, id) => {
    const house = kind === 'house';
    const w = house ? 7 + id % 4 * .75 : 12, d = house ? 8 + id % 3 : 10;
    const h = house ? 3.3 + id % 4 * .37 : 4.1;
    const y = terrainHeight(x, z) - .25, front = z > 0 ? -1 : 1;
    put(walls, id, x, y + h / 2, z, w, h, d, palette[id % palette.length]);
    put(roofs, id, x, y + h, z, w, w * .32, d, roofColors[id % roofColors.length]);
    put(details, id * 4, x + w * .18, y + h + .55, z + d * .14, .65, 2.2, .65, 0x504840);
    put(details, id * 4 + 1, x, y + 1.17, z + front * (d / 2 + .025), .96, 2.25, .085, 0x372f27);
    for (const side of [-1, 1]) {
      put(details, id * 4 + (side < 0 ? 2 : 3), x + w * .29 * side, y + 2.05,
        z + front * (d / 2 + .03), 1.22, 1.05, .09, 0x526265);
    }
    const face=z+front*(d*.5+.12);
    put(trim,parts++,x,y+.18,z,w+.16,.45,d+.16,0x66675f);
    put(trim,parts++,x,y+.32,face+front*.7,2.85,.54,1.6,0x756b58);
    put(trim,parts++,x,y+.14,face+front*1.62,1.56,.27,.46,0x817b69);
    put(trim,parts++,x,y+2.85,face+front*.74,3.15,.2,1.8,0x51483c);
    for(const side of [-1,1]){
      put(trim,parts++,x+side*1.28,y+1.58,face+front*1.44,.14,2.52,.14,0x63594b);
      const wx=x+w*.29*side;
      for(const offset of [-.62,.62])put(trim,parts++,wx+offset,y+2.05,face,.09,1.22,.12,0xaca38d);
      for(const dy of [-.55,.55])put(trim,parts++,wx,y+2.05+dy,face,1.34,.115,.16,0xa99e89);
      put(trim,parts++,wx,y+2.05,face,.055,1.07,.10,0x948a76);
      put(trim,parts++,x+side*(w*.5+.025),y+2.0,z,.09,1.20,1.32,0x455759);
    }
    return { x, z, w, d };
  });
  trim.count=parts;
  for(const mesh of [walls,roofs,details,trim]){mesh.castShadow=true;mesh.receiveShadow=true;mesh.layers.enable(3);scene.add(mesh);}

  const lot = batch(scene, 0x77705e);
  const lotY = forestRoad.value(forestRoad.last, true) + .13;
  lot.quad([-262, lotY, 3936], [-228, lotY, 3936], [-262, lotY, 3962], [-228, lotY, 3962]);
  lot.add();
  return solids;
}

function sign(scene, text, x, z, yaw, accent = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 96;
  const c = canvas.getContext('2d');
  c.fillStyle = accent ? '#e2ddc7' : '#35453d';
  c.fillRect(0, 0, 512, 96);
  c.strokeStyle = accent ? '#4a5346' : '#a9ad91';
  c.lineWidth = 5; c.strokeRect(4, 4, 504, 88);
  c.fillStyle = accent ? '#2b362d' : '#e1dcc6';
  c.font = '600 39px Georgia';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, 256, 49, 470);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  const y = terrainHeight(x, z);
  const pole = new T.Mesh(new T.BoxGeometry(.087, 2.15, .087), new T.MeshLambertMaterial({ color: 0x494941 }));
  pole.position.set(x, y + .99, z);
  const board = new T.Mesh(new T.PlaneGeometry(2.5, .47), new T.MeshLambertMaterial({ map, side: T.DoubleSide }));
  board.position.set(x, y + 1.89, z);
  board.rotation.y = yaw;
  scene.add(pole, board);
}

export function createOpenRegion(scene,forest,woodland,textures,clock,collision){
  const group=new T.Group();
  group.position.set(anchor.x,-anchor.y,anchor.z);
  group.rotation.y=Math.PI;
  group.userData.clock=clock;
  scene.add(group);
  const stream=streamTiles(group,forest,woodland,textures);
  drawRoutes(group,textures);
  plantRoadside(group,textures,collision);
  const understory=createRegionalUnderstory(scene,textures);
  const solids=drawVillage(group);
  const shape=new T.BoxGeometry(1,1,1), dummy=new T.Object3D();
  for(const {x,z,w,d} of solids){
    const gx=anchor.x-x,gz=anchor.z-z, y=terrainHeight(x,z)-anchor.y;
    dummy.position.set(gx,y+2.0,gz);dummy.scale.set(w,4.5,d);dummy.updateMatrix();
    collision.addMesh(gx,gz,shape,dummy.matrix,'house');
  }
  sign(group,'Oldhoffen',-99,7,-Math.PI/2,true);
  sign(group,'Wanderparkplatz →',-13,-7,-Math.PI/2);
  sign(group,'Wanderweg Falkengrat',-248,3956,Math.PI);
  return {update(x,z){stream.update(anchor.x-x,anchor.z-z);understory(x,z);},stats:stream.stats};
}
