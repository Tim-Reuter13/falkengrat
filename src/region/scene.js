import * as T from 'three';
import { clamp, noise, random, smooth } from '../math.js';
import {
  bounds, sites, mainRoad, forestRoad, hikingTrail, river, creek, lake, lakeOutflow,
  riverHeight, creekHeight, outflowHeight, roadHalfWidth, terrainHeight, openLand,
  parcels, villageLanes,
} from './layout.js';

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
  const land = (x, z) => terrainHeight(Math.min(x, bounds.east), Math.min(z, bounds.south));
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

function coneGeometry() {
  const vertices = [], indices = [];
  const levels = [[0, .13], [.28, .23], [.32, .20], [.52, .17], [.55, .14], [.76, .10], [1, .003]];
  const sides = 6;
  for (const [height, radius] of levels) {
    for (let j = 0; j < sides; j++) {
      const angle = j / sides * Math.PI * 2;
      vertices.push(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    }
  }
  for (let ring = 0; ring < levels.length - 1; ring++) for (let k = 0; k < sides; k++) {
    const a = ring * sides + k, b = ring * sides + (k + 1) % sides;
    indices.push(a, a + sides, b, b, a + sides, b + sides);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function streamTiles(scene) {
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
  const near = new T.MeshLambertMaterial({ vertexColors: true });
  const cone = coneGeometry();
  const timber = new T.MeshLambertMaterial({ color: 0xffffff });
  const matrix = new T.Object3D();
  const tiles = new Map();
  let queue = [], centerX = -1, centerZ = -1;

  const divisions = detail => [12, 24, 48][detail];

  function load({ i, j, detail, key, borders, signature }) {
    const x0 = bounds.west + i * tileSize, z0 = bounds.north + j * tileSize;
    const width = tileSize, depth = tileSize;
    const size = divisions(detail);
    const ground = new T.Mesh(terrain(x0, z0, width, depth, size, size, borders), near);
    const count = detail === 2 ? 118 : detail === 1 ? 92 : 56;
    const trees = new T.InstancedMesh(cone, timber, count);
    const rand = random(9307 + i * 48331 + j * 941123);
    const treeTint = new T.Color();
    let planted = 0;
    for (let n = 0; n < count; n++) {
      const x = x0 + rand() * width, z = z0 + rand() * depth;
      const chance = rand(), scale = rand(), rotation = rand();
      const y = terrainHeight(x, z);
      if (x > bounds.east || z > bounds.south || openLand(x, z) ||
        y > 960 - chance * 55 || chance < noise(x * .006, z * .006) * .28) continue;
      const h = 6 + scale * 15;
      matrix.position.set(x, y - .12, z);
      matrix.rotation.set(0, rotation * Math.PI * 2, 0);
      matrix.scale.set(h * .83, h, h * .83);
      matrix.updateMatrix();
      trees.setMatrixAt(planted, matrix.matrix);
      trees.setColorAt(planted++, treeTint.setHex(0x31483b).lerp(shadeColor, scale * .73));
    }
    trees.count = planted;
    if (planted) trees.computeBoundingSphere();
    const old = tiles.get(key);
    if (old) remove(old);
    scene.add(ground);
    if (planted) scene.add(trees);
    flags[key] = 255;
    mask.needsUpdate = true;
    tiles.set(key, { ground, trees, signature });
  }

  function remove(tile) {
    scene.remove(tile.ground, tile.trees);
    tile.ground.geometry.dispose();
    tile.trees.dispose();
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
    while (queue.length && changes < (initial ? 9 : 2) &&
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
      scene.add(new T.Mesh(geo, new T.MeshLambertMaterial({ color, side: T.DoubleSide, ...options })));
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

function drawRoutes(scene) {
  const asphalt = batch(scene, 0x3d4242);
  const gravel = batch(scene, 0x747060);
  const trail = batch(scene, 0x897757);
  const paint = batch(scene, 0xdbd9c6);
  const water = batch(scene, 0x486570, { emissive: 0x15282b, emissiveIntensity: .35 });
  const bridge = batch(scene, 0x746e5a);
  const paved = x => mainRoad.value(x, true) + .17;
  const secondary = z => forestRoad.value(z, true) + .15;
  const pathHeight = z => hikingTrail.value(z, true) + .13;
  ribbon(asphalt, mainRoad, true, roadHalfWidth * 2, paved, 12);
  ribbon(gravel, forestRoad, false, 5.2, secondary, 8);
  ribbon(trail, hikingTrail, false, 2.45, pathHeight, 4);
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
  const walls = new T.InstancedMesh(shell, base, buildings.length);
  const roofs = new T.InstancedMesh(roof, base, buildings.length);
  const details = new T.InstancedMesh(shell, base, buildings.length * 4);
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
    return { x, z, w, d };
  });
  scene.add(walls, roofs, details);

  const lot = batch(scene, 0x77705e);
  const lotY = forestRoad.value(forestRoad.last, true) + .13;
  lot.quad([-262, lotY, 3936], [-228, lotY, 3936], [-262, lotY, 3962], [-228, lotY, 3962]);
  lot.add();
  const deck = new T.Mesh(new T.BoxGeometry(10, .45, 5.8), new T.MeshLambertMaterial({ color: 0x736554 }));
  deck.position.set(sites.lookout.x, terrainHeight(sites.lookout.x, sites.lookout.z) + .14, sites.lookout.z);
  scene.add(deck);
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

function makeSky(haze) {
  const sky = new T.Mesh(new T.SphereGeometry(9850, 24, 12), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, depthTest: false,
    uniforms: { horizon: { value: new T.Color(haze) }, zenith: { value: new T.Color(0x465f71) } },
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `
      varying vec3 skyDirection;
      uniform vec3 horizon, zenith;
      void main() {
        vec3 direction = normalize(skyDirection);
        float height = smoothstep(-.012, .69, direction.y);
        vec2 cloud = direction.xz / (max(0., direction.y) + .43);
        float wisps = sin(cloud.x * 6. + cloud.y * 4. + sin(cloud.y * 4.1)) * .45
          + sin(cloud.x * 13. - cloud.y * 9.5) * .23;
        vec3 color = mix(horizon, zenith, height);
        color += horizon * smoothstep(.02, .55, wisps) * height * .32;
        gl_FragColor = vec4(color, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -10;
  return sky;
}

export function createRegionScene(scene) {
  const haze = 0x899b9e;
  scene.background = new T.Color(haze);
  scene.fog = new T.FogExp2(haze, .00051);
  const sky = makeSky(haze);
  scene.add(sky);
  scene.add(new T.HemisphereLight(0xc5d5d9, 0x434a3c, 1.95));
  const sun = new T.DirectionalLight(0xe4e2d3, 1.35);
  sun.position.set(-5, 8, 2);
  scene.add(sun);
  const stream = streamTiles(scene);
  drawRoutes(scene);
  const solids = drawVillage(scene);
  sign(scene, 'Oldhoffen', -99, 7, -Math.PI / 2, true);
  sign(scene, 'Wanderparkplatz →', -13, -7, -Math.PI / 2);
  sign(scene, 'Wanderweg Falkengrat', -248, 3956, Math.PI);
  sign(scene, 'Aussichtspunkt Falkengrat', 459, 7074, 0);
  return { ...stream, solids, sky };
}
