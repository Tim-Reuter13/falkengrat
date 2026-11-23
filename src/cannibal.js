import * as T from 'three';
import { altitude, clamp, mix, random, smooth, TAU } from './math.js';
import { createSenses } from './cannibal/senses.js';
import { createVoice } from './cannibal/voice.js';
import { createBody } from './cannibal/body.js';

// A hunter, not a jump-scare machine. He comes out at night, watches from cover first,
// closes in from trunk to trunk while the player looks elsewhere, tests the player with a
// snapped twig and only strikes from behind once his patience has run out.
// Seen, he never vanishes: he breaks the line of sight (trunk, rock, hollow, crown),
// waits and comes back from another side. His mood changes over the night:
//   patience  - how long he watches before he moves in
//   boldness  - grows while he stays unseen, drops with every sighting and wound
//   curiosity - how often he tests the player and how close he dares to watch
//   hunger    - grows through the night; makes him hurry and take risks
// and he remembers: where he was seen, how often the player looks round, whether the
// player runs or stands, whether a test made the player turn, whether he was wounded.
const up = new T.Vector3(0, 1, 0);
const angleBetween = (a, b) => Math.abs(((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI);

export function createCannibal({ scene, camera, collision, audio, trees, model, dagger, sounds, isNight, onCatch }) {
  const rand = random(90211);
  const pick = list => list[Math.floor(rand() * list.length)];

  // ---------- model (with the close-up fill light for the jumpscare)
  const root = new T.Group();
  const body = model.scene;
  const closeupFill = { value: 0 };
  root.add(body);
  root.visible = false;
  scene.add(root);
  body.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    const m = o.material;
    if (!m) return;
    m.roughness = Math.max(m.roughness ?? 1, .78);
    m.metalness = 0;
    m.envMapIntensity = .4;
    // Soft fill for the close-up, calculated on the actor so the forest stays dark.
    m.onBeforeCompile = shader => {
      shader.uniforms.closeupFill = closeupFill;
      shader.vertexShader = 'varying float vActorBaseHeight;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvActorBaseHeight = position.y;'
      );
      shader.fragmentShader = 'uniform float closeupFill;\nvarying float vActorBaseHeight;\n' + shader.fragmentShader.replace(
        'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;',
        `vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
         if (closeupFill > 0.0) {
           float fillFacing = max(dot(normal, normalize(vec3(-.36, .34, .86))), 0.0);
           float fillRange = 1.0 - smoothstep(.76, 1.45, length(vViewPosition));
           float fillHead = mix(.16, 1.0, smoothstep(1.33, 1.60, vActorBaseHeight));
           totalDiffuse += diffuseColor.rgb * vec3(.69, .79, .96) *
             (.24 + .76 * fillFacing) * fillRange * fillHead * closeupFill;
         }`
      );
    };
  });
  const bone = name => body.getObjectByName('mixamorig' + name) || body.getObjectByName('mixamorig:' + name);
  const head = bone('Head'), hand = bone('RightHand'), chestBone = bone('Spine2'), hipsBone = bone('Hips');
  const shoulderL = bone('LeftArm'), shoulderR = bone('RightArm');

  // ---------- bone dagger: held in the right hand, dropped on death
  const knife = dagger.scene;
  knife.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  const knifeGrip = new T.Group();
  knifeGrip.add(knife);
  (hand || body).add(knifeGrip);
  const thumb = bone('RightHandThumb1'), middle = bone('RightHandMiddle1');
  if (thumb && middle) {
    const fingers = middle.position.clone().normalize();
    const side = thumb.position.clone().normalize();
    const blade = side.addScaledVector(fingers, -side.dot(fingers)).normalize();
    knifeGrip.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), blade);
    knifeGrip.position.copy(fingers).multiplyScalar(middle.position.length() * .62);
  }
  const drop = { active: false, resting: false, taken: false, velocity: new T.Vector3(), spin: new T.Vector3() };

  // ---------- senses, voice, body
  const senses = createSenses({ collision, trees });
  const occlusion = (from, to) => 1 - senses.lineOfSight(from, to);
  const voice = createVoice({ audio, camera, sounds, occlusion });
  const pos = root.position;
  const limbPos = new Map();
  const bodyRig = createBody({
    root, model,
    onContact: (limb, at, gait) => {
      if (!root.visible) return;
      const p = at.clone();
      if (gait === 'climb') {
        if (limb.foot) voice.play(variant('kannibale-schritt', 6), p, { volume: .22, rate: 1.15 });
        else voice.play(variant('kannibale-ast', 4), p, { volume: .3, rate: mix(1.05, 1.25, rand()) });
        return;
      }
      if (gait === 'run') { voice.play(variant('kannibale-lauf', 6), p, { volume: .85, rate: mix(.95, 1.08, rand()) }); return; }
      // Sneaking: soft palms and feet in the needles; now and then a twig gives him away.
      const soft = limb.foot ? .32 : .2;
      voice.play(variant('kannibale-schritt', 6), p, { volume: soft * (state === 'approach' && noise > .5 ? 1.4 : 1), rate: limb.foot ? mix(.92, 1.05, rand()) : mix(1.12, 1.3, rand()) });
      if (rand() < .025) voice.play(variant('kannibale-knacken', 3), p, { volume: .5 });
    },
  });
  const rig = bodyRig.ctx;
  rig.trunkRadius = senses.trunkRadius;
  const variant = (base, count) => base + '-' + (1 + Math.floor(rand() * count));
  const headPos = out => head.getWorldPosition(out);

  // ---------- personality and memory
  const traits = { patience: .6, boldness: .45, curiosity: .55, hunger: .25 };
  const memory = {
    sightings: 0, lastSeenAt: null, lastSeenTime: -1e9, wounds: 0, lookRate: 0, lookArounds: 0, alert: .2,
    playerSpeed: 0, playerMode: 'still', tests: 0, testsNoticed: 0, unseenFor: 0, sidesUsed: [],
  };
  function newNight() {
    traits.patience = mix(.45, .85, rand()); traits.boldness = mix(.3, .55, rand());
    traits.curiosity = mix(.35, .85, rand()); traits.hunger = mix(.12, .3, rand());
    traits.crowns = rand() < .5 + traits.curiosity * .3;
    Object.assign(memory, { sightings: 0, lastSeenAt: null, lastSeenTime: -1e9, wounds: 0, lookRate: 0, lookArounds: 0, alert: .2, tests: 0, testsNoticed: 0, sidesUsed: [] });
  }
  newNight();
  const caution = () => 1 - traits.boldness;

  // ---------- state
  const tmp = new T.Vector3(), tmp2 = new T.Vector3(), eye = new T.Vector3(), fwd = new T.Vector3(), flatFwd = new T.Vector3();
  const target = new T.Vector3(), from = new T.Vector3(), to = new T.Vector3();
  const points = [new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3()];
  let state = 'away', stateTime = 0, now = 0, heading = 0, targetHeading = 0, health = 2, cooldown = 14, nightTime = 0;
  let seenMeter = 0, clarity = 0, inView = false, visible = 0, watching = false, distance = 99, bearingFromPlayer = 0;
  let hiddenNow = 0, catching = false, caught = false, catchTime = 0, noise = 0, approachingPlayer = 0;
  let need = 8, observed = 0, hideFor = 6, waitFor = 2, tree = null, nextTree = null, test = null, lastTest = -99;
  let breathAt = 0, perceiveAt = 0, plan = null, planTries = 0, jump = null, seenAtTime = 0, checkAt = 0, replanAt = 0;
  const badSpots = [];
  const stats = { freezes: 0, hops: 0, climbs: 0, covers: 0, breaks: [], strikes: 0, evades: 0, retreats: 0, tests: 0, despawnsInView: 0 };
  const log = [];
  const camQuat = new T.Quaternion(), lookMatrix = new T.Matrix4(), lookPoint = new T.Vector3();
  const fade = document.getElementById('fg-fade');
  let blind = false, frozen = false;

  function setState(next, why = '') {
    if (next !== state) { log.push([+now.toFixed(1), state, next, why, +distance.toFixed(1)]); if (log.length > 60) log.shift(); }
    state = next; stateTime = 0;
  }
  function show(value) {
    if (!value && root.visible && inView && visible > .2) stats.despawnsInView++;
    root.visible = value;
  }
  function faceAway() { targetHeading = Math.atan2(pos.x - player.pos.x, pos.z - player.pos.z); }
  function faceTo(x, z, instant = false) {
    targetHeading = Math.atan2(x - pos.x, z - pos.z);
    if (instant) heading = targetHeading;
  }

  // ---------- the player: where he looks, how he moves, how alert he is
  const player = { pos: new T.Vector3(), last: new T.Vector3(), vel: new T.Vector3(), yaw: 0, lastYaw: 0, sweep: 0, lookCooldown: 0 };
  function observePlayer(dt, p) {
    player.last.copy(player.pos); player.pos.set(p.x, p.y, p.z);
    if (dt > 0) player.vel.subVectors(player.pos, player.last).multiplyScalar(1 / dt);
    const speed = Math.hypot(player.vel.x, player.vel.z);
    memory.playerSpeed = mix(memory.playerSpeed, speed, 1 - Math.exp(-dt * 4));
    memory.playerMode = memory.playerSpeed > 4 ? 'run' : memory.playerSpeed > .6 ? 'walk' : 'still';
    noise = memory.playerMode === 'run' ? 1 : memory.playerMode === 'walk' ? .45 : .08;
    camera.getWorldDirection(fwd);
    flatFwd.set(fwd.x, 0, fwd.z).normalize();
    player.yaw = Math.atan2(flatFwd.x, flatFwd.z);
    // Look-arounds: >110 degrees of head turning within about a second.
    player.sweep = player.sweep * Math.exp(-dt / 1.1) + angleBetween(player.yaw, player.lastYaw);
    player.lastYaw = player.yaw;
    player.lookCooldown -= dt;
    if (player.sweep > 1.9 && player.lookCooldown <= 0) { memory.lookArounds++; player.lookCooldown = 2; player.sweep = 0; memory.lookRate += 1; }
    memory.lookRate *= Math.exp(-dt / 60);
    memory.alert = clamp(memory.alert + (Math.min(1, memory.lookRate / 6) - memory.alert) * dt * .05, 0, 1);
    distance = Math.hypot(pos.x - player.pos.x, pos.z - player.pos.z);
    bearingFromPlayer = Math.atan2(pos.x - player.pos.x, pos.z - player.pos.z);
    watching = angleBetween(bearingFromPlayer, player.yaw) < 1.2 && distance < 48;
    // > 0 when the player walks towards him (m/s)
    approachingPlayer = distance > .1 ? ((pos.x - player.pos.x) * player.vel.x + (pos.z - player.pos.z) * player.vel.z) / distance : 0;
  }
  const behind = () => angleBetween(bearingFromPlayer, player.yaw);   // 0 = in front, PI = right behind

  // ---------- what the player can see of him
  function perceive() {
    eye.copy(camera.position);
    head.getWorldPosition(points[0]); chestBone.getWorldPosition(points[1]); hipsBone.getWorldPosition(points[2]);
    shoulderL.getWorldPosition(points[3]); shoulderR.getWorldPosition(points[4]);
    const s = senses.sight(eye, fwd, points, 1);
    clarity = s.clarity; inView = s.inView; visible = s.visible;
    if (blind || !root.visible) clarity = 0, inView = false, visible = 0;
    hiddenNow = 1 - Math.max(...points.map(p => senses.lineOfSight(eye, p)));
  }

  // ---------- movement on the ground with swerving and unsticking
  const probe = new T.Vector3(), probeVel = new T.Vector3(), velocity = new T.Vector3(), anchor = new T.Vector3();
  let steerOffset = 0, steerTimer = 0, ghost = 0, stuckTime = 0;
  const offsets = [0, .45, -.45, .9, -.9, 1.35, -1.35, 1.8, -1.8];
  function walkTo(x, z, speed, dt) {
    const goal = Math.atan2(x - pos.x, z - pos.z);
    const left = Math.hypot(x - pos.x, z - pos.z);
    speed = Math.min(speed, left / Math.max(dt, 1e-3));
    steerTimer -= dt;
    if (steerTimer <= 0) {
      steerTimer = .3;
      let best = steerOffset, bestGain = -1;
      for (const o of offsets) {
        const h = goal + o;
        probe.copy(pos);
        probeVel.set(Math.sin(h) * 2.5, 0, Math.cos(h) * 2.5);
        collision.move(probe, probeVel, .35, true);
        const moved = Math.hypot(probe.x - pos.x, probe.z - pos.z);
        const climb = altitude(probe.x, probe.z) - pos.y;
        const gain = moved * Math.cos(o) - Math.max(0, climb - moved * .9) * 2 - Math.abs(o - steerOffset) * .05;
        if (gain > bestGain) { bestGain = gain; best = o; }
        if (o === 0 && moved > .6) break;
      }
      steerOffset = best;
    }
    targetHeading = goal + steerOffset;
    velocity.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
    if (ghost > 0) { ghost -= dt; pos.addScaledVector(velocity, dt); }
    else collision.move(pos, velocity, dt, true);
    pos.y = altitude(pos.x, pos.z);
    stuckTime += dt;
    if (stuckTime > .5) {
      if (speed > .3 && Math.hypot(pos.x - anchor.x, pos.z - anchor.z) < speed * stuckTime * .2) { ghost = .6; steerTimer = 0; }
      anchor.copy(pos); stuckTime = 0;
    }
    rig.mode = 'ground';
    rig.gait = speed > 3 ? 'run' : 'stalk';
    rig.speed = speed;
    return left < .35;
  }
  function crouch(gait = 'perch') { rig.mode = 'ground'; rig.gait = gait; rig.speed = 0; }

  // ---------- cover planning
  function sideOf(x, z) { return Math.atan2(x - player.pos.x, z - player.pos.z); }
  function planCover(kind) {
    eye.copy(camera.position);
    const ppos = player.pos, R = distance;
    let centre, reach, score, need = .85, towards = false;
    if (kind === 'evade') {
      // Nearest place out of sight, never towards the player, never across his view.
      centre = pos; reach = 9;
      score = c => {
        const travel = Math.hypot(c.x - pos.x, c.z - pos.z);
        const d = Math.hypot(c.x - ppos.x, c.z - ppos.z);
        return travel + (d < R - 1 ? 8 : 0) + (angleBetween(sideOf(c.x, c.z), player.yaw) < .5 ? 4 : 0);
      };
    } else if (kind === 'retreat') {
      centre = tmp.set(pos.x + (pos.x - ppos.x) / Math.max(R, 1) * 7, 0, pos.z + (pos.z - ppos.z) / Math.max(R, 1) * 7).clone(); reach = 8;
      score = c => { const d = Math.hypot(c.x - ppos.x, c.z - ppos.z); return Math.abs(d - mix(18, 26, caution())) + Math.hypot(c.x - pos.x, c.z - pos.z) * .3; };
    } else if (kind === 'vantage') {
      // A new side: at least 80 degrees round from where he was last seen.
      const avoid = memory.lastSeenAt ? sideOf(memory.lastSeenAt.x, memory.lastSeenAt.z) : bearingFromPlayer;
      const dirSign = rand() < .5 ? 1 : -1;
      const b = avoid + dirSign * mix(1.4, 2.4, rand());
      const r = mix(26, 42, caution()) * (1 - traits.hunger * .2);
      centre = new T.Vector3(ppos.x + Math.sin(b) * r, 0, ppos.z + Math.cos(b) * r); reach = 9;
      score = c => {
        const d = Math.hypot(c.x - ppos.x, c.z - ppos.z);
        const seenSide = memory.lastSeenAt ? Math.hypot(c.x - memory.lastSeenAt.x, c.z - memory.lastSeenAt.z) : 99;
        return Math.abs(d - r) + (seenSide < 10 ? 15 : 0) + (angleBetween(sideOf(c.x, c.z), player.yaw) < .9 ? 6 : 0);
      };
      need = .62; towards = true;
    } else {
      // Next cover towards the strike point behind the player.
      const sx = ppos.x - flatFwd.x * 2.4, sz = ppos.z - flatFwd.z * 2.4;
      const toS = Math.hypot(sx - pos.x, sz - pos.z);
      const step = Math.min(toS, mix(5, 11, traits.boldness) * (1 + noise * .4) * (1 + traits.hunger * .3));
      centre = new T.Vector3(pos.x + (sx - pos.x) / Math.max(toS, .1) * step, 0, pos.z + (sz - pos.z) / Math.max(toS, .1) * step); reach = 7;
      score = c => {
        const toStrike = Math.hypot(c.x - sx, c.z - sz);
        const d = Math.hypot(c.x - ppos.x, c.z - ppos.z);
        const inCone = angleBetween(sideOf(c.x, c.z), player.yaw) < 1.0 && d < 32;
        const seenSide = memory.lastSeenAt && now - memory.lastSeenTime < 90 ? Math.hypot(c.x - memory.lastSeenAt.x, c.z - memory.lastSeenAt.z) : 99;
        return toStrike + (inCone ? 20 : 0) + (seenSide < 6 ? 6 : 0) + (d < 3.2 ? 30 : 0);
      };
      need = .8;
    }
    const found = senses.findCover({ eye, from: pos, centre, reach, score, need, towards, avoid: badSpots });
    // Open ground only when the player clearly looks the other way (approach) - never to hide.
    if (found && found.hidden < need * .6 && !(kind === 'approach' && behind() > 2.2)) return null;
    if (found) stats.covers++;
    return found;
  }

  // ---------- trees: climbing, crowns, leaps
  const perchHeight = t => clamp(t.height * .27, 3.6, 7.4);
  function treeNear(x, z, reach) {
    let best = null, bd = reach;
    senses.near(x, z, reach, (t, d) => { if (d < bd) { bd = d; best = t; } });
    return best;
  }
  function startClimb(t) {
    tree = t; stats.climbs++;
    rig.tree = t; rig.mode = 'climb';
    rig.climbAngle = Math.atan2(pos.x - t.x, pos.z - t.z);
    rig.climbHeight = Math.max(0, pos.y - t.y);
    setState('climb', 'to the crown');
  }
  function placeOnTrunk(t, angle, height) {
    const r = senses.trunkRadius(t, height) + .4;
    pos.set(t.x + Math.sin(angle) * r, t.y + height, t.z + Math.cos(angle) * r);
    heading = targetHeading = angle + Math.PI;
  }
  function crownSpot(t, towards, out) {
    const h = perchHeight(t), r = senses.trunkRadius(t, h) + .45;
    const a = Math.atan2(towards.x - t.x, towards.z - t.z);
    return out.set(t.x + Math.sin(a) * r, t.y + h, t.z + Math.cos(a) * r);
  }
  // Ballistic jump with a wind-up crouch and a landing that gives at the knees.
  function startJump(dest, kind, nextT = null) {
    const d = Math.hypot(dest.x - pos.x, dest.z - pos.z);
    const T = clamp(.36 + d * .055 + Math.max(0, dest.y - pos.y) * .04, .45, 1.15);
    const g = 9.81;
    jump = { kind, from: pos.clone(), to: dest.clone(), T, vy: (dest.y - pos.y + .5 * g * T * T) / T, t: 0, phase: 'windup', windup: kind === 'pounce' ? .16 : .24, nextTree: nextT };
    faceTo(dest.x, dest.z);
    rig.mode = 'air'; rig.jump = { phase: 'windup', s: 0 };
    if (tree) voice.play(variant('kannibale-ast', 4), pos.clone(), { volume: .55 });
    setState('jump', kind);
  }
  function updateJump(dt) {
    const j = jump;
    j.t += dt;
    if (j.phase === 'windup') {
      rig.jump = { phase: 'windup', s: clamp(j.t / j.windup, 0, 1) };
      if (j.t >= j.windup) { j.phase = 'flight'; j.t = 0; if (j.kind !== 'pounce') voice.play(variant('kannibale-ast', 4), pos.clone(), { volume: .7 }); }
      return;
    }
    if (j.phase === 'flight') {
      const s = clamp(j.t / j.T, 0, 1), t = s * j.T;
      pos.x = mix(j.from.x, j.to.x, s); pos.z = mix(j.from.z, j.to.z, s);
      pos.y = j.from.y + j.vy * t - .5 * 9.81 * t * t;
      rig.jump = { phase: 'flight', s };
      if (s >= 1) {
        pos.copy(j.to);
        j.phase = 'land'; j.t = 0;
        bodyRig.land(clamp(Math.abs(j.vy - 9.81 * j.T) / 6, .5, 1.4));
        voice.play('kannibale-landung-1', pos.clone(), { volume: j.kind === 'leap' ? .55 : .9 });
        voice.play(variant('kannibale-ast', 4), pos.clone(), { volume: j.kind === 'leap' ? .9 : .4 });
        if (rand() < .4) voice.play(variant('kannibale-knacken', 3), pos.clone(), { volume: .6 });
      }
      return;
    }
    rig.jump = { phase: 'land', s: clamp(j.t / .32, 0, 1) };
    if (j.t >= .32) {
      const kind = j.kind;
      jump = null;
      if (kind === 'leap') { tree = j.nextTree; rig.tree = tree; stats.hops++; setState('crown', 'landed'); }
      else if (kind === 'pounce') { tree = null; if (Math.hypot(pos.x - player.pos.x, pos.z - player.pos.z) < 3.2) startCatch(); else setState('approach', 'missed pounce'); }
      else { tree = null; setState(j.after ?? 'approach', 'down'); }
    }
  }

  // ---------- spawning: he arrives somewhere out of sight
  function spawn() {
    memory.lastSeenAt = null;
    const found = planCover('vantage');
    if (!found || found.hidden < .7) return false;
    pos.set(found.x, found.y, found.z);
    faceTo(player.pos.x, player.pos.z, true);
    health = 2; seenMeter = 0; tree = null;
    show(true); knifeGrip.visible = true;
    beginObserve('arrived');
    return true;
  }
  function beginObserve(why) {
    observed = 0;
    need = (4 + 12 * traits.patience) * (1 + caution() * .7) * (1 + memory.alert * .6) * (1.25 - traits.hunger * .6);
    setState('observe', why);
  }

  // ---------- being seen: break the line of sight, never vanish
  function onSeen() {
    const fresh = now - memory.lastSeenTime > 4;
    if (fresh) {
      memory.sightings++;
      traits.boldness = clamp(traits.boldness - .16 * (1 + Math.min(2, memory.sightings) * .25), .05, .95);
    }
    memory.lastSeenAt = pos.clone(); memory.lastSeenTime = now;
    seenMeter = 0; seenAtTime = now; stats.evades++;
    voice.play(pick(['kannibale-knurren-2', 'kannibale-atem-2']), headPos(new T.Vector3()), { volume: .7, rate: 1.1 });
    if (state === 'strike' && (traits.boldness > .7 || distance < 3)) return;   // committed
    // Seen again and again: too risky tonight for a while. He leaves (out of sight) and comes back later.
    if (fresh && memory.sightings % 5 === 0) { cooldown = mix(90, 150, rand()); setState('withdraw', 'too risky'); return; }
    if (tree && (state === 'crown' || state === 'climb')) {
      // Up into the crown, or to the next crown away from the player.
      const next = bestCrown(true);
      if (next) { startJump(crownSpot(next, player.pos, new T.Vector3()), 'leap', next); return; }
      const t = tree;
      const away = Math.atan2(pos.x - player.pos.x, pos.z - player.pos.z) + Math.PI;
      tmp.set(t.x + Math.sin(away) * 2.6, 0, t.z + Math.cos(away) * 2.6); tmp.y = altitude(tmp.x, tmp.z);
      startJump(tmp.clone(), 'drop'); jump.after = 'evade';
      return;
    }
    plan = planCover('evade');
    setState('evade', 'seen');
  }

  function bestCrown(away) {
    if (!tree) return null;
    const sx = player.pos.x - flatFwd.x * 3, sz = player.pos.z - flatFwd.z * 3;
    let best = null, bestScore = Infinity;
    senses.near(pos.x, pos.z, 8.6, (t, d) => {
      if (t === tree || d < 2.8) return;
      const spot = crownSpot(t, player.pos, tmp2);
      const toPlayer = Math.hypot(spot.x - player.pos.x, spot.z - player.pos.z);
      let score = away ? -toPlayer : Math.hypot(spot.x - sx, spot.z - sz);
      if (!away && angleBetween(sideOf(spot.x, spot.z), player.yaw) < 1.0 && toPlayer < 30) score += 25;
      if (!away && toPlayer < 4) score += 15;
      if (score < bestScore) { bestScore = score; best = t; }
    });
    if (!best) return null;
    if (!away) {
      const here = Math.hypot(pos.x - sx, pos.z - sz);
      if (bestScore > here - 1.5) return null;
    }
    return best;
  }

  // Cornered: the player is on top of him. Bold or hungry -> he attacks out of cover,
  // otherwise he bolts and keeps his distance.
  function cornered(canRetreat = true) {
    if (distance > 2.6) return false;
    if (traits.boldness > .5 || traits.hunger > .7) { stats.strikes++; startCatch(); return true; }
    if (!canRetreat) return false;
    plan = planCover('retreat'); stats.retreats++;
    setState('retreat', 'cornered');
    return true;
  }

  // ---------- testing the player: a twig snaps off to the side
  function startTest() {
    const side = bearingFromPlayer + (rand() < .5 ? 1 : -1) * mix(1.1, 1.8, rand());
    const r = mix(8, 12, rand());
    const at = new T.Vector3(player.pos.x + Math.sin(side) * r, 0, player.pos.z + Math.cos(side) * r);
    at.y = altitude(at.x, at.z) + .3;
    voice.play(variant('kannibale-knacken', 3), at, { volume: 1 });
    test = { at, startYaw: player.yaw, dir: Math.atan2(at.x - player.pos.x, at.z - player.pos.z), t: 0 };
    lastTest = now; memory.tests++; stats.tests++;
  }
  function updateTest(dt) {
    if (!test) return;
    test.t += dt;
    const facing = angleBetween(player.yaw, test.dir) < .55;
    const turned = angleBetween(player.yaw, test.startYaw) > 1.0;
    if (facing || turned) {
      memory.testsNoticed++; memory.alert = clamp(memory.alert + .25, 0, 1);
      traits.boldness = clamp(traits.boldness - .05, .05, .95); need += 4;
      test.result = 'noticed'; test = null;
    } else if (test.t > 2.2) {
      memory.alert = clamp(memory.alert - .1, 0, 1); traits.boldness = clamp(traits.boldness + .07, .05, .95);
      test.result = 'ignored'; test = null;
    }
  }

  // ---------- breathing, growls, whispers
  function breathe() {
    if (now < breathAt || distance > 16 || !root.visible) return;
    const quiet = state === 'hide' || state === 'wait' && caution() > .6;
    if (quiet) { breathAt = now + 2; return; }
    const fast = state === 'strike' || state === 'rage' || state === 'evade';
    voice.play(variant('kannibale-atem', 4), headPos, { volume: fast ? .75 : .45, rate: fast ? 1.15 : mix(.9, 1, rand()) });
    breathAt = now + (fast ? mix(.7, 1.1, rand()) : mix(2.8, 4.6, rand()));
    if (state === 'observe' && traits.boldness > .65 && distance < 15 && rand() < .15)
      voice.play('kannibale-fluestern-1', headPos, { volume: .5 });
  }

  // ---------- the jumpscare
  function startCatch() {
    setState('catch', 'got him');
    catching = true; caught = false; catchTime = 0;
    show(true);
    rig.mode = 'still'; rig.gait = 'scream';
    voice.play('kannibale-jumpscare', null, { volume: 1.6, direct: true });
    voice.play('kannibale-knurren-1', null, { volume: .9, direct: true, rate: .92 });
    camQuat.copy(camera.quaternion);
  }

  // ---------- sword hits (ray against an upright capsule around the body)
  const headWorld = new T.Vector3();
  function strike(origin, dir, reach) {
    if (!root.visible || state === 'dead' || state === 'away' || catching) return null;
    head.getWorldPosition(headWorld);
    const top = Math.max(headWorld.y + .15, pos.y + .6), bottom = pos.y, radius = .42;
    const ox = origin.x - pos.x, oz = origin.z - pos.z;
    const a = dir.x * dir.x + dir.z * dir.z, b = ox * dir.x + oz * dir.z, c = ox * ox + oz * oz - radius * radius;
    const disc = b * b - a * c;
    if (a < 1e-5 || disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t < 0 || t > reach) return null;
    const y = origin.y + dir.y * t;
    if (y < bottom || y > top) return null;
    return { distance: t, hit: () => wound(origin) };
  }
  function wound(origin) {
    health--; memory.wounds++;
    if (health <= 0) { die(origin); return; }
    voice.play('kannibale-tod-kurz', headPos, { volume: 1.1, rate: 1.1 });
    jump = null; tree = null;
    // Rage or retreat, depending on who he is tonight.
    if (traits.boldness * .6 + traits.hunger * .4 + rand() * .25 > .62) {
      voice.play('kannibale-knurren-1', headPos, { volume: 1.2, rate: .95 });
      setState('rage', 'wounded');
    } else {
      traits.boldness = clamp(traits.boldness - .25, .05, .95);
      setState('withdraw', 'wounded');
      cooldown = mix(60, 100, rand());
    }
  }
  function die(origin) {
    setState('dead', 'killed');
    faceTo(origin.x, origin.z, true);
    rig.mode = 'still'; rig.gait = 'death';
    if (pos.y > altitude(pos.x, pos.z) + .2) pos.y = altitude(pos.x, pos.z);
    voice.play('kannibale-tod', headPos, { volume: 1.3, ref: 3 });
    knife.updateWorldMatrix(true, false);
    knife.matrixWorld.decompose(knife.position, knife.quaternion, knife.scale);
    knifeGrip.remove(knife);
    scene.add(knife);
    drop.active = true; drop.resting = false;
    drop.velocity.set((rand() - .5) * 1.6, 1.6, (rand() - .5) * 1.6);
    drop.spin.set(rand() * 9 - 4.5, rand() * 6 - 3, rand() * 9 - 4.5);
  }
  function updateDrop(dt) {
    if (!drop.active || drop.resting) return;
    drop.velocity.y -= 9.81 * dt;
    knife.position.addScaledVector(drop.velocity, dt);
    knife.rotation.x += drop.spin.x * dt; knife.rotation.y += drop.spin.y * dt; knife.rotation.z += drop.spin.z * dt;
    const floor = collision.floorAt(knife.position.x, knife.position.z, knife.position.y + .2) + .035;
    if (knife.position.y <= floor) {
      knife.position.y = floor;
      if (Math.abs(drop.velocity.y) > 1.2) {
        voice.play('knochendolch-fallen', knife.position.clone(), { volume: 1.2 });
        drop.velocity.set(drop.velocity.x * .35, -drop.velocity.y * .28, drop.velocity.z * .35);
        drop.spin.multiplyScalar(.4);
      } else {
        drop.resting = true;
        knife.rotation.set(Math.PI / 2 * Math.sign(knife.rotation.x || 1), knife.rotation.y, 0);
      }
    }
  }

  // ---------- the hunt
  function think(dt) {
    const night = isNight();
    // Mood over the night.
    traits.hunger = clamp(traits.hunger + dt / 480, 0, 1);
    // Unseen for long, he grows bolder, but every sighting tonight lowers the ceiling.
    const ceiling = clamp(.95 - memory.sightings * .12 - memory.wounds * .15, .3, .95);
    if (!inView && root.visible && memory.unseenFor > 8) traits.boldness = Math.min(ceiling, traits.boldness + dt * .0045);
    // Seen?
    if (!['catch', 'dead', 'withdraw', 'jump'].includes(state)) {
      // While he is already breaking the line of sight the meter rests; a new sighting
      // counts only once he has settled somewhere.
      if (state === 'evade') seenMeter = 0;
      else if (clarity > .35) seenMeter += dt * clarity * 3.2;
      else seenMeter = Math.max(0, seenMeter - dt * 1.2);
      if (seenMeter > .5) onSeen();
    }
    memory.unseenFor = inView ? 0 : memory.unseenFor + dt;
    if (!night && !['withdraw', 'dead', 'catch', 'away'].includes(state)) setState('withdraw', 'dawn');

    switch (state) {
      case 'observe': {
        // Watches from cover: still, staring, breathing slowly.
        faceTo(player.pos.x, player.pos.z);
        crouch('perch');
        rig.lookWeight = 1;
        observed += dt * (memory.playerMode === 'still' ? 1.1 : 1);
        updateTest(dt);
        if (!test && distance > 13 && now - lastTest > 22 && rand() < dt * traits.curiosity * .08) startTest();
        // Tree hunter: watches from a crown when a climbable trunk is at hand.
        if (traits.crowns && !tree && stateTime > 1.5 && !watching) {
          const t = treeNear(pos.x, pos.z, 2.6);
          if (t) { faceTo(t.x, t.z); startClimb(t); break; }
        }
        if (observed >= need && !watching && !test) { plan = null; setState('approach', 'patience spent'); }
        break;
      }
      case 'climb': {
        // Procedural climb: the root rises, limbs hold the bark.
        const t = tree;
        const top = perchHeight(t);
        const speed = watching ? .35 : mix(.7, 1.1, traits.boldness);
        rig.mode = 'climb'; rig.speed = speed;
        rig.climbHeight = Math.min(top, rig.climbHeight + speed * dt);
        placeOnTrunk(t, rig.climbAngle, rig.climbHeight);
        rig.lookWeight = .3;
        if (rig.climbHeight >= top - .01) {
          crownSpot(t, player.pos, pos);
          setState('crown', 'perched');
        }
        break;
      }
      case 'crown': {
        // Perched in the needles: the crown hides him beyond a few metres.
        faceTo(player.pos.x, player.pos.z);
        rig.mode = 'ground'; rig.gait = 'perch'; rig.speed = 0;
        rig.lookWeight = 1;
        observed += dt;
        updateTest(dt);
        if (stateTime < mix(.8, 2.5, caution())) break;
        if (watching && inView) break;
        const flat = distance;
        if (flat < 7.5 && behind() > 1.9 && memory.unseenFor > 1 && observed > need * .5) {
          tmp.set(pos.x - player.pos.x, 0, pos.z - player.pos.z).normalize();
          const at = new T.Vector3(player.pos.x + tmp.x * .8, player.pos.y, player.pos.z + tmp.z * .8);
          stats.strikes++;
          startJump(at, 'pounce');
          break;
        }
        const next = bestCrown(false);
        if (next) { startJump(crownSpot(next, player.pos, new T.Vector3()), 'leap', next); break; }
        if (stateTime > 4 && !watching) {
          // Down on the far side of the trunk and on with the stalk.
          const away = Math.atan2(player.pos.x - tree.x, player.pos.z - tree.z) + Math.PI * mix(.7, 1.3, rand());
          tmp.set(tree.x + Math.sin(away) * 2.2, 0, tree.z + Math.cos(away) * 2.2); tmp.y = altitude(tmp.x, tmp.z);
          startJump(tmp.clone(), 'drop'); jump.after = 'approach';
        }
        break;
      }
      case 'approach': {
        updateTest(dt);
        // Strike from behind when close, unseen and out of patience.
        if (distance < 6.5 && behind() > 1.95 && memory.unseenFor > 1 && !watching) {
          stats.strikes++;
          voice.play('kannibale-knurren-3', headPos, { volume: .5, rate: .9 });
          setState('strike', 'behind him');
          break;
        }
        if (!plan && now >= replanAt) {
          plan = planCover('approach');
          if (!plan && behind() > 1.9) {
            // No cover on the way: creep a few metres over open ground while his back is turned.
            const sx = player.pos.x - flatFwd.x * 2.4, sz = player.pos.z - flatFwd.z * 2.4;
            const d = Math.hypot(sx - pos.x, sz - pos.z), step = Math.min(d, mix(3, 6, traits.boldness));
            plan = { x: pos.x + (sx - pos.x) / Math.max(d, .1) * step, z: pos.z + (sz - pos.z) / Math.max(d, .1) * step, hidden: 0, open: true };
          }
          if (!plan) replanAt = now + mix(.8, 2, rand());
        }
        if (!plan) { crouch(); rig.lookWeight = 1; faceTo(player.pos.x, player.pos.z); break; }
        // Moves only while the player looks elsewhere; his noise covers faster moves.
        const masked = noise >= .45;
        if (watching && !masked) {
          if (inView) stats.freezes += rig.speed > 0 ? 1 : 0;
          crouch(rig.gait === 'stalk' ? 'stalk' : 'perch');
          rig.lookWeight = 1;
          break;
        }
        const gap = Math.hypot(plan.x - pos.x, plan.z - pos.z);
        const dash = !plan.open && gap > 5 && behind() > 1.9 && distance > 12;
        const speed = (dash ? 4.2 : mix(1.1, 1.7, traits.boldness)) * (masked ? 1.5 : 1) * (1 + traits.hunger * .25);
        rig.lookWeight = .55;
        if (walkTo(plan.x, plan.z, speed, dt)) {
          waitFor = mix(.8, 4.5, caution()) * (1 + memory.alert * .8) * (1.2 - traits.hunger * .5);
          plan = null;
          setState('wait', 'at cover');
        }
        break;
      }
      case 'wait': {
        faceAway();
        crouch('perch');
        rig.lookWeight = 0;
        updateTest(dt);
        if (approachingPlayer > .8 && distance < 15) { plan = planCover('retreat'); stats.retreats++; setState('retreat', 'player comes'); break; }
        if (stateTime > waitFor) setState('approach', 'next cover');
        break;
      }
      case 'strike': {
        rig.lookWeight = .6;
        const speed = 5.6 + traits.hunger;
        walkTo(player.pos.x, player.pos.z, speed, dt);
        if (distance < 1.7) { startCatch(); break; }
        if (stateTime > 4.5) { plan = null; setState('approach', 'strike failed'); }
        break;
      }
      case 'rage': {
        rig.lookWeight = .6;
        walkTo(player.pos.x, player.pos.z, 6.2, dt);
        if (distance < 1.7) startCatch();
        break;
      }
      case 'evade': {
        if (cornered()) break;
        if (!plan) plan = planCover(distance < 9 || approachingPlayer > .8 ? 'retreat' : 'evade');
        if (!plan) { walkTo(pos.x + Math.sin(bearingFromPlayer + 1.3) * 6, pos.z + Math.cos(bearingFromPlayer + 1.3) * 6, 4.5, dt); if (hiddenNow > .8) setState('hide', 'out of sight'); break; }
        const gap = Math.hypot(plan.x - pos.x, plan.z - pos.z);
        rig.lookWeight = .2;
        const arrived = walkTo(plan.x, plan.z, gap > 2.5 ? 5.2 : 2.6, dt);
        if (arrived) faceAway();
        if (arrived && hiddenNow < .8 && checkAt === 0) checkAt = now + .7;
        if (checkAt && now > checkAt && hiddenNow < .8) { checkAt = 0; badSpots.push(new T.Vector3(plan.x, 0, plan.z)); if (badSpots.length > 8) badSpots.shift(); plan = planCover('evade'); break; }
        if (hiddenNow > .85 && (arrived || gap < 1.2)) {
          checkAt = 0;
          stats.breaks.push({ t: +(now - seenAtTime).toFixed(2), hidden: +hiddenNow.toFixed(2), cover: plan.cover?.kind ?? 'ground' });
          if (stats.breaks.length > 20) stats.breaks.shift();
          hideFor = mix(4, 12, caution()) * (1 + memory.alert * .5);
          plan = null;
          setState('hide', 'line broken');
        }
        if (stateTime > 4) { plan = null; stateTime = 0; }
        break;
      }
      case 'hide': {
        if (cornered()) break;
        faceAway();
        crouch('perch');
        rig.lookWeight = 0;
        // Still visible after all? This spot is no good: find another.
        if (stateTime > .35 && stateTime < 2 && hiddenNow < .75 && inView) { badSpots.push(pos.clone()); if (badSpots.length > 8) badSpots.shift(); plan = planCover('evade'); setState('evade', 'spot exposed'); break; }
        if (approachingPlayer > .8 && distance < 16) { plan = planCover('retreat'); stats.retreats++; setState('retreat', 'player comes'); break; }
        if (stateTime > hideFor && !watching) { plan = planCover('vantage'); setState('reposition', 'other side'); }
        break;
      }
      case 'retreat': {
        if (cornered(false)) break;
        if (!plan) plan = planCover('retreat');
        if (!plan) { setState('hide', 'nowhere better'); break; }
        rig.lookWeight = .4;
        if (walkTo(plan.x, plan.z, distance < 10 ? 4.9 : 3.4, dt)) { plan = null; hideFor = mix(3, 7, caution()); setState('hide', 'backed off'); }
        if (stateTime > 6) plan = null;
        break;
      }
      case 'reposition': {
        if (!plan) { plan = planCover('vantage'); if (!plan) { setState('hide', 'no vantage'); hideFor = 3; break; } }
        if (watching && inView) { crouch('stalk'); break; }
        rig.lookWeight = .3;
        const speed = distance > 20 && behind() > 1.6 ? 4 : 1.8;
        if (walkTo(plan.x, plan.z, speed, dt)) { plan = null; beginObserve('new side'); }
        if (stateTime > 25) { plan = null; beginObserve('gave up moving'); }
        break;
      }
      case 'withdraw': {
        // Leaves the area out of sight; disappears only where nobody can see him.
        const away = bearingFromPlayer;
        walkTo(pos.x + Math.sin(away) * 8, pos.z + Math.cos(away) * 8, distance < 15 ? 5 : 3.5, dt);
        if (distance > 32 && !inView && visible < .2 || distance > 70) {
          show(false); setState('away', 'gone');
          if (cooldown < 10) cooldown = mix(16, 32, rand());
        }
        break;
      }
      case 'jump': updateJump(dt); break;
    }
  }

  // ---------- main update
  function update(dt, p, active) {
    now += dt;
    voice.update(dt, now);
    if (!active && !(catching && !caught)) return;
    if (frozen) { root.updateMatrixWorld(true); return; }
    observePlayer(dt, p);
    const night = isNight();
    nightTime = night ? nightTime + dt : 0;
    if (drop.active) updateDrop(dt);
    if (state === 'away') {
      if (!night || nightTime < 9) return;
      cooldown -= dt;
      if (cooldown <= 0 && !spawn()) cooldown = 2;
      return;
    }
    if (state === 'dead') {
      bodyRig.update(dt);
      if (!night) { show(false); scene.remove(knife); drop.active = drop.resting = drop.taken = false; setState('away'); knifeGrip.add(knife); knife.position.set(0, 0, 0); knife.rotation.set(0, 0, 0); newNight(); reset(); }
      return;
    }
    stateTime += dt;
    if (now >= perceiveAt) { perceiveAt = now + .066; perceive(); }
    if (state === 'catch') catchTime += dt;
    else think(dt);
    breathe();
    // Smooth turning and the body.
    const delta = ((targetHeading - heading + Math.PI) % TAU + TAU) % TAU - Math.PI;
    heading += delta * (1 - Math.exp(-dt * (rig.speed > 3 ? 12 : 6)));
    root.rotation.set(0, heading, 0);
    rig.look = lookPoint.copy(camera.position);
    bodyRig.update(dt);
  }

  // Called after the player has moved the camera: the jumpscare takes over the view.
  function frame(dt) {
    if (state !== 'catch' || frozen) return;
    closeupFill.value = .42 * T.MathUtils.smoothstep(catchTime, 0, .21) * (1 - T.MathUtils.smoothstep(catchTime, 1.11, 1.52));
    const eyePos = camera.position;
    if (catchTime < dt * 1.5) {
      tmp.set(pos.x - eyePos.x, 0, pos.z - eyePos.z);
      if (tmp.lengthSq() < .01) camera.getWorldDirection(tmp).setY(0);
      from.copy(tmp.normalize());
    }
    root.updateMatrixWorld(true);
    head.getWorldPosition(headWorld);
    const want = tmp.copy(eyePos).addScaledVector(from, .78);
    want.y = eyePos.y - .06;
    pos.add(to.subVectors(want, headWorld));
    faceTo(eyePos.x, eyePos.z, true);
    root.rotation.set(0, heading, 0);
    root.updateMatrixWorld(true);
    head.getWorldPosition(headWorld);
    const shake = Math.max(0, 1 - catchTime / 1.4) * .035;
    lookMatrix.lookAt(eyePos, tmp.copy(headWorld).add(tmp2.set((rand() - .5) * shake, (rand() - .5) * shake, 0)), up);
    camQuat.slerp(new T.Quaternion().setFromRotationMatrix(lookMatrix), 1 - Math.exp(-dt * 22));
    camera.quaternion.copy(camQuat);
    camera.updateMatrixWorld();
    if (fade) fade.style.opacity = String(clamp((catchTime - 1.25) / .35, 0, 1));
    if (catchTime > 1.75 && !caught) { caught = true; onCatch(); }
  }

  function reset() {
    catching = false; caught = false;
    closeupFill.value = 0;
    if (fade) fade.style.opacity = '0';
    if (state === 'catch') { show(false); setState('away', 'reset'); }
    cooldown = 22;
  }

  function take(p) {
    if (!drop.resting || drop.taken) return false;
    if (Math.hypot(knife.position.x - p.x, knife.position.z - p.z) > 2) return false;
    drop.taken = true; drop.active = false;
    scene.remove(knife);
    return true;
  }

  // Test hooks (?dev).
  function placeAt(x, z) { show(true); pos.set(x, altitude(x, z), z); tree = null; jump = null; plan = null; health = 2; knifeGrip.visible = true; }
  return {
    update, frame, strike, take, reset,
    get catching() { return catching; },
    get canTake() { return drop.resting && !drop.taken; },
    knife, knifeGrip, root, actions: bodyRig.actions, senses, voice, body: bodyRig,
    state: () => ({
      state, stateTime: +stateTime.toFixed(2), visible: root.visible, x: pos.x, y: pos.y, z: pos.z, distance,
      clarity: +clarity.toFixed(2), inView, seen: +seenMeter.toFixed(2), hidden: +hiddenNow.toFixed(2), watching,
      behind: +behind().toFixed(2), health, tree: tree ? { x: tree.x, z: tree.z, height: tree.height } : null,
      traits: Object.fromEntries(Object.entries(traits).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v])),
      memory: { ...memory, lastSeenAt: memory.lastSeenAt && [+memory.lastSeenAt.x.toFixed(1), +memory.lastSeenAt.z.toFixed(1)], lookRate: +memory.lookRate.toFixed(2), alert: +memory.alert.toFixed(2), playerSpeed: +memory.playerSpeed.toFixed(2), unseenFor: +memory.unseenFor.toFixed(1) },
      need: +need.toFixed(1), observed: +observed.toFixed(1), plan: plan && { x: +plan.x.toFixed(1), z: +plan.z.toFixed(1), hidden: +(plan.hidden ?? 0).toFixed(2), cover: plan.cover?.kind ?? 'ground' },
      stats: { ...stats, breaks: stats.breaks.slice(-6) }, log: log.slice(-14),
      gait: rig.mode + '/' + rig.gait, speed: +rig.speed.toFixed(2), hip: +bodyRig.hipOffset.toFixed(3), contacts: bodyRig.contacts.count,
      dagger: drop.taken ? 'taken' : drop.resting ? 'ground' : drop.active ? 'falling' : 'hand',
      daggerPos: drop.active ? { x: knife.position.x, y: knife.position.y, z: knife.position.z } : null,
      sounds: voice.decoded, played: voice.count, recent: voice.recent.slice(-8), playing: voice.playing, audio: audio.context?.state ?? 'none',
    }),
    debug: {
      spawn(p) { if (p) observePlayer(0, p); nightTime = 99; cooldown = 0; setState('away'); return spawn(); },
      groundAt(x, z, p) { if (p) observePlayer(0, p); placeAt(x, z); beginObserve('test'); },
      observeAt(x, z, p) { if (p) observePlayer(0, p); placeAt(x, z); beginObserve('test'); },
      approachFrom(x, z, p) { if (p) observePlayer(0, p); placeAt(x, z); observed = 99; setState('approach', 'test'); },
      perchAt(x, z, p) { if (p) observePlayer(0, p); const t = treeNear(x, z, 15); if (!t) return false; placeAt(t.x, t.z); crownSpot(t, player.pos, pos); tree = t; rig.tree = t; setState('crown', 'test'); return true; },
      climbAt(x, z, p) { if (p) observePlayer(0, p); const t = treeNear(x, z, 15); if (!t) return false; const a = Math.atan2(player.pos.x - t.x, player.pos.z - t.z); placeAt(t.x, t.z); rig.climbAngle = a; rig.climbHeight = 0; placeOnTrunk(t, a, 0); startClimb(t); rig.climbAngle = a; return true; },
      hop(p) { if (p) observePlayer(0, p); const n = bestCrown(false) ?? bestCrown(true); if (!n) return false; startJump(crownSpot(n, player.pos, new T.Vector3()), 'leap', n); return true; },
      catch() { startCatch(); },
      kill(origin) { health = 1; wound(origin); },
      hurt(origin) { wound(origin); },
      flee() { onSeen(); },
      seen() { onSeen(); },
      test() { startTest(); return test; },
      traits(values) { Object.assign(traits, values); return { ...traits }; },
      blind(value) { blind = value; },
      freeze(value) { frozen = value; },
      set(next) { setState(next, 'test'); },
      measure: name => voice.measure(name),
      reset() { reset(); show(false); setState('away', 'test reset'); newNight(); stats.breaks.length = 0; stats.despawnsInView = 0; },
      bodyInfo() { const f = bodyRig.feet; return { analysis: bodyRig.analysis, leap: bodyRig.leap, contacts: bodyRig.contacts.count, plantedSamples: f.samples, meanPlantError: f.samples ? +(f.err / f.samples).toFixed(4) : 0, maxPlantError: +f.maxErr.toFixed(4), meanCorrectedSlip: f.samples ? +(f.slipSum / f.samples).toFixed(3) : 0 }; },
      resetFeet() { Object.assign(bodyRig.feet, { samples: 0, err: 0, maxErr: 0, slipSum: 0 }); bodyRig.contacts.count = 0; },
      los(ax, ay, az, bx, by, bz) {
        const A = new T.Vector3(ax, ay, az), B = new T.Vector3(bx, by, bz);
        return { los: senses.lineOfSight(A, B), terrain: senses.terrainBlocks(A, B), solid: collision.blocked(A, B)?.type ?? null, foliage: +senses.foliage(A, B).toFixed(2) };
      },
      hiddenAt(x, z) { return senses.hiddenness(camera.position, new T.Vector3(x, altitude(x, z), z)); },
      cover(kind) { observePlayer(0, player.pos); return planCover(kind); },
    },
  };
}
