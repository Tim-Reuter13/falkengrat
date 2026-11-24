import { clamp, fbm, mix, noise, pathX, smooth } from '../noise.js';

// Coordinates and heights are in metres. X increases east, Z increases south.
export const bounds = { west: -15000, east: 15000, north: -8400, south: 9600 };
export const sites = {
  town: { name: 'Oldhoffen', x: -142, z: -3.2, yaw: -Math.PI * .54 },
  pass: { name: 'Nebelkamm', x: -11300, z: -1300, yaw: .65 },
  lake: { name: 'Glasweiher', x: 10810, z: -5160, yaw: -.22 },
  trailhead: { name: 'Wanderparkplatz', x: -260, z: 3935, yaw: Math.PI },
  lookout: { name: 'Aussichtspunkt Falkengrat', x: 455, z: 7070, yaw: -.46 },
};

export function profile(points) {
  const first = points[0][0], last = points.at(-1)[0];
  const tangents = points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    return (next[1] - previous[1]) / (next[0] - previous[0]);
  });
  function value(position, height = false) {
    const at = clamp(position, first, last);
    let low = 0, high = points.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (at < points[mid][0]) high = mid;
      else low = mid;
    }
    const a = points[low], b = points[high], span = b[0] - a[0];
    const t = (at - a[0]) / span;
    if (height) return mix(a[2], b[2], t);
    return mix(a[1], b[1], t * t * (3 - 2 * t)) +
      span * t * (1 - t) * (tangents[low] * (1 - t) - tangents[high] * t);
  }
  return { first, last, value };
}

export const mainRoad = profile([
  [-15000, -1410, 344], [-12500, -1630, 337], [-11250, -1285, 328],
  [-8550, -1410, 313], [-5880, -950, 300], [-3500, -440, 290],
  [-1400, -75, 279], [-540, -1.5, 277], [-180, 0, 277], [180, 0, 277],
  [925, 15, 276], [2160, 12, 274.8], [2500, 0, 274.8], [2800, -32, 274.8],
  [4870, -705, 293], [7250, -690, 325], [10350, -870, 364],
  [12800, -1500, 394], [15000, -1280, 410],
]);
export const forestRoad = profile([
  [0, 0, 277], [28, 0, 277], [160, 14, 278], [440, 220, 286],
  [710, 300, 293], [1160, 160, 310], [1700, -170, 335],
  [2190, -425, 351], [2530, -785, 362], [2880, -690, 372],
  [3340, -390, 384], [3750, -315, 397], [3950, -245, 403],
]);
const switchbacks = profile([
  [3950, -245, 403], [4310, -240, 418], [4750, -550, 427],
  [5110, -470, 431], [5300, -265, 426], [5390, -161, 430],
  [5710, 115, 454], [6110, 330, 483], [6500, 240, 510],
  [6704, 437, 534], [6780, 443, 538], [6900, 446, 544], [7070, 455, 557],
]);
export const hikingTrail = {
  ...switchbacks,
  value(z,height=false){
    const base=switchbacks.value(z,height);
    if(height||z<=6580)return base;
    const localZ=sites.lookout.z-118-z;
    return mix(base,sites.lookout.x+pathX(-118)-pathX(localZ),smooth(6580,6770,z));
  }
};
export const river = profile([
  [-8400, -14100], [-6950, -12920], [-5530, -12450], [-4760, -10900],
  [-3460, -8880], [-2900, -6900], [-2700, -5100], [-2190, -4750],
  [-1720, -2930], [-1480, -1620], [-1380, -590], [-1280, 680],
  [-815, 1700], [-335, 2190], [0, 2500], [460, 2540], [1180, 2990],
  [1560, 4370], [2740, 5590], [4350, 8290], [5670, 10880], [7460, 12460], [9600, 15000],
]);
export const creek = profile([
  [1180, 2990], [1780, 2390], [2430, 1050], [3230, 370],
  [3910, 140], [4550, -45], [5010, -168], [5300, -265], [5580, -370],
  [6060, -380], [6460, -510], [7070, -122], [7900, -475], [8580, -560],
]);
export const lake = { x: 11120, z: -5940, rx: 1150, rz: 680, level: 507.6 };
export const lakeOutflow = profile([
  [-5930, 11120], [-5340, 10610], [-4840, 10140], [-4210, 9060], [-3780, 8310],
  [-3260, 7460], [-2950, 6020], [-2120, 5010], [-2000, 4170],
  [-1540, 3620], [-1080, 3220], [-710, 3000], [-350, 2680], [0, 2500],
]);
export const riverHeight = z => 270 - z * .018;
export const creekHeight = z => riverHeight(1180) + (z - 1180) * .042;
export const outflowHeight = z => 270 - z * .04;
export const roadHalfWidth = 3.65;

const ridges = [
  [-10300, -5630, 760, 4200, 2210], [-4100, -5970, 440, 3300, 2250],
  [5300, -5420, 590, 3100, 2600], [12800, -6670, 470, 3800, 1850],
  [-10300, 4130, 660, 3500, 3120], [-5500, 7110, 440, 2950, 1850],
  [3900, 8140, 620, 2500, 2150], [6990, 6000, 635, 2950, 2800],
  [12200, 2600, 670, 3300, 2600],
];
const lakeDistance = (x, z) => Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz);

function grade(height, trace, along, cross, width, verge) {
  if (along < trace.first || along > trace.last) return height;
  const distance = Math.abs(cross - trace.value(along));
  if (distance > verge) return height;
  return mix(trace.value(along, true), height, smooth(width, verge, distance));
}

function channel(height, trace, x, z, width, level) {
  if (z < trace.first || z > trace.last) return height;
  const distance = Math.abs(x - trace.value(z));
  if (distance > width * 5 + 65) return height;
  const edge = Math.min(1.2, distance / width);
  const bed = level - 1.4 + edge * edge * 1.65 + Math.max(0, distance - width * 1.2) * .18;
  return mix(bed, height, smooth(width * 1.2, width * 5 + 65, distance));
}

export function terrainHeight(x, z) {
  const mainDistance = Math.abs(x - river.value(z));
  let mountains = 0;
  for (const [cx, cz, peak, sx, sz] of ridges) {
    const r = ((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2;
    if (r < 6.5) mountains += peak * Math.exp(-r);
  }
  const hills = fbm(x * .00068 + 2, z * .00068) * 112 + fbm(x * .0031, z * .0031 + 8) * 18;
  let h = riverHeight(z) + 6 + smooth(90, 1500, mainDistance) * hills +
    smooth(190, 1850, mainDistance) * mountains;
  const village = Math.hypot(x / 1050, z / 375);
  h = mix(277 + (noise(x * .008, z * .008) - .5) * 1.4, h, smooth(.36, 1, village));
  const approach = Math.hypot((x - 250) / 1230, (z - 6260) / 2140);
  if (approach < 1.4) {
    const shoulder = 476 + (z - 6260) * .099 + (x - 250) * .032 + (noise(x * .018, z * .018) - .5) * 2.4;
    h = mix(shoulder, h, smooth(.43, 1.4, approach));
  }
  const parking = Math.hypot((x - sites.trailhead.x) / 440, (z - sites.trailhead.z) / 325);
  h = mix(403, h, smooth(.14, 1, parking));
  const shore = lakeDistance(x, z);
  if (shore < 1.94) {
    h = mix(lake.level - 6.2 + 7.17 * shore ** 2, h, smooth(.99, 1.94, shore));
  }
  h = grade(h, mainRoad, x, z, 17, 143);
  h = grade(h, forestRoad, z, x, 12, 188);
  h = grade(h, hikingTrail, z, x, 7, 125);
  h = channel(h, river, x, z, 13, riverHeight(z));
  h = channel(h, creek, x, z, 4, creekHeight(z));
  return channel(h, lakeOutflow, x, z, 5, outflowHeight(z));
}

export function groundHeight(x, z) {
  let height = terrainHeight(x, z);
  if (Math.abs(z - mainRoad.value(x)) <= roadHalfWidth + .55) {
    height = Math.max(height, mainRoad.value(x, true) + .17);
  }
  if (z >= forestRoad.first && z <= forestRoad.last && Math.abs(x - forestRoad.value(z)) < 3.0) {
    height = Math.max(height, forestRoad.value(z, true) + .15);
  }
  if (z >= hikingTrail.first && z <= hikingTrail.last && Math.abs(x - hikingTrail.value(z)) < 1.35) {
    height = Math.max(height, hikingTrail.value(z, true) + .13);
  }
  return height;
}

export function openLand(x, z) {
  const village = Math.hypot(x / 850, z / 385);
  if (village < 1) return true;
  if (Math.hypot(x - sites.lookout.x, z - sites.lookout.z) < 70) return true;
  const vista = sites.lookout.z - z;
  if (vista > 0 && vista < 360 && Math.abs(x - sites.lookout.x - vista * .49) < 24 + vista * .19) return true;
  if (Math.hypot(x - sites.trailhead.x, z - sites.trailhead.z) < 35) return true;
  if (Math.abs(z - mainRoad.value(x)) < 15) return true;
  if (z >= forestRoad.first && z <= forestRoad.last && Math.abs(x - forestRoad.value(z)) < 13) return true;
  if (z >= hikingTrail.first && z <= hikingTrail.last && Math.abs(x - hikingTrail.value(z)) < 4) return true;
  if (z >= lakeOutflow.first && z < lakeOutflow.last && Math.abs(x - lakeOutflow.value(z)) < 9) return true;
  if (z > creek.first && z < creek.last && Math.abs(x - creek.value(z)) < 8) return true;
  return Math.abs(x - river.value(z)) < 21 || lakeDistance(x, z) < 1.025;
}

// Two short residential streets, both connected to the main road or the village spur.
export const villageLanes = [
  [[-244, -1], [-246, -29], [-227, -50], [-179, -57], [-124, -53]],
  [[0, 88], [22, 111], [80, 119], [143, 111], [176, 90]],
];

export function parcels() {
  const dwellings = [];
  for (const side of [-1, 1]) {
    for (let index = 0; index < 10; index++) {
      const x = -410 + index * 84 + (side < 0 ? 13 : 0);
      if (Math.abs(x) < 34 || (side < 0 && Math.abs(x + 244) < 27)) continue;
      dwellings.push({ x, z: side * (19 + index % 4 * 3.4), kind: 'house' });
    }
  }
  for (const x of [-221, -174, -129]) dwellings.push({ x, z: -69, kind: 'house' });
  for (const x of [38, 77, 117, 153]) dwellings.push({ x, z: 137, kind: 'house' });
  dwellings.push({ x: -275, z: -40, kind: 'house' });
  return [...dwellings, { x: -43, z: -19, kind: 'shop' }, { x: 57, z: -17, kind: 'inn' },
    { x: 29, z: 51, kind: 'firehouse' }];
}
