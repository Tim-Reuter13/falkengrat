const DEAD_ZONE = 8;
const STICK_TRAVEL = 34;
const LOOK_THRESHOLD = 7;

export function createTouchControls(canvas, { isActive, move, look, tap }) {
  const enabled = matchMedia('(pointer: coarse)').matches;
  const portrait = matchMedia('(orientation: portrait)');
  document.body.classList.toggle('touch-mode', enabled);

  const stick = document.getElementById('touch-stick');
  let walking = null;
  let looking = null;

  function releaseStick() {
    const pointer = walking?.id;
    walking = null;
    stick.classList.remove('engaged');
    stick.style.removeProperty('--stick-x');
    stick.style.removeProperty('--stick-y');
    move(0, 0);
    if (pointer != null && stick.hasPointerCapture(pointer)) stick.releasePointerCapture(pointer);
  }

  function releaseLook() {
    const pointer = looking?.id;
    looking = null;
    if (pointer != null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
  }

  function reset() {
    if (!enabled) return;
    releaseStick();
    releaseLook();
  }

  function accepting(event) {
    return isActive() && portrait.matches && event.pointerType === 'touch';
  }

  function steer(event) {
    const x = event.clientX - walking.x;
    const y = event.clientY - walking.y;
    const distance = Math.hypot(x, y);
    const angleX = distance ? x / distance : 0;
    const angleY = distance ? y / distance : 0;
    const travel = Math.min(distance, STICK_TRAVEL);
    const power = Math.max(0, (travel - DEAD_ZONE) / (STICK_TRAVEL - DEAD_ZONE));
    stick.style.setProperty('--stick-x', angleX * travel + 'px');
    stick.style.setProperty('--stick-y', angleY * travel + 'px');
    move(angleX * power, -angleY * power);
  }

  if (enabled) {
    stick.addEventListener('pointerdown', event => {
      if (!accepting(event) || walking) return;
      const bounds = stick.getBoundingClientRect();
      walking = {
        id: event.pointerId,
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      };
      stick.setPointerCapture(walking.id);
      stick.classList.add('engaged');
      steer(event);
    });
    stick.addEventListener('pointermove', event => {
      if (event.pointerId === walking?.id && accepting(event)) steer(event);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      stick.addEventListener(type, event => {
        if (event.pointerId === walking?.id) releaseStick();
      });
    }

    canvas.addEventListener('pointerdown', event => {
      if (!accepting(event) || looking || event.clientX < canvas.clientWidth / 2) return;
      looking = {
        id: event.pointerId, x: event.clientX, y: event.clientY,
        started: event.timeStamp, dragged: false,
      };
      canvas.setPointerCapture(looking.id);
    });
    canvas.addEventListener('pointermove', event => {
      if (event.pointerId !== looking?.id || !accepting(event)) return;
      const dx = event.clientX - looking.x;
      const dy = event.clientY - looking.y;
      if (!looking.dragged && Math.hypot(dx, dy) < LOOK_THRESHOLD) return;
      looking.dragged = true;
      looking.x = event.clientX;
      looking.y = event.clientY;
      look(dx, dy);
    });
    canvas.addEventListener('pointerup', event => {
      if (event.pointerId !== looking?.id) return;
      const shortTap = accepting(event) && !looking.dragged && event.timeStamp - looking.started < 300 &&
        Math.hypot(event.clientX - looking.x, event.clientY - looking.y) < LOOK_THRESHOLD;
      releaseLook();
      if (shortTap) tap();
    });
    for (const type of ['pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, event => {
        if (event.pointerId === looking?.id) releaseLook();
      });
    }
  }

  return { enabled, portrait, reset };
}
