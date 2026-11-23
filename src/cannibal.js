import * as T from 'three';
import { altitude, clamp, mix, random, TAU } from './math.js';

// The cannibal only hunts at night. He moves through the crowns from tree to tree,
// stalks on all fours behind the player, freezes when glanced at and flees when he is
// clearly seen. Close enough and unseen, he pounces: camera on his face, scream, death.
const SIGHT_CLEAR = Math.cos(T.MathUtils.degToRad(27));
const SIGHT_WIDE = Math.cos(T.MathUtils.degToRad(52));
const up = new T.Vector3(0, 1, 0);

export function createCannibal({ scene, camera, collision, audio, trees, model, dagger, sounds, isNight, onCatch }) {
  const rand = random(90211);
  const pick = list => list[Math.floor(rand() * list.length)];

  // ---------- model and animation
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
  const head = bone('Head'), hand = bone('RightHand'), hips = bone('Hips');
  const mixer = new T.AnimationMixer(body);
  const actions = {};
  for (const clip of model.animations) {
    const key = clip.name.replace(/^k_/, '').replace(/^f_death_fall$/, 'death');
    actions[key] = mixer.clipAction(clip);
  }
  let current = null;
  function anim(name, { fade = .28, speed = 1, once = false, restart = false } = {}) {
    const next = actions[name];
    if (!next) return;
    next.timeScale = speed;
    if (current === next && !restart) return;
    next.reset();
    next.setLoop(once ? T.LoopOnce : T.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.play();
    if (current && current !== next) current.crossFadeTo(next, fade, false);
    else next.fadeIn(fade);
    current = next;
  }

  // ---------- bone dagger: held in the right hand, dropped on death
  const knife = dagger.scene;
  knife.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  const knifeGrip = new T.Group();
  knifeGrip.add(knife);
  (hand || body).add(knifeGrip);
  // Fist grip from the rest skeleton: handle across the palm, blade out of the thumb side.
  const thumb = bone('RightHandThumb1'), middle = bone('RightHandMiddle1');
  if (thumb && middle) {
    const fingers = middle.position.clone().normalize();
    const side = thumb.position.clone().normalize();
    const blade = side.addScaledVector(fingers, -side.dot(fingers)).normalize();
    knifeGrip.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), blade);
    knifeGrip.position.copy(fingers).multiplyScalar(middle.position.length() * .62);
  }
  const drop = { active: false, resting: false, taken: false, velocity: new T.Vector3(), spin: new T.Vector3() };

  // ---------- trees he can use
  const usable = trees.filter(t => t.height >= 8.5 && Math.abs(t.x) < 134 && t.z > -224 && t.z < 84);
  const cells = new Map(), cellSize = 10;
  for (const t of usable) {
    const key = Math.floor(t.x / cellSize) + ',' + Math.floor(t.z / cellSize);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(t);
  }
  function near(x, z, reach, visit) {
    for (let i = Math.floor((x - reach) / cellSize); i <= Math.floor((x + reach) / cellSize); i++)
      for (let j = Math.floor((z - reach) / cellSize); j <= Math.floor((z + reach) / cellSize); j++)
        for (const t of cells.get(i + ',' + j) ?? []) {
          const d = Math.hypot(t.x - x, t.z - z);
          if (d <= reach) visit(t, d);
        }
  }
  const trunkRadius = (t, y) => t.height * .023 * (1 - y / t.height) + .03;
  const perchHeight = t => clamp(t.height * .26, 3.4, 7.2);
  function perchSpot(t, dx, dz, out, gap = .5) {
    const len = Math.hypot(dx, dz) || 1, h = perchHeight(t), r = trunkRadius(t, h) + gap;
    return out.set(t.x + dx / len * r, t.y + h, t.z + dz / len * r);
  }

  // ---------- spatial sound from the recorded library
  const buffers = {};
  let decoding = false;
  function decode() {
    if (decoding || !audio.context) return;
    decoding = true;
    for (const [name, url] of Object.entries(sounds)) {
      fetch(url).then(r => r.arrayBuffer()).then(data => audio.context.decodeAudioData(data))
        .then(buffer => { buffers[name] = buffer; }).catch(() => {});
    }
  }
  let runLoop = null, playCount = 0;
  const played = [];
  function play(name, position, { volume = 1, rate = 1, ref = 4, direct = false } = {}) {
    const ctx = audio.context, buffer = buffers[name];
    if (!ctx || !buffer || ctx.state !== 'running') return null;
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = buffer; src.playbackRate.value = rate;
    gain.gain.value = volume;
    src.connect(gain);
    if (direct || !position) gain.connect(audio.output);
    else {
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse';
      pan.refDistance = ref; pan.rolloffFactor = 1.15; pan.maxDistance = 120;
      pan.positionX.value = position.x; pan.positionY.value = position.y; pan.positionZ.value = position.z;
      gain.connect(pan).connect(audio.output);
      src.panner = pan;
    }
    src.start();
    played.push(name); if (played.length > 12) played.shift(); playCount++;
    return src;
  }
  const variant = (base, count) => base + '-' + (1 + Math.floor(rand() * count));
  const listenerForward = new T.Vector3();
  function listen() {
    const l = audio.context?.listener;
    if (!l || !l.positionX) return;
    camera.getWorldDirection(listenerForward);
    const t = audio.context.currentTime;
    l.positionX.setValueAtTime(camera.position.x, t); l.positionY.setValueAtTime(camera.position.y, t); l.positionZ.setValueAtTime(camera.position.z, t);
    l.forwardX.setValueAtTime(listenerForward.x, t); l.forwardY.setValueAtTime(listenerForward.y, t); l.forwardZ.setValueAtTime(listenerForward.z, t);
    l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
  }
  function setRunning(on) {
    if (on && !runLoop) {
      runLoop = play('kannibale-rennen', root.position, { volume: 1.1, ref: 5 });
      if (runLoop) runLoop.loop = true;
    } else if (!on && runLoop) { try { runLoop.stop(); } catch {} runLoop = null; }
    if (runLoop?.panner) {
      const p = runLoop.panner, t = audio.context.currentTime;
      p.positionX.setValueAtTime(root.position.x, t); p.positionY.setValueAtTime(root.position.y + .4, t); p.positionZ.setValueAtTime(root.position.z, t);
    }
  }

  // ---------- state
  const pos = root.position;
  const velocity = new T.Vector3(), from = new T.Vector3(), to = new T.Vector3(), tmp = new T.Vector3(), eye = new T.Vector3();
  const headWorld = new T.Vector3(), chest = new T.Vector3(), ray = new T.Vector3(), fwd = new T.Vector3();
  let state = 'away', timer = 0, heading = 0, targetHeading = 0, tree = null, nextTree = null, health = 2;
  let cooldown = 14, nightTime = 0, seenMeter = 0, glanced = false, clear = false, watching = false;
  let stepTimer = 0, idleSound = 4, leapTime = 1, leapArc = 1, fleeHops = 0, catchTime = 0, lastSeen = 99;
  let goalHeading = 0, unseenFor = 0;
  const lastSeenTime = () => unseenFor;
  let distance = 99, perched = false, catching = false, caught = false, freezes = 0, hops = 0, climbs = 0, spotted = 0;
  const camQuat = new T.Quaternion(), lookMatrix = new T.Matrix4();
  const fade = document.getElementById('fg-fade');

  function setState(next) { state = next; timer = 0; }

  // Walk towards a heading, swerving round rocks, trunks and deadwood that block the way.
  const probe = new T.Vector3(), probeVel = new T.Vector3();
  let steerOffset = 0, steerTimer = 0;
  const offsets = [0, .45, -.45, .9, -.9, 1.35, -1.35, 1.8, -1.8];
  function walk(goalHeading, speed, dt) {
    steerTimer -= dt;
    if (steerTimer <= 0) {
      steerTimer = .3;
      let best = steerOffset, bestGain = -1;
      for (const o of offsets) {
        const h = goalHeading + o;
        probe.copy(pos);
        probeVel.set(Math.sin(h) * speed, 0, Math.cos(h) * speed);
        collision.move(probe, probeVel, .35, true);
        const moved = Math.hypot(probe.x - pos.x, probe.z - pos.z);
        const climb = altitude(probe.x, probe.z) - pos.y;
        const gain = moved * Math.cos(o) - Math.max(0, climb - moved * .9) * 2 - Math.abs(o - steerOffset) * .05;
        if (gain > bestGain) { bestGain = gain; best = o; }
        if (o === 0 && moved > speed * .3) break;
      }
      steerOffset = best;
    }
    targetHeading = goalHeading + steerOffset;
    velocity.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
    if (ghost > 0) { ghost -= dt; pos.addScaledVector(velocity, dt); }
    else collision.move(pos, velocity, dt, true);
    pos.y = collision.floorAt(pos.x, pos.z, pos.y + .3);
    // Wedged between rocks: slip through for a moment instead of running on the spot.
    stuckTime += dt;
    if (stuckTime > .5) {
      if (Math.hypot(pos.x - anchor.x, pos.z - anchor.z) < speed * stuckTime * .2) { ghost = .7; steerTimer = 0; }
      anchor.copy(pos); stuckTime = 0;
    }
  }
  let ghost = 0, stuckTime = 0;
  const anchor = new T.Vector3();
  // A free spot on the ground about 2.4 m from here, as close as possible to the wanted direction.
  function landing(dx, dz) {
    const want = Math.atan2(dx, dz);
    for (const o of offsets.concat([2.4, -2.4, Math.PI])) {
      const h = want + o, x = pos.x + Math.sin(h) * 2.4, z = pos.z + Math.cos(h) * 2.4;
      const ground = altitude(x, z);
      if (collision.floorAt(x, z, pos.y) > ground + .25) continue;     // on top of a rock
      probe.set(x, ground, z); probeVel.set(0, 0, 0);
      collision.move(probe, probeVel, .016, true);
      if (Math.hypot(probe.x - x, probe.z - z) > .03) continue;          // inside a trunk or boulder
      return new T.Vector3(x, ground, z);
    }
    return new T.Vector3(pos.x + Math.sin(want) * 2.4, altitude(pos.x + Math.sin(want) * 2.4, pos.z + Math.cos(want) * 2.4), pos.z + Math.cos(want) * 2.4);
  }
  function show(value) { root.visible = value; }

  function faceTo(x, z, instant = false) {
    targetHeading = Math.atan2(x - pos.x, z - pos.z);
    if (instant) heading = targetHeading;
  }

  // ---------- perception (the player's eyes)
  function terrainBlocks(origin, dir, len) {
    for (let i = 1; i < 8; i++) {
      const s = len * i / 8, x = origin.x + dir.x * s, z = origin.z + dir.z * s, y = origin.y + dir.y * s;
      if (altitude(x, z) > y + .05) return true;
    }
    return false;
  }
  function visibleFrom(point) {
    ray.subVectors(point, eye);
    const len = ray.length();
    ray.multiplyScalar(1 / len);
    const facing = ray.dot(fwd);
    if (facing < SIGHT_WIDE || len > 46) return 0;
    if (terrainBlocks(eye, ray, len)) return 0;
    const hit = collision.strike(eye, ray, Math.max(.1, len - .55));
    if (hit) return 0;
    const reach = perched ? 15 : 31;
    return facing > SIGHT_CLEAR && len < reach ? 2 : 1;
  }
  let blind = false, frozen = false;   // test hook: ignore the player's eyes
  function perceive() {
    eye.copy(camera.position);
    camera.getWorldDirection(fwd);
    head.getWorldPosition(headWorld);
    chest.copy(headWorld).lerp(pos, .45);
    const a = visibleFrom(headWorld), b = visibleFrom(chest);
    clear = Math.max(a, b) === 2;
    glanced = Math.max(a, b) >= 1;
    // "Watching" = the player faces his way, whether or not he can be seen there.
    tmp.subVectors(pos, eye).setY(0);
    const flat = Math.hypot(fwd.x, fwd.z) || 1;
    watching = (tmp.x * fwd.x + tmp.z * fwd.z) / flat / (tmp.length() || 1) > Math.cos(T.MathUtils.degToRad(62)) && distance < 44;
    if (blind) clear = glanced = watching = false;
  }

  // ---------- behaviours
  function bearingBehind(player, playerYaw, radius) {
    // A point behind the player: where he wants to be.
    return tmp.set(player.x - Math.sin(playerYaw) * radius, 0, player.z - Math.cos(playerYaw) * radius);
  }
  function playerYaw() {
    camera.getWorldDirection(fwd);
    return Math.atan2(fwd.x, fwd.z);
  }

  function spawn(player) {
    // Somewhere behind the player, 32-55 m away, in a tree he can climb, out of sight.
    const yaw = playerYaw();
    let best = null, bestScore = Infinity;
    near(player.x, player.z, 58, (t, d) => {
      if (d < 30) return;
      const bearing = Math.atan2(t.x - player.x, t.z - player.z);
      let off = Math.abs(((bearing - yaw + Math.PI) % TAU + TAU) % TAU - Math.PI);
      const score = -off * 9 + Math.abs(d - 42) + rand() * 6;
      if (score < bestScore) { bestScore = score; best = t; }
    });
    if (!best) return false;
    tree = best;
    health = 2; seenMeter = 0; lastSeen = 99;
    show(true);
    knifeGrip.visible = true;
    if (rand() < .5) {
      // Climbs out of the dark at the trunk.
      perchSpot(tree, player.x - tree.x, player.z - tree.z, to, .72);
      from.set(to.x, altitude(to.x, to.z), to.z);
      pos.copy(from);
      faceTo(tree.x, tree.z, true);
      startClimb();
    } else {
      perchSpot(tree, player.x - tree.x, player.z - tree.z, pos);
      faceTo(player.x, player.z, true);
      perch();
    }
    return true;
  }

  function startClimb() {
    perched = true; climbs++;
    setState('climb');
    anim('climb', { speed: 1.15 });
    play(variant('kannibale-ast', 3), pos, { volume: .9 });
  }
  let perchWaits = 0;
  function perch() {
    perched = true; perchWaits = 0;
    setState('perch');
    anim('perch', { speed: .8 });
    timer = -mix(1.1, 3.2, rand());
  }
  function leapTo(target, spot, kind) {
    from.copy(pos);
    to.copy(spot);
    nextTree = target;
    const span = from.distanceTo(to);
    leapTime = clamp(.42 + span * .07, .5, 1.25);
    leapArc = kind === 'down' ? .5 : 1 + span * .12;
    faceTo(to.x, to.z, true);
    setState(kind === 'pounce' ? 'pounce' : kind === 'down' ? 'drop' : 'leap');
    anim('leap', { fade: .12, speed: 1.6 / leapTime, once: true, restart: true });
    play(variant('kannibale-ast', 3), pos, { volume: 1.1 });
    if (rand() < .35) play(variant('kannibale-knacken', 2), pos, { volume: .9 });
    if (kind !== 'down') hops++;
  }
  function ground() {
    perched = false; tree = null;
    pos.y = collision.floorAt(pos.x, pos.z, pos.y + .3);
  }
  function stalk() { ground(); setState('stalk'); anim('stalk', { speed: .9 }); }
  function flee(player) {
    spotted++;
    lastSeen = 0;
    play(variant('kannibale-knurren', 3), pos, { volume: 1.3, rate: mix(.9, 1.05, rand()) });
    if (perched) play('kannibale-astbruch', pos, { volume: 1.2 });
    fleeHops = 2 + Math.floor(rand() * 2);
    if (perched && state !== 'climb') { setState('flee-tree'); timer = .25; }
    else {
      if (state === 'climb') { pos.y = altitude(pos.x, pos.z); }
      ground();
      setState('flee');
      faceTo(pos.x * 2 - player.x, pos.z * 2 - player.z, false);
      anim('run', { fade: .15, speed: 1.05 });
    }
  }
  function vanish() {
    show(false); setRunning(false);
    setState('away');
    cooldown = mix(16, 32, rand());
    perched = false; tree = null;
  }

  function bestNeighbour(player, away) {
    // Next crown: closer to the spot behind the player (or further when fleeing), not in plain view.
    const yaw = playerYaw();
    const goal = away ? null : bearingBehind(player, yaw, clamp(distance * .5, 3, 14)).clone();
    let best = null, bestScore = Infinity;
    near(pos.x, pos.z, 8.6, (t, d) => {
      if (t === tree || d < 3) return;
      const spot = perchSpot(t, pos.x - t.x, pos.z - t.z, new T.Vector3());
      const toPlayer = Math.hypot(spot.x - player.x, spot.z - player.z);
      let score = away ? -toPlayer : Math.hypot(spot.x - goal.x, spot.z - goal.z);
      if (!away) {
        tmp.subVectors(spot, camera.position);
        const len = tmp.length();
        if (tmp.dot(fwd) / len > SIGHT_WIDE && len < 30) score += 30;
        if (toPlayer < 5.5) score += 12;
      }
      score += rand() * 1.5;
      if (score < bestScore) { bestScore = score; best = { tree: t, spot, score }; }
    });
    return best;
  }

  function sweepSounds(dt, player) {
    idleSound -= dt;
    if (idleSound > 0) return;
    idleSound = mix(3.5, 8, rand());
    if (distance < 10 && !watching) play(variant('kannibale-atmen', 2), headWorld, { volume: .9, ref: 2.5 });
    else if (distance < 18 && rand() < .45) play('kannibale-fluestern', headWorld, { volume: .7, ref: 2.5 });
    else if (perched && rand() < .6) play(variant('kannibale-ast', 3), pos, { volume: .7 });
    else if (rand() < .35) play('kannibale-knurren-3', headWorld, { volume: .8, ref: 3 });
  }

  function startCatch(player) {
    setState('catch');
    catching = true; caught = false; catchTime = 0;
    setRunning(false);
    show(true);
    anim('scream', { fade: .08, speed: 1.15, once: true, restart: true });
    play('kannibale-jumpscare', null, { volume: 1.6, direct: true });
    play('kannibale-knurren-2', null, { volume: .9, direct: true, rate: .92 });
    camQuat.copy(camera.quaternion);
  }

  // ---------- sword hits (ray against an upright capsule around the body)
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
    health--;
    if (health <= 0) { die(origin); return; }
    play('kannibale-tod-kurz', headWorld, { volume: 1.2, rate: 1.1 });
    flee({ x: origin.x, z: origin.z });
  }
  function die(origin) {
    setRunning(false);
    if (perched) ground();
    setState('dead');
    faceTo(origin.x, origin.z, true);
    anim('death', { fade: .1, once: true, restart: true });
    play('kannibale-tod', headWorld, { volume: 1.4, ref: 5 });
    // The dagger leaves the hand and falls freely.
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
        play('knochendolch-fallen', knife.position, { volume: 1.2, ref: 3 });
        drop.velocity.set(drop.velocity.x * .35, -drop.velocity.y * .28, drop.velocity.z * .35);
        drop.spin.multiplyScalar(.4);
      } else {
        drop.resting = true;
        // Lies flat on its side on the ground.
        knife.rotation.set(Math.PI / 2 * Math.sign(knife.rotation.x || 1), knife.rotation.y, 0);
      }
    }
  }

  // ---------- main update
  function update(dt, player, active) {
    decode();
    listen();
    if (!active && !(catching && !caught)) { mixer.update(0); return; }
    if (frozen) { root.updateMatrixWorld(true); return; }
    nightTime = isNight() ? nightTime + dt : 0;
    if (drop.active) updateDrop(dt);
    distance = Math.hypot(pos.x - player.x, pos.z - player.z);
    const night = isNight();
    if (state === 'away') {
      if (!night || nightTime < 9) return;
      cooldown -= dt;
      if (cooldown <= 0 && !spawn(player)) cooldown = 3;
      return;
    }
    if (state === 'dead') {
      mixer.update(dt);
      if (!night) { show(false); scene.remove(knife); drop.active = drop.resting = drop.taken = false; setState('away'); knifeGrip.add(knife); knife.position.set(0, 0, 0); knife.rotation.set(0, 0, 0); reset(); }
      return;
    }
    timer += dt;
    perceive();
    if (state !== 'catch') {
      unseenFor = glanced ? 0 : unseenFor + dt;
      if (clear && root.visible) seenMeter = Math.min(1, seenMeter + dt * 2.6);
      else seenMeter = Math.max(0, seenMeter - dt * 1.5);
      lastSeen += dt;
      const fleeing = state.startsWith('flee');
      if (seenMeter > .45 && !fleeing && state !== 'pounce') flee(player);
      else if (!night && !fleeing) { if (glanced) flee(player); else vanish(); return; }
    }

    switch (state) {
      case 'climb': {
        perchSpot(tree, pos.x - tree.x, pos.z - tree.z, to, .72);
        pos.y = Math.min(to.y, pos.y + dt * 1.6);
        if (timer > .7) { stepTimer -= dt; if (stepTimer <= 0) { stepTimer = mix(.5, .9, rand()); play(variant('kannibale-ast', 3), pos, { volume: .55 }); } }
        faceTo(tree.x, tree.z);
        if (pos.y >= to.y - .01) { perchSpot(tree, pos.x - tree.x, pos.z - tree.z, pos); faceTo(player.x, player.z); perch(); }
        break;
      }
      case 'perch': {
        faceTo(player.x, player.z);
        sweepSounds(dt, player);
        if (timer < 0) break;
        if (distance < 8.5 && !watching && !glanced) {
          // Pounce from the crown straight at the player.
          tmp.set(pos.x - player.x, 0, pos.z - player.z).normalize();
          leapTo(null, new T.Vector3(player.x + tmp.x * .9, player.y, player.z + tmp.z * .9), 'pounce');
          break;
        }
        const next = bestNeighbour(player, false);
        const here = Math.hypot(pos.x - bearingBehind(player, playerYaw(), clamp(distance * .5, 3, 14)).x, pos.z - tmp.z);
        if (next && next.score < here - 1.2 && !glanced) { leapTo(next.tree, next.spot, 'leap'); break; }
        perchWaits++;
        if ((distance < 22 || !next || perchWaits > 2) && !watching) {
          leapTo(null, landing(player.x - pos.x, player.z - pos.z), 'down');
          break;
        }
        timer = -mix(.8, 2.2, rand());
        break;
      }
      case 'leap': case 'drop': case 'pounce': {
        const s = clamp(timer / leapTime, 0, 1);
        pos.lerpVectors(from, to, s);
        pos.y += Math.sin(s * Math.PI) * leapArc;
        if (s >= 1) {
          if (state === 'leap') {
            tree = nextTree;
            play(variant('kannibale-ast', 3), pos, { volume: 1.2 });
            if (rand() < .4) play(variant('kannibale-knacken', 2), pos, { volume: .9 });
            perch();
          } else if (state === 'pounce') {
            ground();
            if (Math.hypot(pos.x - player.x, pos.z - player.z) < 3.2) startCatch(player);
            else stalk();
          } else {
            play(variant('kannibale-schritt', 4), pos, { volume: 1.2 });
            stalk();
          }
        }
        break;
      }
      case 'stalk': {
        sweepSounds(dt, player);
        if (distance < 1.9 && !clear) { startCatch(player); break; }
        let speed = 0;
        if (glanced && distance > 6) {
          // Glanced at from afar: freeze in place like an animal.
          if (current !== actions.perch) freezes++;
          anim('perch', { fade: .35, speed: .35 });
        } else {
          const far = distance > 24 && !watching;
          speed = far ? 5.2 : distance < 7 ? 1.6 : 2.4;
          anim(far ? 'run' : 'stalk', { speed: far ? 1 : speed / 2.1 });
          const yaw = playerYaw();
          const goal = watching ? bearingBehind(player, yaw, clamp(distance, 4, 10)) : tmp.set(player.x, 0, player.z);
          faceTo(goal.x, goal.z);
          goalHeading = targetHeading;
          if (!far) {
            stepTimer -= dt;
            if (stepTimer <= 0) { stepTimer = mix(.42, .7, rand()); play(variant('kannibale-schritt', 4), pos, { volume: .45, rate: mix(.9, 1.1, rand()) }); if (rand() < .08) play(variant('kannibale-knacken', 2), pos, { volume: .6 }); }
          }
          setRunning(far);
          // Climb the next tree when far away; the crowns are the safer way in.
          if (distance > 16 && timer > 3 && watching) {
            let trunk = null;
            near(pos.x, pos.z, 4, t => { trunk = trunk ?? t; });
            if (trunk) { setRunning(false); tree = trunk; tmp.set(pos.x - trunk.x, 0, pos.z - trunk.z); perchSpot(trunk, tmp.x, tmp.z, to, .72); pos.x = to.x; pos.z = to.z; startClimb(); break; }
          }
        }
        if (speed <= 4) setRunning(false);
        if (speed > 0) walk(goalHeading, speed, dt);
        break;
      }
      case 'flee-tree': {
        if (timer < .25) break;
        if (fleeHops <= 0 || !clear && lastSeen > 1.2 && rand() < .5) {
          if (!glanced) { vanish(); break; }
        }
        const next = bestNeighbour(player, true);
        if (next) { fleeHops--; leapTo(next.tree, next.spot, 'leap'); state = 'flee-leap'; }
        else { leapTo(null, landing(pos.x - player.x, pos.z - player.z), 'down'); state = 'flee-drop'; }
        break;
      }
      case 'flee-leap': case 'flee-drop': {
        const s = clamp(timer / leapTime, 0, 1);
        pos.lerpVectors(from, to, s);
        pos.y += Math.sin(s * Math.PI) * leapArc;
        if (s >= 1) {
          if (state === 'flee-leap') { tree = nextTree; play(variant('kannibale-ast', 3), pos, { volume: 1.2 }); setState('flee-tree'); anim('perch', { fade: .12 }); }
          else { ground(); setState('flee'); anim('run', { fade: .12 }); }
        }
        break;
      }
      case 'flee': {
        walk(Math.atan2(pos.x - player.x, pos.z - player.z), 6.4, dt);
        setRunning(true);
        // Gone once out of sight, never in plain view.
        if (!glanced && (distance > 30 || timer > 6 && lastSeenTime() > 1.5)) vanish();
        break;
      }
      case 'catch': {
        catchTime += dt;
        break;
      }
    }
    // Smooth turning.
    let delta = ((targetHeading - heading + Math.PI) % TAU + TAU) % TAU - Math.PI;
    heading += delta * (1 - Math.exp(-dt * (state === 'flee' ? 14 : 7)));
    root.rotation.set(0, heading, 0);
    mixer.update(dt);
    if (runLoop) setRunning(true);
  }

  // Called after the player has moved the camera: the jumpscare takes over the view.
  function frame(dt) {
    if (state !== 'catch' || frozen) return;
    closeupFill.value = .42 * T.MathUtils.smoothstep(catchTime, 0, .21) *
      (1 - T.MathUtils.smoothstep(catchTime, 1.11, 1.52));
    // Face the player, head 0.8 m in front of the eye.
    const eyePos = camera.position;
    if (catchTime < dt * 1.5) {
      tmp.set(pos.x - eyePos.x, 0, pos.z - eyePos.z);
      if (tmp.lengthSq() < .01) camera.getWorldDirection(tmp).setY(0);
      tmp.normalize();
      from.copy(tmp);
    }
    const dir = from;
    root.updateMatrixWorld(true);
    head.getWorldPosition(headWorld);
    const want = tmp.copy(eyePos).addScaledVector(dir, .78);
    want.y = eyePos.y - .06;
    pos.add(chest.subVectors(want, headWorld));
    faceTo(eyePos.x, eyePos.z, true);
    root.rotation.set(0, heading, 0);
    root.updateMatrixWorld(true);
    head.getWorldPosition(headWorld);
    // Camera snaps round to the face with a violent shake.
    const shake = Math.max(0, 1 - catchTime / 1.4) * .035;
    lookMatrix.lookAt(eyePos, tmp.copy(headWorld).add(eye.set((rand() - .5) * shake, (rand() - .5) * shake, 0)), up);
    const target = new T.Quaternion().setFromRotationMatrix(lookMatrix);
    camQuat.slerp(target, 1 - Math.exp(-dt * 22));
    camera.quaternion.copy(camQuat);
    camera.updateMatrixWorld();
    if (fade) fade.style.opacity = String(clamp((catchTime - 1.25) / .35, 0, 1));
    if (catchTime > 1.75 && !caught) { caught = true; onCatch(); }
  }

  function reset() {
    catching = false; caught = false;
    closeupFill.value = 0;
    if (fade) fade.style.opacity = '0';
    if (state === 'catch') vanish();
    cooldown = 22;
  }

  function take(player) {
    if (!drop.resting || drop.taken) return false;
    if (Math.hypot(knife.position.x - player.x, knife.position.z - player.z) > 2) return false;
    drop.taken = true; drop.active = false;
    scene.remove(knife);
    return true;
  }

  return {
    update, frame, strike, take, reset,
    get catching() { return catching; },
    get canTake() { return drop.resting && !drop.taken; },
    knife, knifeGrip, root, actions,
    state: () => ({
      state, visible: root.visible, x: pos.x, y: pos.y, z: pos.z, distance, perched, clear, glanced, watching,
      seen: seenMeter, health, hops, climbs, freezes, spotted, cooldown, dagger: drop.taken ? 'taken' : drop.resting ? 'ground' : drop.active ? 'falling' : 'hand',
      daggerPos: drop.active ? { x: knife.position.x, y: knife.position.y, z: knife.position.z } : null,
      tree: tree ? { x: tree.x, z: tree.z, height: tree.height } : null, sounds: Object.keys(buffers).length,
      played: playCount, recent: played.slice(), audio: audio.context?.state ?? 'none',
    }),
    // Test hooks (?dev): put him somewhere and run a behaviour.
    debug: {
      spawn(player) { nightTime = 99; cooldown = 0; return spawn(player); },
      perchAt(x, z, player) {
        let best = null, bd = 1e9;
        near(x, z, 15, (t, d) => { if (d < bd) { bd = d; best = t; } });
        if (!best) return false;
        tree = best; show(true); perchSpot(tree, player.x - tree.x, player.z - tree.z, pos); faceTo(player.x, player.z, true); perch(); return true;
      },
      groundAt(x, z) { show(true); pos.set(x, altitude(x, z), z); stalk(); },
      climbAt(x, z, player) {
        let best = null, bd = 1e9;
        near(x, z, 15, (t, d) => { if (d < bd) { bd = d; best = t; } });
        if (!best) return false;
        tree = best; show(true); perchSpot(tree, player.x - tree.x, player.z - tree.z, to, .72); pos.set(to.x, altitude(to.x, to.z), to.z); faceTo(tree.x, tree.z, true); startClimb(); return true;
      },
      hop(player) { const n = bestNeighbour(player, false); if (n) leapTo(n.tree, n.spot, 'leap'); return !!n; },
      catch(player) { startCatch(player); },
      kill(origin) { health = 1; wound(origin); },
      flee(player) { flee(player); },
      blind(value) { blind = value; },
      freeze(value) { frozen = value; },
      set(next) { setState(next); },
    },
  };
}
