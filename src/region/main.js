import * as T from 'three';
import { clamp } from '../math.js';
import { createTouchControls } from '../touch-controls.js';
import { bounds, sites, groundHeight, parcels } from './layout.js';
import { createRegionScene } from './scene.js';
import { drawPlan } from './plan.js';

const $ = id => document.getElementById(id);
const canvas = $('region'), dialog = $('map'), plan = $('plan');
const resume = $('resume'), hud = document.querySelector('.hud');
const forestLink = document.querySelector('.forest-entry');
const travel = [...document.querySelectorAll('[data-site]')];
const position = new T.Vector3(sites.town.x, 0, sites.town.z);

function choosePlan(visible) {
  $('art').hidden = visible;
  plan.hidden = !visible;
  $('art-tab').setAttribute('aria-pressed', String(!visible));
  $('plan-tab').setAttribute('aria-pressed', String(visible));
  if (visible) drawPlan(plan, position);
}
$('art-tab').addEventListener('click', () => choosePlan(false));
$('plan-tab').addEventListener('click', () => choosePlan(true));
dialog.showModal();
dialog.addEventListener('cancel', event => event.preventDefault());

function playRegion() {
  const renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(1.35, window.devicePixelRatio || 1));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .91;
  const view = new T.PerspectiveCamera(65, 1, .14, 11000);
  const scene = new T.Scene();
  const region = createRegionScene(scene);
  const rotation = new T.Euler(0, 0, 0, 'YXZ');
  const down = new Set();
  let playing = false, touchX = 0, touchZ = 0, yaw = 0, pitch = 0, drag = null;
  let vx = 0, vz = 0, last = performance.now(), redraw = true, locationAt = 0;
  let canEnterForest = false;
  const touch = createTouchControls(canvas, {
    isActive: () => playing,
    move: (x, z) => { touchX = x; touchZ = z; },
    look: (x, y) => look(x * 2.4, y * 2.4),
    tap: () => {},
  });

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    view.aspect = innerWidth / Math.max(1, innerHeight);
    view.fov = touch.enabled ? 78 : 65;
    view.updateProjectionMatrix();
    redraw = true;
  }
  function look(dx, dy) {
    yaw -= clamp(dx, -180, 180) * .00215;
    pitch = clamp(pitch - clamp(dy, -180, 180) * .00215, -1.42, 1.42);
  }
  function place(site) {
    position.set(site.x, groundHeight(site.x, site.z), site.z);
    yaw = site.yaw; pitch = 0; vx = vz = 0;
    view.position.copy(position);
    view.position.y += 1.68;
    region.update(position.x, position.z, true);
    redraw = true;
  }
  function resetInput() {
    down.clear();
    touch.reset();
    drag = null;
    vx = vz = 0;
  }
  function openMap() {
    if (!playing) return;
    playing = false;
    resetInput();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    document.body.classList.remove('playing');
    hud.hidden = true; forestLink.hidden = true;
    if (!plan.hidden) drawPlan(plan, position);
    if (!dialog.open) dialog.showModal();
  }
  function start() {
    if (touch.enabled && !touch.portrait.matches) {
      $('controls').textContent = 'Dreh dein Handy zum Erkunden ins Hochformat.';
      return;
    }
    playing = true;
    resetInput();
    if (dialog.open) dialog.close();
    document.body.classList.add('playing');
    hud.hidden = false;
    locationAt = 0;
    if (!touch.enabled) {
      try { canvas.requestPointerLock()?.catch(() => {}); } catch { /* Drag look remains available. */ }
    }
  }

  function collides(x, z) {
    if (Math.abs(x) > 450 || Math.abs(z) > 170) return false;
    return region.solids.some(body => Math.abs(x - body.x) < body.w * .5 + .31 &&
      Math.abs(z - body.z) < body.d * .5 + .31);
  }
  function advance(dt) {
    const side = Number(down.has('KeyD') || down.has('ArrowRight')) - Number(down.has('KeyA') || down.has('ArrowLeft')) + touchX;
    const forward = Number(down.has('KeyW') || down.has('ArrowUp')) - Number(down.has('KeyS') || down.has('ArrowDown')) + touchZ;
    const speed = down.has('ShiftLeft') || down.has('ShiftRight') ? 8.6 : 3.45;
    const pace = speed / Math.max(1, Math.hypot(side, forward));
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const response = 1 - Math.exp(-dt * 10);
    vx += ((c * side - s * forward) * pace - vx) * response;
    vz += ((-s * side - c * forward) * pace - vz) * response;
    const moveX = vx * dt, moveZ = vz * dt;
    if (Math.hypot(moveX, moveZ) < .00004) return;
    const x = clamp(position.x + moveX, bounds.west + 2, bounds.east - 2);
    const z = clamp(position.z + moveZ, bounds.north + 2, bounds.south - 2);
    if (!collides(x, position.z) && groundHeight(x, position.z) < position.y + Math.abs(moveX) * 1.15 + .20) {
      position.x = x;
    }
    if (!collides(position.x, z) && groundHeight(position.x, z) < position.y + Math.abs(moveZ) * 1.15 + .20) {
      position.z = z;
    }
    position.y = groundHeight(position.x, position.z);
    view.position.x = position.x; view.position.z = position.z;
    view.position.y += (position.y + 1.68 - view.position.y) * (1 - Math.exp(-dt * 15));
  }
  function showLocation() {
    const entries = Object.values(sites);
    let nearest = entries[0], distance = Infinity;
    for (const site of entries) {
      const gap = Math.hypot(position.x - site.x, position.z - site.z);
      if (gap < distance) { distance = gap; nearest = site; }
    }
    const range = distance < 1000 ? Math.round(distance) + ' m' : (distance / 1000).toFixed(1).replace('.', ',') + ' km';
    $('location').textContent = distance < 120 ? nearest.name : nearest.name + ' · ' + range;
    canEnterForest = distance < 45 && (nearest === sites.trailhead || nearest === sites.lookout);
    forestLink.hidden = !playing || !canEnterForest;
  }

  window.addEventListener('resize', resize);
  window.addEventListener('blur', resetInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) openMap(); });
  touch.portrait.addEventListener('change', () => { if (touch.enabled && !touch.portrait.matches) openMap(); });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && playing) openMap();
  });
  resume.addEventListener('click', start);
  $('open-map').addEventListener('click', openMap);
  for (const button of travel) {
    button.addEventListener('click', () => { place(sites[button.dataset.site]); start(); });
  }
  window.addEventListener('keydown', event => {
    if (!playing) return;
    if (event.code === 'KeyM' || event.code === 'Escape') { event.preventDefault(); openMap(); return; }
    if (event.code === 'Enter' && canEnterForest) { location.href = forestLink.firstElementChild.href; return; }
    if (event.code.startsWith('Arrow')) event.preventDefault();
    down.add(event.code);
  });
  window.addEventListener('keyup', event => down.delete(event.code));
  canvas.addEventListener('pointerdown', event => {
    if (!playing || event.pointerType !== 'mouse' || event.button !== 0 || document.pointerLockElement) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!playing || event.pointerType !== 'mouse') return;
    if (document.pointerLockElement === canvas) { look(event.movementX, event.movementY); return; }
    if (event.pointerId !== drag?.id) return;
    look(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX; drag.y = event.clientY;
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => { if (event.pointerId === drag?.id) drag = null; });
  }

  if (touch.enabled) $('controls').textContent = 'Hochkant spielen · Links laufen · Rechts wischen';
  place(sites.town);
  resize();
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(.05, (now - last) * .001);
    last = now;
    if (playing) {
      advance(dt);
      if (now >= locationAt) { showLocation(); locationAt = now + 240; }
    }
    const queued = region.stats().queued;
    if (!playing && !redraw && !queued) return;
    region.update(position.x, position.z);
    rotation.set(pitch, yaw, 0);
    view.quaternion.setFromEuler(rotation);
    region.sky.position.copy(view.position);
    renderer.render(scene, view);
    redraw = false;
  }
  requestAnimationFrame(loop);
  if (new URLSearchParams(location.search).has('dev')) {
    window.falkengratRegion = {
      state: () => ({
        x: position.x, y: position.y, z: position.z, playing, ...region.stats(),
        houses: parcels().filter(plot => plot.kind === 'house').length,
        calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      }),
    };
  }
}

try {
  playRegion();
} catch (error) {
  console.error(error);
  resume.disabled = true;
  for (const button of travel) button.disabled = true;
  $('render-error').hidden = false;
}
