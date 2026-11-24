import { clamp, mix } from '../math.js';

// The director knows where the player is; the cannibal does not. Like the macro AI in
// Alien: Isolation it shapes one arc of tension per night with a menace gauge:
//  - menace only grows while he is close, faster when the player can see or hear him
//  - near the peak (held too long, or too many close encounters) he is sent away to give the
//    player air; after the pause he is sent back towards the player's rough area
//  - he may only strike once tension has been built (time near, glimpses), never at once
//  - when he has lost the player for long, the director whispers a rough area (+-15 m)
//  - behaviours unlock from the player's habits (never from deaths)
export function createDirector(rand) {
  const d = {
    menace: 0,            // 0..1.2
    phase: 'build',       // build | peak | relax
    phaseTime: 0,
    relaxFor: 0,
    peaks: 0,
    tension: 0,           // accumulated suspense this cycle (allows the strike)
    encounters: 0,        // close calls this cycle
    hintAt: 25,
    hints: 0,
    unlocks: { ambushAhead: false, stare: false, darkSide: true, hitAndRun: false },
    habits: { runs: 0, torchSweeps: 0, swings: 0, lookBacks: 0 },
    log: [],
  };
  function note(what) { d.log.push(what); if (d.log.length > 20) d.log.shift(); }

  // sense: { distance, seenClarity, inView, heard, lit, active (he is out hunting), now, unseenFor }
  function update(dt, s) {
    d.phaseTime += dt;
    // Menace: closeness, being glimpsed, being in the beam.
    const near = clamp((26 - s.distance) / 22, 0, 1);
    let rise = near * .022 + (s.inView ? .06 : 0) + s.seenClarity * .18 + (s.lit ? .1 : 0);
    if (!s.active) rise = 0;
    const fall = s.distance > 30 ? .05 : .012;
    d.menace = clamp(d.menace + (rise - (rise > .002 ? 0 : fall)) * dt, 0, 1.2);
    if (s.active && near > 0) d.tension += dt * near * (s.inView ? 1.6 : 1);
    if (d.phase === 'build' && (d.menace > 1 || d.encounters >= 4)) {
      d.phase = 'peak'; d.phaseTime = 0; d.peaks++; note('peak');
    } else if (d.phase === 'peak' && d.phaseTime > mix(4, 9, rand())) {
      d.phase = 'relax'; d.phaseTime = 0; d.relaxFor = mix(35, 70, rand()); note('relax ' + Math.round(d.relaxFor) + ' s');
    } else if (d.phase === 'relax' && d.phaseTime > d.relaxFor) {
      d.phase = 'build'; d.phaseTime = 0; d.menace = .15; d.tension *= .5; d.encounters = 0; note('build');
    }
    if (d.phase === 'relax') d.menace = Math.max(0, d.menace - dt * .04);
    d.hintAt -= dt;
  }
  return {
    state: d,
    update,
    // Orders for the cannibal.
    get backOff() { return d.phase === 'relax'; },
    get leash() { return d.phase === 'peak' ? 30 : 0; },   // during the peak: stay round, do not close in further
    // Strike only after suspense: enough time close to the player, not during a pause.
    mayStrike(nightTime) { return d.phase === 'build' && nightTime > 50 && d.tension > 18; },
    encounter() { d.encounters++; note('encounter ' + d.encounters); },
    // A rough hint (the player's area) when the cannibal has lost track for long.
    hint(playerPos, unseenFor, beliefAge) {
      if (d.phase === 'relax' || d.hintAt > 0 || beliefAge < 22) return null;
      d.hintAt = mix(20, 40, rand()); d.hints++;
      const a = rand() * Math.PI * 2, r = mix(6, 15, rand());
      note('hint');
      return { x: playerPos.x + Math.cos(a) * r, z: playerPos.z + Math.sin(a) * r };
    },
    habit(kind) {
      const h = d.habits; h[kind] = (h[kind] ?? 0) + 1;
      if (!d.unlocks.ambushAhead && h.runs >= 3) { d.unlocks.ambushAhead = true; note('unlock: ambush ahead'); }
      if (!d.unlocks.stare && h.torchSweeps >= 6) { d.unlocks.stare = true; note('unlock: stare'); }
      if (!d.unlocks.hitAndRun && h.swings >= 4) { d.unlocks.hitAndRun = true; note('unlock: hit and run'); }
    },
    reset() { Object.assign(d, { menace: 0, phase: 'build', phaseTime: 0, tension: 0, encounters: 0, hintAt: 25 }); },
  };
}
