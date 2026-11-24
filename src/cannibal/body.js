import * as T from 'three';
import { altitude, clamp, mix, smooth } from '../math.js';
import { aimChain, solveTwoBone } from './ik.js';
import { clipKey } from './clips.js';

// The cannibal's body: mocap clips as the base layer, then procedural work on top.
//  - locomotion clips play at the speed their own planted feet move (measured at load)
//  - hands and feet plant on the terrain (two-bone IK), the hips sink to the lower foot
//  - every new contact is reported (footstep sounds come from real contacts)
//  - climbing: four grips on the bark, diagonal limbs move together, IK pulls the limbs there
//  - jumps: the clip's own crouch, flight and landing sections around a ballistic root
//  - the head turns towards whatever he is watching
const LIMBS = [
  { name: 'footL', chain: ['LeftUpLeg', 'LeftLeg', 'LeftFoot'], foot: true, side: 1 },
  { name: 'footR', chain: ['RightUpLeg', 'RightLeg', 'RightFoot'], foot: true, side: -1 },
  { name: 'handL', chain: ['LeftArm', 'LeftForeArm', 'LeftHand'], foot: false, side: 1 },
  { name: 'handR', chain: ['RightArm', 'RightForeArm', 'RightHand'], foot: false, side: -1 },
];

export function createBody({ root, model, onContact }) {
  const body = model.scene;
  const bone = n => body.getObjectByName('mixamorig' + n) || body.getObjectByName('mixamorig:' + n);
  const head = bone('Head'), neck = bone('Neck'), hips = bone('Hips');
  const limbs = LIMBS.map(l => ({ ...l, bones: l.chain.map(bone), planted: false, plant: new T.Vector3(), blend: 1,
    from: new T.Vector3(), anim: new T.Vector3(), target: new T.Vector3(), mid: new T.Vector3(), contactH: {}, grip: new T.Vector3(), cycle: -1, armed: true }));
  const mixer = new T.AnimationMixer(body);
  const actions = {}, clips = {};
  for (const clip of model.animations) {
    // Keyframe clips (k2_*) take the role of the old mocap clip with the same name.
    const k = clipKey(clip.name);
    if (clips[k]?.name.startsWith('k2_') && !clip.name.startsWith('k2_')) continue;
    actions[k] = mixer.clipAction(clip); clips[k] = clip;
  }

  // ---------- facing axes at rest (model faces +Z)
  root.updateMatrixWorld(true);
  const restFacing = new Map();
  for (const b of [head, neck]) {
    const q = b.getWorldQuaternion(new T.Quaternion()).invert();
    restFacing.set(b, new T.Vector3(0, 0, 1).applyQuaternion(q));
  }
  const facing = (b, out) => out.copy(restFacing.get(b)).applyQuaternion(b.getWorldQuaternion(qTmp));
  const qTmp = new T.Quaternion();

  // ---------- clip analysis: contact heights, natural speed, flight window of the leap
  const v = new T.Vector3();
  function sample(name, fn, count = 64) {
    const action = actions[name], clip = clips[name];
    mixer.stopAllAction();
    action.reset().play(); action.setEffectiveWeight(1);
    for (let i = 0; i < count; i++) {
      const t = clip.duration * i / count;
      mixer.setTime(t);
      root.updateMatrixWorld(true);
      fn(t, i);
    }
    mixer.stopAllAction();
  }
  const analysis = {};
  for (const name of ['stalk', 'run', 'perch', 'climb', 'watch', 'peek']) {
    if (!actions[name]) continue;
    const tracks = limbs.map(() => []);
    sample(name, (t) => limbs.forEach((l, i) => tracks[i].push([t, l.bones[2].getWorldPosition(v).clone()])));
    const info = { contact: {}, speed: 0 };
    // Natural speed: how fast a planted foot slides back in the in-place clip. Per foot median,
    // then the faster foot (keyframe cycles can have one foot that barely slides).
    let footSpeed = 0;
    limbs.forEach((l, i) => {
      const ys = tracks[i].map(([, p]) => p.y);
      const min = Math.min(...ys);
      const h = min + (l.foot ? .045 : .04);
      info.contact[l.name] = { min, h };
      if (!l.foot) return;
      const tr = tracks[i], speeds = [];
      for (let k = 0; k + 1 < tr.length; k++) {
        if (tr[k][1].y > h || tr[k + 1][1].y > h) continue;
        speeds.push(-(tr[k + 1][1].z - tr[k][1].z) / (tr[k + 1][0] - tr[k][0]));
      }
      speeds.sort((a, b) => a - b);
      if (speeds.length) footSpeed = Math.max(footSpeed, speeds[Math.floor(speeds.length / 2)]);
    });
    info.speed = footSpeed;
    analysis[name] = info;
  }
  // Leap: hips curve tells crouch -> push-off -> flight -> landing.
  const leap = { crouch: 0, takeoff: .5, land: 1, end: 1.5 };
  if (actions.leap) {
    const feet = [];
    sample('leap', t => {
      const a = limbs[0].bones[2].getWorldPosition(v).y, b = limbs[1].bones[2].getWorldPosition(v).y;
      feet.push([t, Math.min(a, b), hips.getWorldPosition(v).y]);
    }, 96);
    const groundFoot = Math.min(...feet.map(f => f[1]));
    const air = feet.filter(f => f[1] > groundFoot + .12);
    if (air.length) {
      leap.takeoff = air[0][0]; leap.land = air[air.length - 1][0];
      // lowest hips before take-off = end of the wind-up
      const before = feet.filter(f => f[0] < leap.takeoff);
      leap.crouch = before.reduce((m, f) => f[2] < m[2] ? f : m, before[0] ?? feet[0])[0];
      leap.end = Math.min(clips.leap.duration, leap.land + .45);
    }
    // The keyframe leap is timed by hand: wind-up 0-0.25 s, take-off 0.25, landing 0.85, caught 1.3.
    if (clips.leap.name.startsWith('k2_')) Object.assign(leap, { crouch: .22, takeoff: .25, land: .85, end: 1.3 });
    // The clip lifts its own hips during the flight (up to ~0.7 m); the root already flies a
    // ballistic arc, so that lift is taken out again while airborne.
    leap.hips = feet.map(f => [f[0], f[2]]);
  }
  const leapHip = t => {
    const h = leap.hips;
    if (!h?.length) return 0;
    let i = 0; while (i + 1 < h.length && h[i + 1][0] < t) i++;
    const [t0, y0] = h[i], [t1, y1] = h[Math.min(i + 1, h.length - 1)];
    return t1 > t0 ? mix(y0, y1, clamp((t - t0) / (t1 - t0), 0, 1)) : y0;
  };

  // ---------- clip playback
  let current = null;
  function play(name, { fade = .25, speed = 1, once = false } = {}) {
    const next = actions[name];
    if (!next) return null;
    next.timeScale = speed;
    if (current === next) return next;
    next.reset(); next.enabled = true;
    next.setLoop(once ? T.LoopOnce : T.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.play();
    if (current) current.crossFadeTo(next, fade, false); else next.fadeIn(fade);
    current = next;
    return next;
  }
  // Hold a clip at a chosen time (jump sections, climbing base pose).
  function scrub(name, time, fade = .12) {
    const a = play(name, { fade, speed: 0 });
    if (a) a.time = clamp(time, 0, clips[name].duration - 1e-3);
    return a;
  }

  // ---------- state shared with the mind
  const ctx = {
    mode: 'ground',        // ground | climb | air | still
    gait: 'perch',         // clip for ground mode
    speed: 0,              // m/s over the ground
    look: null, lookWeight: 0,
    tree: null, climbHeight: 0, climbAngle: 0, trunkRadius: () => .3,
    jump: null,            // { phase: 'windup'|'flight'|'land', s }
  };
  let hipOffset = 0, hipVelocity = 0, hipTarget = 0, liftComp = 0;
  const contacts = { count: 0, last: [] };
  const feet = { samples: 0, err: 0, maxErr: 0, slipSum: 0 };

  function setGaitSpeed() {
    const info = analysis[ctx.gait];
    let scale = 1;
    if (ctx.gait === 'stalk') scale = info?.speed > .15 ? ctx.speed / info.speed : ctx.speed / 1.2;
    else if (ctx.gait === 'run') scale = info?.speed > .8 ? ctx.speed / info.speed : ctx.speed / 5;
    else if (ctx.gait === 'perch' || ctx.gait === 'watch' || ctx.gait === 'peek') scale = .85;
    // A creep or run frozen mid-step (he stops when glanced at); idle clips keep their own tempo.
    if (ctx.speed < .05 && (ctx.gait === 'stalk' || ctx.gait === 'run')) scale = .12;
    if (current) current.timeScale = clamp(scale, .1, 2.6);
  }

  const pole = new T.Vector3(), a0 = new T.Vector3(), a2 = new T.Vector3(), up = new T.Vector3(0, 1, 0);
  // Ankle / wrist height over the ground when the sole or palm rests on it. Fixed, because the
  // clips come from a skeleton with other limb lengths (their lowest hand may sit below ground).
  const jointHeight = l => l.foot ? .075 : .04;
  function groundIK(dt) {
    const info = analysis[ctx.gait];
    let lowest = 0, planted = 0;
    const handsToo = ctx.gait === 'stalk' || ctx.gait === 'perch' || ctx.gait === 'watch';
    for (const l of limbs) {
      // Hands only where the clip really puts them down (a raised hand stays raised).
      if (!l.foot && (!handsToo || (info?.contact[l.name]?.min ?? 1) > .3)) { l.planted = false; l.ik = false; continue; }
      l.ik = true;
      const end = l.bones[2];
      end.getWorldPosition(l.anim);
      const hClip = l.anim.y - root.position.y - hipOffset;
      const c = info?.contact[l.name];
      if (!c) { l.ik = false; continue; }
      const ground = altitude(l.anim.x, l.anim.z);
      const lift = hClip - c.min;
      const inContact = hClip < c.h;
      // A new contact needs a real lift first (no chattering plants and double footsteps).
      if (hClip > c.h + .004) l.armed = true;
      if (inContact && !l.planted && ctx.speed > .05 && l.armed) {
        l.planted = true; l.armed = false;
        l.plant.set(l.anim.x, ground + jointHeight(l), l.anim.z);
        contacts.count++; contacts.last.push(l.name); if (contacts.last.length > 8) contacts.last.shift();
        onContact?.(l, l.plant, ctx.gait);
      } else if (l.planted && (!inContact || Math.hypot(l.anim.x - l.plant.x, l.anim.z - l.plant.z) > (l.foot ? .5 : .4) || ctx.speed <= .05)) {
        l.planted = false; l.from.copy(l.target); l.blend = 0;
      }
      if (l.planted) l.target.copy(l.plant);
      else {
        l.target.set(l.anim.x, ground + jointHeight(l) + Math.max(0, lift), l.anim.z);
        if (l.blend < 1) { l.blend = Math.min(1, l.blend + dt / .12); l.target.lerp(l.from, 1 - l.blend); }
      }
      if (inContact || l.planted) { lowest = Math.min(lowest, ground - root.position.y); planted++; }
    }
    // Hips sink to the lower contact; small dip on every new plant gives weight.
    hipTarget = clamp(lowest, -.32, .05);
    for (const l of limbs) {
      if (!l.ik) continue;
      const [u, m, e] = l.bones;
      u.getWorldPosition(a0); e.getWorldPosition(a2); m.getWorldPosition(l.mid);
      pole.copy(l.mid).sub(a0.add(a2).multiplyScalar(.5)).normalize().multiplyScalar(.5).add(l.mid);
      const over = solveTwoBone(u, m, e, l.target, pole, 1);
      // Out of reach: let go and step again rather than leave the foot hanging off the plant.
      if (l.planted && over > .03) { l.planted = false; l.from.copy(e.getWorldPosition(a2)); l.blend = 0; continue; }
      if (l.planted) {
        // How far the planted hand/foot really drifts after IK (should stay ~0).
        const err = e.getWorldPosition(a2).distanceTo(l.target);
        feet.samples++; feet.err += err; feet.maxErr = Math.max(feet.maxErr, err);
        if (l.foot) { const slip = Math.hypot(l.anim.x - l.plant.x, l.anim.z - l.plant.z); feet.slipSum += slip; }
      }
    }
    return planted;
  }

  // ---------- climbing: diagonal pairs reach in turn, grips stay fixed in the world
  const CLIMB = { stride: .52, hold: .68 };
  const gripSpec = {
    handL: { phase: 0, height: 1.5, spread: .62 }, footR: { phase: 0, height: .34, spread: -.55 },
    handR: { phase: .5, height: 1.5, spread: -.62 }, footL: { phase: .5, height: .34, spread: .55 },
  };
  const side = new T.Vector3(), toTrunk = new T.Vector3();
  function climbIK() {
    const t = ctx.tree;
    if (!t) return;
    const ang = ctx.climbAngle, h = ctx.climbHeight;
    toTrunk.set(-Math.sin(ang), 0, -Math.cos(ang));
    side.crossVectors(up, toTrunk);
    for (const l of limbs) {
      const g = gripSpec[l.name];
      const c = h / CLIMB.stride + g.phase;
      const k = Math.floor(c), f = c - k;
      const baseY = (k - g.phase) * CLIMB.stride;
      const hold = baseY + g.height + CLIMB.stride * .34;
      let gy = hold, pull = 0;
      if (f > CLIMB.hold) {
        const s = smooth(CLIMB.hold, 1, f);
        gy = mix(hold, hold + CLIMB.stride, s);
        pull = Math.sin(s * Math.PI) * .14;
      }
      if (k !== l.cycle) {
        if (l.cycle >= 0) { contacts.count++; onContact?.(l, l.grip, 'climb'); }
        l.cycle = k;
      }
      const ga = ang + g.spread;
      const r = ctx.trunkRadius(t, gy) + .05 + pull;
      l.grip.set(t.x + Math.sin(ga) * r, t.y + gy, t.z + Math.cos(ga) * r);
      const [u, m, e] = l.bones;
      u.getWorldPosition(a0);
      // elbows out and down, knees out and towards the bark (frog grip)
      pole.copy(a0).addScaledVector(side, l.side * .55).addScaledVector(up, l.foot ? .1 : -.35).addScaledVector(toTrunk, l.foot ? .35 : -.15);
      solveTwoBone(u, m, e, l.grip, pole, 1);
    }
  }

  // ---------- update after the mind has placed the root
  const lookTarget = new T.Vector3();
  function update(dt) {
    // Choose the base clip for the mode.
    if (ctx.mode === 'ground') { play(ctx.gait, { fade: .3 }); setGaitSpeed(); }
    else if (ctx.mode === 'climb') { play('climb', { fade: .25 }); if (current) current.timeScale = clamp(ctx.speed / .55, .2, 1.6); }
    else if (ctx.mode === 'air' && ctx.jump) {
      const j = ctx.jump;
      const time = j.phase === 'windup' ? mix(Math.max(0, leap.crouch - .35), leap.crouch, j.s)
        : j.phase === 'flight' ? mix(leap.takeoff, leap.land, j.s) : mix(leap.land, leap.end, j.s);
      scrub('leap', time, j.phase === 'windup' && j.s < .05 ? .12 : 0);
      // Take the clip's own hip lift out of the flight; the ballistic root carries the arc.
      liftComp = j.phase === 'flight' ? -(leapHip(time) - mix(leapHip(leap.takeoff), leapHip(leap.land), j.s)) : 0;
    }
    else if (ctx.mode === 'still' && ctx.gait) play(ctx.gait, { fade: .2, once: ctx.gait === 'death' || ctx.gait === 'scream' });
    if (ctx.mode !== 'air') liftComp = 0;
    mixer.update(dt);
    // Hip spring (weight, wind-up crouch, landing absorption).
    // The keyframe leap crouches by itself; the old mocap leap needed help.
    if (ctx.mode === 'air' && ctx.jump?.phase === 'windup') hipTarget = clips.leap?.name.startsWith('k2_') ? 0 : -.22 * ctx.jump.s;
    hipVelocity += ((hipTarget - hipOffset) * 140 - hipVelocity * 18) * dt;
    hipOffset += hipVelocity * dt;
    body.position.y = hipOffset + liftComp;
    root.updateMatrixWorld(true);
    if (ctx.mode === 'ground') groundIK(dt);
    else if (ctx.mode === 'climb') { hipTarget = 0; climbIK(); }
    else { hipTarget = 0; for (const l of limbs) l.planted = false; }
    if (ctx.look && ctx.lookWeight > .01) {
      lookTarget.copy(ctx.look);
      aimChain([neck, head], [.4, .6], facing, lookTarget, ctx.lookWeight, 1.1);
    }
  }
  function land(strength = 1) { hipVelocity = -2.6 * strength; }
  function dip(amount) { hipVelocity -= amount; }

  return {
    ctx, update, land, dip, play, scrub, mixer, actions, analysis, leap, limbs, contacts, feet, head, hips,
    // Test hook: limb end positions (root space) over a clip. Run only while he is not shown.
    trace(name, count = 48) {
      const out = [], keep = root.position.clone(), rot = root.rotation.y;
      root.position.set(0, 0, 0); root.rotation.y = 0; body.position.y = 0;
      sample(name, t => out.push([+t.toFixed(3), ...limbs.map(l => { const p = l.bones[2].getWorldPosition(v); return [+p.y.toFixed(3), +p.z.toFixed(3)]; })]), count);
      root.position.copy(keep); root.rotation.y = rot; current = null;
      return out;
    },
    get hipOffset() { return hipOffset; },
    get current() { return current; },
  };
}
