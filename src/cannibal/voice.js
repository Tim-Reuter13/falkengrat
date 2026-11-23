import * as T from 'three';

// Localisable 3D sound for the cannibal. Every voice is a short, dry, mono recording that
// goes through: gain -> air low-pass (distance) -> occlusion gain + low-pass -> HRTF panner.
// The panner follows its source every frame, occlusion is ray-tested from the listener.
const AIR_REF = 14;            // every 14 m halves the low-pass cutoff (air absorption, ground effect)
export function airCutoff(distance) { return T.MathUtils.clamp(19000 * Math.pow(.5, distance / AIR_REF), 700, 19000); }

export function createVoice({ audio, camera, sounds, occlusion }) {
  const buffers = {};
  let decoding = false;
  const voices = [];
  const listenerPos = new T.Vector3(), listenerFwd = new T.Vector3(), tmp = new T.Vector3();
  let playCount = 0;
  const recent = [];

  function decode() {
    if (decoding || !audio.context) return;
    decoding = true;
    for (const [name, url] of Object.entries(sounds)) {
      fetch(url).then(r => r.arrayBuffer()).then(data => audio.context.decodeAudioData(data))
        .then(buffer => { buffers[name] = buffer; }).catch(() => {});
    }
  }

  function setPanner(panner, p, t) {
    panner.positionX.setValueAtTime(p.x, t); panner.positionY.setValueAtTime(p.y, t); panner.positionZ.setValueAtTime(p.z, t);
  }

  // source: a Vector3 (fixed point) or a function returning the current world position.
  function play(name, source, { volume = 1, rate = 1, ref = 1.6, direct = false } = {}) {
    const ctx = audio.context, buffer = buffers[name];
    if (!ctx || !buffer || ctx.state !== 'running') return null;
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.playbackRate.value = rate;
    const gain = ctx.createGain(); gain.gain.value = volume;
    src.connect(gain);
    playCount++; recent.push(name); if (recent.length > 16) recent.shift();
    if (direct || !source) { gain.connect(audio.output); src.start(); return { src }; }
    const air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.Q.value = .5;
    const shade = ctx.createGain();
    const muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.Q.value = .4;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
    panner.refDistance = ref; panner.rolloffFactor = 1; panner.maxDistance = 250;
    gain.connect(air).connect(muffle).connect(shade).connect(panner).connect(audio.output);
    const voice = { src, air, shade, muffle, panner, source, occluded: 0, nextRay: 0, name, pos: new T.Vector3() };
    const p = typeof source === 'function' ? source(voice.pos) : voice.pos.copy(source);
    // Start with the right filters so the very first transient is already placed.
    const t = ctx.currentTime, d = p.distanceTo(camera.position);
    voice.occluded = occlusion(camera.position, p);
    applyFilters(voice, d, t, true);
    setPanner(panner, p, t);
    src.onended = () => { const i = voices.indexOf(voice); if (i >= 0) voices.splice(i, 1); };
    voices.push(voice);
    src.start();
    return voice;
  }

  function applyFilters(voice, distance, t, instant) {
    const cutoff = airCutoff(distance) * (1 - voice.occluded * .6);
    const level = 1 - voice.occluded * .45;
    if (instant) {
      voice.air.frequency.setValueAtTime(Math.max(cutoff, 350), t);
      voice.muffle.frequency.setValueAtTime(voice.occluded > .05 ? Math.max(1400, 6500 * (1 - voice.occluded * .75)) : 20000, t);
      voice.shade.gain.setValueAtTime(level, t);
    } else {
      voice.air.frequency.setTargetAtTime(Math.max(cutoff, 350), t, .04);
      voice.muffle.frequency.setTargetAtTime(voice.occluded > .05 ? Math.max(1400, 6500 * (1 - voice.occluded * .75)) : 20000, t, .04);
      voice.shade.gain.setTargetAtTime(level, t, .04);
    }
  }

  function update(dt, now) {
    decode();
    const ctx = audio.context, l = ctx?.listener;
    if (!l || !l.positionX) return;
    camera.getWorldDirection(listenerFwd);
    listenerPos.copy(camera.position);
    const t = ctx.currentTime;
    l.positionX.setValueAtTime(listenerPos.x, t); l.positionY.setValueAtTime(listenerPos.y, t); l.positionZ.setValueAtTime(listenerPos.z, t);
    l.forwardX.setValueAtTime(listenerFwd.x, t); l.forwardY.setValueAtTime(listenerFwd.y, t); l.forwardZ.setValueAtTime(listenerFwd.z, t);
    l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    for (const voice of voices) {
      const p = typeof voice.source === 'function' ? voice.source(voice.pos) : voice.pos;
      setPanner(voice.panner, p, t);
      if (now >= voice.nextRay) {
        voice.nextRay = now + .1;
        voice.occluded = occlusion(listenerPos, p);
      }
      applyFilters(voice, p.distanceTo(listenerPos), t, false);
    }
  }

  // Offline measurement of what the ear gets: left/right level per direction, the low-pass
  // per distance and the occlusion damping. Runs the same node graph in an OfflineAudioContext.
  async function measure(name = 'kannibale-knacken-1') {
    const buffer = buffers[name];
    if (!buffer) return { error: 'sound not decoded yet: ' + name };
    const rate = 44100, length = Math.ceil((buffer.duration + .1) * rate);
    async function render(x, y, z, occluded = 0) {
      const off = new OfflineAudioContext(2, length, rate);
      const l = off.listener;
      l.positionX.value = 0; l.positionY.value = 0; l.positionZ.value = 0;
      l.forwardX.value = 0; l.forwardY.value = 0; l.forwardZ.value = -1; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
      const src = off.createBufferSource(); src.buffer = buffer;
      const air = off.createBiquadFilter(); air.type = 'lowpass'; air.Q.value = .5;
      const muffle = off.createBiquadFilter(); muffle.type = 'lowpass'; muffle.Q.value = .4;
      const shade = off.createGain();
      const d = Math.hypot(x, y, z);
      air.frequency.value = Math.max(350, airCutoff(d) * (1 - occluded * .6));
      muffle.frequency.value = occluded > .05 ? Math.max(1400, 6500 * (1 - occluded * .75)) : 20000;
      shade.gain.value = 1 - occluded * .45;
      const pan = off.createPanner();
      pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1.6; pan.rolloffFactor = 1;
      pan.positionX.value = x; pan.positionY.value = y; pan.positionZ.value = z;
      src.connect(air).connect(muffle).connect(shade).connect(pan).connect(off.destination);
      src.start();
      const out = await off.startRendering();
      const stats = ch => {
        const data = out.getChannelData(ch);
        let sum = 0, hi = 0, prev = 0;
        for (let i = 0; i < data.length; i++) { sum += data[i] * data[i]; const dd = data[i] - prev; hi += dd * dd; prev = data[i]; }
        return { rms: 10 * Math.log10(sum / data.length + 1e-12), bright: 10 * Math.log10(hi / (sum + 1e-12) + 1e-12) };
      };
      const L = stats(0), R = stats(1);
      return { left: +L.rms.toFixed(1), right: +R.rms.toFixed(1), ild: +(R.rms - L.rms).toFixed(1), brightness: +((L.bright + R.bright) / 2).toFixed(1) };
    }
    const directions = {};
    for (const [label, deg] of [['vorn', 0], ['vorn-rechts', 45], ['rechts', 90], ['hinten-rechts', 135], ['hinten', 180], ['hinten-links', 225], ['links', 270], ['vorn-links', 315]]) {
      const a = deg * Math.PI / 180;
      directions[label] = await render(Math.sin(a) * 6, 0, -Math.cos(a) * 6);
    }
    const distances = {};
    for (const d of [3, 10, 20, 35]) distances[d + ' m'] = { ...(await render(d * .7071, 0, -d * .7071)), cutoff: Math.round(airCutoff(d)) };
    const occlusionTest = { frei: await render(7, 0, -7), 'hinter Stamm': await render(7, 0, -7, 1) };
    return { sound: name, directions, distances, occlusion: occlusionTest };
  }

  return {
    play, update, measure,
    get decoded() { return Object.keys(buffers).length; },
    get playing() { return voices.map(v => v.name); },
    get count() { return playCount; },
    recent,
  };
}
