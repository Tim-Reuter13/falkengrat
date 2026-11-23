import * as T from 'three';
import { altitude, clamp, smooth } from '../math.js';

// What the player's eye can see of the cannibal, and where he can hide from it.
// Everything is ray-tested: terrain, trunks, rocks and logs (collision.blocked) and the
// tree crowns as a foliage density along the line.
export function createSenses({ collision, trees }) {
  // ---------- trees: grid for crowns and climbing
  const usable = trees.filter(t => t.height >= 8.5 && Math.abs(t.x) < 134 && t.z > -224 && t.z < 84);
  const cellSize = 10, cells = new Map();
  const key = (i, j) => i + ',' + j;
  for (const t of trees) {
    const k = key(Math.floor(t.x / cellSize), Math.floor(t.z / cellSize));
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(t);
  }
  const climbable = new Set(usable);
  function near(x, z, reach, visit, all = false) {
    for (let i = Math.floor((x - reach) / cellSize); i <= Math.floor((x + reach) / cellSize); i++)
      for (let j = Math.floor((z - reach) / cellSize); j <= Math.floor((z + reach) / cellSize); j++)
        for (const t of cells.get(key(i, j)) ?? []) {
          if (!all && !climbable.has(t)) continue;
          const d = Math.hypot(t.x - x, t.z - z);
          if (d <= reach) visit(t, d);
        }
  }
  const trunkRadius = (t, y) => t.height * .023 * (1 - y / t.height) + .03;
  const crownRadius = (t, rel) => rel < .17 || rel > 1 ? 0 : .2 * t.height * Math.pow(1 - rel, .76) * .9;

  // ---------- cover objects: trunks, boulders, stumps, fallen logs, root plates
  const covers = [], coverCells = new Map();
  collision.forEach(o => {
    let r = 0, kind = o.type;
    if (o.type === 'tree') r = o.radius;
    else if (o.geometry) {
      const sx = o.bounds.max.x - o.bounds.min.x, sz = o.bounds.max.z - o.bounds.min.z;
      const h = o.bounds.max.y - altitude(o.x, o.z);
      if (h < .75 || Math.max(sx, sz) < .8) return;
      r = Math.min(sx, sz) * .42;
    }
    if (r < .16) return;
    const c = { x: o.x, z: o.z, r, kind, height: o.height ?? 2 };
    covers.push(c);
    const k = key(Math.floor(c.x / cellSize), Math.floor(c.z / cellSize));
    if (!coverCells.has(k)) coverCells.set(k, []);
    coverCells.get(k).push(c);
  });
  function coversNear(x, z, reach, visit) {
    for (let i = Math.floor((x - reach) / cellSize); i <= Math.floor((x + reach) / cellSize); i++)
      for (let j = Math.floor((z - reach) / cellSize); j <= Math.floor((z + reach) / cellSize); j++)
        for (const c of coverCells.get(key(i, j)) ?? []) {
          const d = Math.hypot(c.x - x, c.z - z);
          if (d <= reach) visit(c, d);
        }
  }

  // ---------- lines of sight
  const seg = new T.Vector3(), probe = new T.Vector3(), zero = new T.Vector3();
  function terrainBlocks(from, to) {
    for (let i = 1; i < 10; i++) {
      const s = i / 10, x = from.x + (to.x - from.x) * s, z = from.z + (to.z - from.z) * s, y = from.y + (to.y - from.y) * s;
      if (altitude(x, z) > y + .04) return true;
    }
    return false;
  }
  const crownSeen = new Set();
  function foliage(from, to) {
    seg.subVectors(to, from);
    const len = seg.length();
    if (len < .5) return 0;
    let density = 0;
    crownSeen.clear();
    const steps = Math.ceil(len / 6);
    for (let s = 0; s <= steps; s++) {
      const x = from.x + seg.x * s / steps, z = from.z + seg.z * s / steps;
      near(x, z, 6, t => {
        if (crownSeen.has(t)) return;
        crownSeen.add(t);
        const flat = seg.x * seg.x + seg.z * seg.z;
        const u = flat < 1e-6 ? 0 : clamp(((t.x - from.x) * seg.x + (t.z - from.z) * seg.z) / flat, 0, 1);
        const px = from.x + seg.x * u, pz = from.z + seg.z * u, py = from.y + seg.y * u;
        const r = crownRadius(t, (py - t.y) / t.height);
        if (r <= 0) return;
        const off = Math.hypot(px - t.x, pz - t.z);
        if (off >= r) return;
        // Path length through the crown cone, denser near the trunk.
        const chord = 2 * Math.sqrt(r * r - off * off);
        density += chord * .34 * (1.15 - off / r * .5);
      }, true);
    }
    return clamp(density, 0, 1);
  }
  // 1 = fully visible, 0 = fully hidden.
  function lineOfSight(from, to) {
    if (terrainBlocks(from, to)) return 0;
    const hit = collision.blocked(from, to);
    if (hit && hit.distance < from.distanceTo(to) - .3) return 0;
    return 1 - foliage(from, to);
  }

  // Sight of a set of body points from the eye: angle from the view axis, night range, cover.
  // clarity 1 = unmistakably seen, inView = somewhere in the field of view and not hidden.
  const dir = new T.Vector3();
  function sight(eye, forward, points, darkness = 1) {
    let best = 0, sum = 0, inView = false, visibleAny = 0;
    for (const p of points) {
      dir.subVectors(p, eye);
      const dist = dir.length();
      dir.multiplyScalar(1 / dist);
      const angle = Math.acos(clamp(dir.dot(forward), -1, 1)) * 180 / Math.PI;
      if (angle > 58 || dist > 55) continue;
      const vis = lineOfSight(eye, p);
      if (vis < .2) continue;
      visibleAny = Math.max(visibleAny, vis);
      const central = 1 - smooth(16, 50, angle);
      const range = 1 - smooth(mix(30, 60, 1 - darkness) * .45, mix(34, 70, 1 - darkness), dist);
      const c = vis * central * range;
      best = Math.max(best, c); sum += c;
      if (angle < 52 && dist < 48) inView = true;
    }
    return { clarity: best * .65 + sum / points.length * .35, inView, visible: visibleAny };
  }

  // How hidden his crouch is at `spot` (0..1). The points follow the real squat pose of the
  // rig (measured): head 0.55 m up and 0.55 m forward, shoulders 0.55 up and 0.4 forward.
  // `towards` = he faces the eye (watching, head round the cover); otherwise his back is to it.
  const hp = [new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3()];
  function hiddenness(eye, spot, towards = false) {
    dir.subVectors(spot, eye).setY(0).normalize();
    const f = towards ? -1 : 1, fx = dir.x * f, fz = dir.z * f, sx = -dir.z, sz = dir.x;
    hp[0].set(spot.x + fx * .55, spot.y + .62, spot.z + fz * .55);
    hp[1].set(spot.x + fx * .17, spot.y + .66, spot.z + fz * .17);
    hp[2].set(spot.x, spot.y + .5, spot.z);
    hp[3].set(spot.x + fx * .4 + sx * .2, spot.y + .58, spot.z + fz * .4 + sz * .2);
    hp[4].set(spot.x + fx * .4 - sx * .2, spot.y + .58, spot.z + fz * .4 - sz * .2);
    hp[5].set(spot.x - fx * .1, spot.y + .25, spot.z - fz * .1);
    let vis = 0, most = 0;
    for (const p of hp) { const v = lineOfSight(eye, p); vis += v; most = Math.max(most, v); }
    return 1 - (most * .6 + vis / hp.length * .4);
  }

  function free(x, z) {
    probe.set(x, altitude(x, z), z);
    collision.move(probe, zero, .016, true);
    return Math.hypot(probe.x - x, probe.z - z) < .04 && collision.floorAt(x, z, probe.y + 1.2) < probe.y + .3;
  }

  // Candidate hiding places around `centre`: behind cover objects (seen from the eye),
  // to their flanks, and plain ground (hollows, behind ridges). Cheap score first, rays last.
  function findCover({ eye, from, centre, reach, score, need = .8, limit = 20, towards = false, avoid = [] }) {
    const list = [];
    coversNear(centre.x, centre.z, reach, c => {
      dir.set(c.x - eye.x, 0, c.z - eye.z).normalize();
      for (const turn of [0, .3, -.3]) {
        const cs = Math.cos(turn), sn = Math.sin(turn);
        const dx = dir.x * cs - dir.z * sn, dz = dir.x * sn + dir.z * cs;
        const gap = c.r + (towards ? .1 : .42);
        list.push({ x: c.x + dx * gap, z: c.z + dz * gap, cover: c });
      }
    });
    for (let i = 0; i < 16; i++) for (const r of [reach * .45, reach * .9]) {
      const a = i / 16 * Math.PI * 2;
      list.push({ x: centre.x + Math.sin(a) * r, z: centre.z + Math.cos(a) * r, cover: null });
    }
    for (const c of list) {
      c.y = altitude(c.x, c.z);
      c.cheap = avoid.some(a => Math.hypot(a.x - c.x, a.z - c.z) < 1.2) ? Infinity : score(c);
    }
    list.sort((a, b) => a.cheap - b.cheap);
    let best = null, tested = 0;
    const spot = new T.Vector3();
    for (const c of list) {
      if (!Number.isFinite(c.cheap)) break;
      if (tested >= limit) break;
      if (!free(c.x, c.z)) continue;
      tested++;
      spot.set(c.x, c.y, c.z);
      c.hidden = hiddenness(eye, spot, towards);
      c.towards = towards;
      if (c.hidden >= need) { best = c; break; }
      if (!best || c.hidden > best.hidden) best = c;
    }
    return best;
  }

  return { near, trunkRadius, crownRadius, lineOfSight, foliage, terrainBlocks, sight, hiddenness, findCover, free, covers, climbable: usable };
}

const mix = (a, b, f) => a + (b - a) * f;
