import { altitude, clamp, riverBank } from '../math.js';

// Navigation for the cannibal: a 1 m grid over the playable valley.
//  - blocked: trunks, boulders, logs and root plates (from the collision index), cliffs (> ~50 deg)
//  - cost: slope, wading through the stream, deep water
//  - per query an extra cost function (the player's view cone, the torch beam, distance) and a
//    small bonus next to cover, so paths hug trunks and stay out of sight
// A* with a binary heap, string pulling over walkable cells, and a path follower that replans
// when it is stuck or the goal moved, marks cells it cannot pass and reports unreachable goals.
export const NAV = { x0: -139, z0: -228, x1: 139, z1: 88, cell: 1 };

export function createNavGrid(collision) {
  const W = Math.round((NAV.x1 - NAV.x0) / NAV.cell) + 1, H = Math.round((NAV.z1 - NAV.z0) / NAV.cell) + 1;
  const N = W * H;
  const base = new Float32Array(N);        // Infinity = blocked
  const cover = new Uint8Array(N);         // 1 = next to something that hides a crouching body
  const temp = new Float32Array(N);        // temporary penalties (cells he got stuck on), decay over time
  const idx = (i, j) => j * W + i;
  const cx = i => NAV.x0 + i * NAV.cell, cz = j => NAV.z0 + j * NAV.cell;
  const ci = x => Math.round((x - NAV.x0) / NAV.cell), cj = z => Math.round((z - NAV.z0) / NAV.cell);
  const inside = (i, j) => i >= 0 && j >= 0 && i < W && j < H;

  // ---------- build the static layer
  let built = false, building = null, buildTime = 0;
  // The build is a generator so it can run in small slices between frames (no hitch).
  function* steps() {
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = cx(i), z = cz(j);
        const gx = (altitude(x + .5, z) - altitude(x - .5, z)), gz = (altitude(x, z + .5) - altitude(x, z - .5));
        const slope = Math.hypot(gx, gz);
        let c = 1 + slope * 3.2;
        if (slope > 1.25) c = Infinity;
        const bank = riverBank(x, z);
        if (bank < 0) c += bank < -1.6 ? 14 : 5;        // wading is slow and loud, deep water worse
        base[idx(i, j)] = c;
      }
      if (j % 8 === 7) yield;
    }
    // Obstacles: trunks inflated by his body radius; rocks, logs and root plates where their
    // top stands more than knee-high (one floor ray per covered cell).
    const meshCells = new Set();
    collision.forEach(o => {
      if (o.type === 'tree') {
        const r = o.radius + .38;
        stamp(o.x, o.z, r, true);
        stamp(o.x, o.z, r + 1.3, false);
      } else if (o.geometry) {
        const b = o.bounds, h = b.max.y - altitude(o.x, o.z);
        if (h < .3) return;                                   // low roots and twigs: he steps over
        for (let j = cj(b.min.z); j <= cj(b.max.z); j++) for (let i = ci(b.min.x); i <= ci(b.max.x); i++)
          if (inside(i, j)) meshCells.add(idx(i, j));
        if (h > .75) stamp(o.x, o.z, Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * .5 + 1.2, false);
      }
    });
    // His collision capsule steps over 0.28 m; anything higher blocks, and a cell that touches
    // a rock or log next to a blocked one is blocked too (the capsule is 0.5 m wide).
    let n = 0;
    const excess = new Map();
    for (const m of meshCells) {
      const x = cx(m % W), z = cz((m / W) | 0), ground = altitude(x, z);
      const e = collision.floorAt(x, z, ground + 3) - ground;
      excess.set(m, e);
      if (e > .26) base[m] = Infinity;
      if (++n % 300 === 0) yield;
    }
    for (const [m, e] of excess) {
      if (e <= .04 || base[m] === Infinity) continue;
      const i = m % W, j = (m / W) | 0;
      for (const [di, dj] of DIRS) if (inside(i + di, j + dj) && excess.get(idx(i + di, j + dj)) > .26) { base[m] = Infinity; break; }
    }
  }
  function build() {
    if (built) return buildTime;
    const t0 = performance.now();
    const it = building ?? steps();
    while (!it.next().done);
    built = true; building = null;
    return buildTime += performance.now() - t0;
  }
  // Builds in slices of a few milliseconds per frame (about 2 s of work spread over ~10 s, while
  // the player is still in the menu); returns a promise of the total time spent.
  function buildAsync(slice = 3) {
    if (built) return Promise.resolve(buildTime);
    building = building ?? steps();
    return new Promise(resolve => {
      const tick = () => {
        if (built) { resolve(buildTime); return; }
        const t0 = performance.now();
        let done = false;
        while (performance.now() - t0 < slice) if (building.next().done) { done = true; break; }
        buildTime += performance.now() - t0;
        if (done) { built = true; building = null; resolve(buildTime); } else if (document.hidden) setTimeout(tick, 0); else requestAnimationFrame(tick);
      };
      tick();
    });
  }
  function stamp(x, z, r, block) {
    const i0 = ci(x - r), i1 = ci(x + r), j0 = cj(z - r), j1 = cj(z + r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!inside(i, j)) continue;
      if (Math.hypot(cx(i) - x, cz(j) - z) > r) continue;
      if (block) base[idx(i, j)] = Infinity; else cover[idx(i, j)] = 1;
    }
  }

  // ---------- A*
  const g = new Float32Array(N), from = new Int32Array(N), stamp2 = new Uint32Array(N), closed = new Uint32Array(N);
  let generation = 1;
  const heap = new Int32Array(N), heapF = new Float32Array(N);
  let heapSize = 0;
  function push(n, f) {
    let k = heapSize++;
    while (k > 0) { const p = (k - 1) >> 1; if (heapF[p] <= f) break; heap[k] = heap[p]; heapF[k] = heapF[p]; k = p; }
    heap[k] = n; heapF[k] = f;
  }
  function pop() {
    const top = heap[0], n = heap[--heapSize], f = heapF[heapSize];
    let k = 0;
    while (true) {
      let c = 2 * k + 1;
      if (c >= heapSize) break;
      if (c + 1 < heapSize && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= f) break;
      heap[k] = heap[c]; heapF[k] = heapF[c]; k = c;
    }
    heap[k] = n; heapF[k] = f;
    return top;
  }
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  function nearestOpen(i, j) {
    if (inside(i, j) && base[idx(i, j)] !== Infinity) return [i, j];
    for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const a = i + di, b = j + dj;
      if (inside(a, b) && base[idx(a, b)] !== Infinity) return [a, b];
    }
    return null;
  }
  // extra(x, z) -> additional cost per metre (exposure); returns { points, reached, cost, expanded }
  function findPath(sx, sz, tx, tz, extra = null, maxExpand = 24000) {
    if (!built) build();
    const s = nearestOpen(ci(sx), cj(sz)), t = nearestOpen(ci(tx), cj(tz));
    if (!s || !t) return { points: [], reached: false, cost: Infinity, expanded: 0 };
    generation++;
    const start = idx(s[0], s[1]), goal = idx(t[0], t[1]);
    heapSize = 0; g[start] = 0; stamp2[start] = generation; from[start] = -1;
    push(start, 0);
    let best = start, bestH = Infinity, expanded = 0;
    while (heapSize) {
      const n = pop();
      if (closed[n] === generation) continue;
      closed[n] = generation;
      const i = n % W, j = (n / W) | 0;
      const h = Math.hypot(i - t[0], j - t[1]);
      if (h < bestH) { bestH = h; best = n; }
      if (n === goal || ++expanded > maxExpand) break;
      for (const [di, dj, len] of DIRS) {
        const a = i + di, b = j + dj;
        if (!inside(a, b)) continue;
        const m = idx(a, b);
        const bc = base[m];
        if (bc === Infinity || closed[m] === generation) continue;
        // no corner cutting past blocked cells
        if (di && dj && (base[idx(i + di, j)] === Infinity || base[idx(i, j + dj)] === Infinity)) continue;
        const x = cx(a), z = cz(b);
        let c = bc + temp[m] + (extra ? extra(x, z) : 0);
        if (cover[m]) c *= .82;
        const ng = g[n] + c * len * NAV.cell;
        if (stamp2[m] !== generation || ng < g[m]) {
          stamp2[m] = generation; g[m] = ng; from[m] = n;
          push(m, ng + Math.hypot(a - t[0], b - t[1]) * NAV.cell * 1.25);   // weighted A*: a little longer path, far fewer nodes
        }
      }
    }
    const reached = best === goal;
    const cells = [];
    for (let n = best; n !== -1; n = from[n]) cells.push(n);
    cells.reverse();
    return { points: smoothPath(cells), reached, cost: g[best], expanded, exhausted: !reached && expanded > maxExpand };
  }
  // String pulling: keep a waypoint only where the straight walk would cross a blocked cell
  // or a much more expensive one (water, cliff edge).
  function walkable(a, b) {
    const ai = a % W, aj = (a / W) | 0, bi = b % W, bj = (b / W) | 0;
    const steps = Math.max(Math.abs(bi - ai), Math.abs(bj - aj)) * 2;
    const ref = base[a];
    for (let s = 1; s < steps; s++) {
      const i = Math.round(ai + (bi - ai) * s / steps), j = Math.round(aj + (bj - aj) * s / steps);
      const c = base[idx(i, j)];
      if (c === Infinity || c > ref + 4 || temp[idx(i, j)] > 2) return false;
    }
    return true;
  }
  function smoothPath(cells) {
    if (cells.length < 3) return cells.map(n => [cx(n % W), cz((n / W) | 0)]);
    const out = [cells[0]];
    let anchor = 0;
    for (let k = 2; k < cells.length; k++) {
      if (k - anchor > 18 || !walkable(cells[anchor], cells[k])) { out.push(cells[k - 1]); anchor = k - 1; }
    }
    out.push(cells[cells.length - 1]);
    return out.map(n => [cx(n % W), cz((n / W) | 0)]);
  }

  function penalise(x, z, amount = 6, radius = 1) {
    const i0 = ci(x - radius), i1 = ci(x + radius), j0 = cj(z - radius), j1 = cj(z + radius);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inside(i, j)) temp[idx(i, j)] = Math.min(30, temp[idx(i, j)] + amount);
    tempDirty = true;
  }
  let tempDirty = false;
  function decay(dt) {
    if (!tempDirty) return;
    const k = Math.exp(-dt / 20);
    let any = false;
    for (let n = 0; n < N; n++) if (temp[n] > 0) { temp[n] = temp[n] * k < .05 ? 0 : temp[n] * k; any = true; }
    tempDirty = any;
  }
  // Straight walk between two points over open, cheap cells (for the direct chase).
  const clear = (ax, az, bx, bz) => {
    const a = nearestOpen(ci(ax), cj(az)), b = nearestOpen(ci(bx), cj(bz));
    return !!a && !!b && walkable(idx(a[0], a[1]), idx(b[0], b[1]));
  };
  const blocked = (x, z) => { const i = ci(x), j = cj(z); return !inside(i, j) || base[idx(i, j)] === Infinity; };
  const costAt = (x, z) => { const i = ci(x), j = cj(z); return inside(i, j) ? base[idx(i, j)] : Infinity; };
  const nearCover = (x, z) => { const i = ci(x), j = cj(z); return inside(i, j) && cover[idx(i, j)] === 1; };

  return { build, buildAsync, findPath, penalise, decay, clear, blocked, costAt, nearCover, size: [W, H], get built() { return built; } };
}

// Follows a path: replans when the goal moved, every few seconds, or when progress stalls;
// stalls mark the cell ahead as costly so the next plan goes round it.
export function createFollower(nav, { onReplan } = {}) {
  let path = [], k = 0, goal = null, replanAt = 0, lastPos = null, stallTime = 0, unreachable = 0, mode = null;
  let partial = false, wpIdx = -1, wpBest = Infinity, noProgress = 0, goalStalls = 0, goalBest = Infinity, goalIdle = 0;
  const state = { replans: 0, stalls: 0, unreachable: 0, lastExpanded: 0, length: 0, maxMs: 0, totalMs: 0 };
  function plan(pos, gx, gz, extra, now, why) {
    // A budget of 1500 nodes (~2 ms) per search: a long way is walked in stretches, each
    // stretch planned from the end of the last one.
    const t0 = performance.now();
    const r = nav.findPath(pos.x, pos.z, gx, gz, extra, 1500);
    const ms = performance.now() - t0; state.maxMs = Math.max(state.maxMs, +ms.toFixed(2)); state.totalMs += ms;
    path = r.points; k = path.length > 1 ? 1 : 0; goal = [gx, gz]; replanAt = now + 3; partial = r.exhausted;
    state.replans++; state.lastExpanded = r.expanded; state.length = path.length;
    if (!r.reached && !r.exhausted) { unreachable++; state.unreachable++; } else if (r.reached) unreachable = 0;
    onReplan?.(why, r);
    return r.reached;
  }
  // Returns the point to steer at, or null when arrived. `extra` is a factory: it is only
  // called (and its exposure map built) when a new path is actually searched.
  function next(pos, gx, gz, extra, now, dt, key) {
    const moved = !goal || Math.hypot(goal[0] - gx, goal[1] - gz) > 1.5;
    if (key === 'direct' && (moved || now >= replanAt) && Math.hypot(gx - pos.x, gz - pos.z) < 30 && nav.clear(pos.x, pos.z, gx, gz)) {
      // chase over open ground: no search needed, straight at him
      path = [[gx, gz]]; k = 0; goal = [gx, gz]; mode = key; replanAt = now + .4; unreachable = 0;
    } else if (moved || key !== mode || now >= replanAt || !path.length) { mode = key; plan(pos, gx, gz, extra(), now, moved ? 'goal' : 'refresh'); }
    if (moved) { goalStalls = 0; goalBest = Infinity; goalIdle = 0; }
    if (key === 'direct' && path.length === 1) path[0] = [gx, gz];
    // progress / stall detection
    if (lastPos) {
      const step = Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z);
      stallTime = step < dt * .08 ? stallTime + dt : Math.max(0, stallTime - dt * 2);
    }
    lastPos = { x: pos.x, z: pos.z };
    // No progress towards the current waypoint for 1.2 s (sliding back and forth along a rock
    // counts too) is a stall as well.
    const aim = k < path.length ? path[k] : [gx, gz];
    const gap = Math.hypot(aim[0] - pos.x, aim[1] - pos.z);
    if (wpIdx !== k) { wpIdx = k; wpBest = gap; noProgress = 0; }
    else if (gap < wpBest - .2) { wpBest = gap; noProgress = 0; }
    else noProgress += dt;
    // ...and so is circling round the goal without getting closer (each new plan resets the
    // waypoint, so the goal itself is watched too).
    const toGoal = Math.hypot(gx - pos.x, gz - pos.z);
    if (toGoal < goalBest - .3) { goalBest = toGoal; goalIdle = 0; } else goalIdle += dt;
    // Within arm's reach of the goal and no closer for a moment: that is arrival.
    if (toGoal < 1.2 && goalIdle > 1.5 && key !== 'direct') { goalIdle = 0; return null; }
    if (stallTime > .6 || noProgress > 1.2 || goalIdle > 5) {
      if (goalIdle > 5) goalStalls++;
      state.stalls++; stallTime = 0; noProgress = 0; wpIdx = -1; goalIdle = 0; goalBest = toGoal;
      nav.penalise((pos.x + aim[0]) / 2, (pos.z + aim[1]) / 2, 10, 1.2);
      // Stuck again and again on the way to the same goal: tell the caller it cannot be reached.
      if (++goalStalls >= 2) unreachable = Math.max(unreachable, 2);
      else plan(pos, gx, gz, extra(), now, 'stall');
    }
    while (k < path.length && Math.hypot(path[k][0] - pos.x, path[k][1] - pos.z) < .9) k++;
    if (k >= path.length && partial) { plan(pos, gx, gz, extra(), now, 'next stretch'); while (k < path.length && Math.hypot(path[k][0] - pos.x, path[k][1] - pos.z) < .9) k++; }
    if (k >= path.length) return Math.hypot(gx - pos.x, gz - pos.z) < .4 ? null : [gx, gz];
    return path[k];
  }
  return { next, plan, reset() { path = []; goal = null; k = 0; unreachable = 0; stallTime = 0; lastPos = null; mode = null; wpIdx = -1; noProgress = 0; goalStalls = 0; goalBest = Infinity; goalIdle = 0; }, get unreachable() { return unreachable; }, get path() { return path.slice(k); }, state };
}
