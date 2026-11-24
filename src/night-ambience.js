import * as T from 'three';
import { clamp, mix, smooth } from './math.js';

// Night sound bed from real recordings (assets/sfx/nacht-*.mp3, CC0, see CREDITS.json):
// a cricket field played from four places around the listener and a tawny owl now and then.
// The crickets react like real ones: around something creeping through the grass they stop.
// Each of the four emitters goes quiet when the cannibal is near its side, so the silence has a
// direction ("the crickets to my left have stopped"); when he is close to the player the whole
// field holds its breath. Silence before the attack is the loudest sign.
const SIDES = [[0, 1], [1, 0], [0, -1], [-1, 0]];
export function createNightAmbience({ audio, camera, sounds }) {
  const buffers = {};
  let decoding = false, started = false, owlAt = 30, owlWait = 0;
  const emitters = [];
  const listener = new T.Vector3();
  const state = { level: 0, hush: [0, 0, 0, 0], owls: 0, quiet: 0 };

  function decode() {
    if (decoding || !audio.context) return;
    decoding = true;
    for (const name of ['nacht-grillen', 'nacht-kauz']) {
      if (!sounds[name]) continue;
      fetch(sounds[name]).then(r => r.arrayBuffer()).then(d => audio.context.decodeAudioData(d))
        .then(b => { buffers[name] = b; }).catch(() => {});
    }
  }
  function start() {
    const ctx = audio.context, buffer = buffers['nacht-grillen'];
    if (started || !ctx || !buffer) return;
    started = true;
    SIDES.forEach(([sx, sz], i) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer; src.loop = true;
      // mp3 encoder padding: loop inside the clean part
      src.loopStart = .06; src.loopEnd = buffer.duration - .06;
      src.playbackRate.value = 1 + (i - 1.5) * .012;      // four fields, not one copy
      const gain = ctx.createGain(); gain.gain.value = 0;
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 12; panner.rolloffFactor = .6;
      src.connect(gain).connect(panner).connect(audio.output);
      src.start(ctx.currentTime + .05, (i * 7.3) % buffer.duration);
      emitters.push({ sx, sz, gain, panner, hush: 0 });
    });
  }

  // night: 0..1, threat: the cannibal's position or null, presence: 0..1 how close he is to the player
  function update(dt, night, threat, presence) {
    const ctx = audio.context;
    if (!ctx || ctx.state !== 'running') return;
    decode();
    start();
    if (!started) return;
    const t = ctx.currentTime;
    listener.copy(camera.position);
    // The whole field holds its breath when he is close to the player (slow to return).
    state.quiet += ((presence > .55 ? 1 : 0) - state.quiet) * (1 - Math.exp(-dt / (presence > .55 ? 1.6 : 9)));
    state.level = night;
    emitters.forEach((e, i) => {
      const ex = listener.x + e.sx * 14, ez = listener.z + e.sz * 14;
      // Near him the crickets stop within a second or two and come back only slowly.
      const near = threat ? 1 - smooth(9, 24, Math.hypot(threat.x - ex, threat.z - ez)) : 0;
      e.hush += (near - e.hush) * (1 - Math.exp(-dt / (near > e.hush ? 1.2 : 7)));
      state.hush[i] = +e.hush.toFixed(2);
      const g = .55 * night * (1 - e.hush) * (1 - state.quiet * .92);
      e.gain.gain.setTargetAtTime(g, t, .25);
      e.panner.positionX.setValueAtTime(ex, t); e.panner.positionY.setValueAtTime(listener.y + 1, t); e.panner.positionZ.setValueAtTime(ez, t);
    });
    // A tawny owl far off, now and then - never while the field is silent.
    owlAt -= dt;
    if (owlAt <= 0) {
      owlAt = mix(45, 120, Math.random());
      if (night > .6 && state.quiet < .2 && buffers['nacht-kauz']) owl(t);
    }
  }
  function owl(t) {
    const ctx = audio.context;
    const src = ctx.createBufferSource(); src.buffer = buffers['nacht-kauz'];
    src.playbackRate.value = mix(.96, 1.04, Math.random());
    const a = Math.random() * Math.PI * 2, r = mix(45, 90, Math.random());
    const gain = ctx.createGain(); gain.gain.value = .7;
    const air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = clamp(19000 * Math.pow(.5, r / 14), 900, 19000);
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 20; panner.rolloffFactor = .5;
    panner.positionX.value = listener.x + Math.cos(a) * r; panner.positionY.value = listener.y + 10; panner.positionZ.value = listener.z + Math.sin(a) * r;
    src.connect(gain).connect(air).connect(panner).connect(audio.output);
    src.start(t);
    state.owls++;
  }
  return { update, state };
}
