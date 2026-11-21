(() => {
  const menu = document.getElementById('menu');
  if (!menu?.classList.contains('fg-menu')) return;

  const profiles = {
    neutral: { brightness: 1, contrast: 1, saturation: 1, temperature: 0 },
    lcd: { brightness: .98, contrast: 1.09, saturation: 1.11, temperature: 8, raster: 'lcd', amount: .145 },
    ips: { brightness: 1.045, contrast: .97, saturation: 1.04, temperature: -6 },
    va: { brightness: .97, contrast: 1.13, saturation: 1.025, temperature: -.5 },
    oled: { brightness: 1.01, contrast: 1.18, saturation: 1.12, temperature: 1 },
    crt: { brightness: 1.11, contrast: 1.075, saturation: .88, temperature: 5, raster: 'crt', amount: .26 },
  };
  const defaults = { profile: 'neutral', strength: 100, brightness: 0, contrast: 0, temperature: 0 };
  const key = 'falkengrat-menu-display-v1';
  const ranges = [...menu.querySelectorAll('input[data-fg-key]')];
  const radios = [...menu.querySelectorAll('input[name="fg-display-profile"]')];
  const sceneLayers = [document.getElementById('game'), document.querySelector('.fg-poster')];
  const tone = document.getElementById('fg-display-tone');
  const texture = document.getElementById('fg-screen-texture');
  const options = document.getElementById('fg-options');
  const settings = document.getElementById('fg-settings');
  const close = document.getElementById('fg-close');
  const compare = document.getElementById('fg-compare');
  const tabs = [...menu.querySelectorAll('[role="tab"]')];
  const panelFor = tab => document.getElementById(tab.getAttribute('aria-controls'));
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  let state = { ...defaults };
  let comparing = false;

  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && Object.hasOwn(profiles, saved.profile)) state.profile = saved.profile;
    for (const range of ranges) {
      const field = range.dataset.fgKey;
      if (Number.isFinite(saved?.[field])) state[field] = clamp(saved[field], +range.min, +range.max);
    }
  } catch {
    // The preview also runs from a file URL with storage blocked.
  }

  function applyDisplay() {
    const profile = profiles[state.profile];
    const intensity = comparing ? 0 : state.strength / 100;
    const brightness = comparing ? 1 : 1 + (profile.brightness - 1) * intensity + state.brightness / 100;
    const contrast = comparing ? 1 : 1 + (profile.contrast - 1) * intensity + state.contrast / 100;
    const saturation = 1 + (profile.saturation - 1) * intensity;
    const degrees = comparing ? 0 : profile.temperature * intensity + state.temperature;
    const neutral = brightness === 1 && contrast === 1 && saturation === 1;
    const filter = neutral ? '' :
      `saturate(${saturation.toFixed(3)}) contrast(${contrast.toFixed(3)}) brightness(${brightness.toFixed(3)})`;
    for (const layer of sceneLayers) layer.style.filter = filter;
    tone.hidden = degrees === 0;
    const warmth = Math.min(.88, Math.abs(degrees) * .034);
    tone.style.backgroundColor = degrees > 0 ? `rgba(255, 237, 208, ${warmth})` : `rgba(206, 232, 255, ${warmth})`;
    texture.dataset.screen = intensity && profile.raster ? profile.raster : '';
    texture.style.setProperty('--fg-raster', (intensity * (profile.amount ?? 0)).toFixed(3));
    compare.setAttribute('aria-pressed', String(comparing));
  }

  function updateInputs() {
    for (const radio of radios) radio.checked = radio.value === state.profile;
    for (const range of ranges) {
      const field = range.dataset.fgKey;
      const value = state[field];
      range.value = value;
      range.style.setProperty('--fg-fill', ((value - +range.min) / (+range.max - +range.min) * 100) + '%');
      const output = document.getElementById(range.id + '-value');
      output.value = field === 'strength' ? value + ' %' : (value > 0 ? '+' : '') + value;
      if (field === 'temperature') range.setAttribute('aria-valuetext', value === 0 ? 'Neutral' : `${Math.abs(value)} ${value < 0 ? 'kühler' : 'wärmer'}`);
    }
    applyDisplay();
  }

  function save() {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }

  for (const radio of radios) radio.addEventListener('change', () => {
    state.profile = radio.value;
    comparing = false;
    updateInputs();
    save();
  });
  for (const range of ranges) {
    range.addEventListener('input', () => {
      state[range.dataset.fgKey] = range.valueAsNumber;
      comparing = false;
      updateInputs();
    });
    range.addEventListener('change', save);
  }
  compare.addEventListener('click', () => {
    comparing = !comparing;
    applyDisplay();
  });
  document.getElementById('fg-reset').addEventListener('click', () => {
    state = { ...defaults };
    comparing = false;
    updateInputs();
    save();
  });
  document.getElementById('play').addEventListener('click', () => {
    if (comparing) { comparing = false; applyDisplay(); }
  });

  function selectTab(selected, focus) {
    tabs.forEach(tab => {
      const active = tab === selected;
      tab.tabIndex = active ? 0 : -1;
      tab.setAttribute('aria-selected', String(active));
      panelFor(tab).hidden = !active;
    });
    if (focus) selected.focus();
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      const choices = {
        ArrowLeft: (i + tabs.length - 1) % tabs.length,
        ArrowRight: (i + 1) % tabs.length,
        Home: 0, End: tabs.length - 1,
      };
      if (!(event.key in choices)) return;
      event.preventDefault();
      selectTab(tabs[choices[event.key]], true);
    });
  });

  function showSettings(visible, focus = false) {
    settings.hidden = !visible;
    options.setAttribute('aria-expanded', String(visible));
    if (!visible && comparing) { comparing = false; applyDisplay(); }
    if (!focus) return;
    if (visible) tabs.find(tab => tab.getAttribute('aria-selected') === 'true').focus();
    else options.focus();
  }

  options.addEventListener('click', () => showSettings(settings.hidden, true));
  close.addEventListener('click', () => showSettings(false, true));
  settings.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.body.classList.contains('playing')) {
      event.preventDefault();
      showSettings(false, true);
    }
  });

  showSettings(!matchMedia('(max-width: 760px)').matches);
  updateInputs();
})();
