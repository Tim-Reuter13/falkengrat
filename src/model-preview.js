import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { birdParts, createBirdRig, poseBird } from './birds.js';
import { makeTree } from './forest.js';
import { rockGeometry, rockMaterial } from './landscape.js';
import { logGeometry, rootTube } from './wood.js';
import { clamp, mix, smooth, TAU } from './math.js';
import { adaptClips, clipKey } from './cannibal/clips.js';

// Model preview: every creature, item and prop of the game in its own studio scene,
// with orbit camera, animation player, wireframe, skeleton, metre grid and statistics.
// It has its own renderer and canvas and loads its own copies, so the game is untouched.

const CLIP_NAMES = {
  k2_stalk: 'Pirsch (Keyframe)', k2_watch: 'Lauern (Keyframe)', k2_perch: 'Tierhocke (Keyframe)', k2_leap: 'Sprung (Keyframe)',
  k2_scream: 'Angriff (Keyframe)', k2_peek: 'Spähen hinter dem Stamm (Keyframe)',
  k_stalk: 'Anpirschen (Kriechen)', k_run: 'Rennen', k_climb: 'Klettern (Mocap-Basis)', k_leap: 'Sprung',
  k_scream: 'Schrei-Angriff', k_perch: 'Hocken und Beobachten', f_death_fall: 'Tod',
};

export function createModelPreview({ assetUrls, textures }) {
  const loader = new GLTFLoader();
  const gltf = {};
  const loadGlb = key => gltf[key] ??= loader.loadAsync(assetUrls[key]);

  // ---------- materials the game builds in code (own copies, so wireframe never leaks into the game)
  const bark = () => new T.MeshPhysicalMaterial({ map: textures.bark, normalMap: textures.barkNormal, normalScale: new T.Vector2(.58, .58), roughness: .99, specularIntensity: .17 });
  const endgrain = () => new T.MeshPhysicalMaterial({ map: textures.endgrain, normalMap: textures.endgrainNormal, normalScale: new T.Vector2(.53, .53), roughness: .92, specularIntensity: .15 });
  function treeModel(species, height) {
    const geo = makeTree(species);
    const wood = new T.MeshPhysicalMaterial({ map: textures.bark, roughness: 1, specularIntensity: .13, normalMap: textures.barkNormal, normalScale: new T.Vector2(.94, .94) });
    const leaves = new T.MeshPhysicalMaterial({ map: textures.sprig, alphaTest: .40, vertexColors: true, side: T.DoubleSide, roughness: .89,
      color: new T.Color().setRGB(.67, 1.10, .72), specularIntensity: .14 });
    const g = new T.Group();
    g.add(new T.Mesh(geo.trunk, wood), new T.Mesh(geo.leaves, leaves));
    g.scale.setScalar(height);
    return g;
  }
  function lying(mesh) { mesh.rotation.z = Math.PI / 2; const g = new T.Group(); g.add(mesh); return g; }

  // ---------- the catalogue
  const catalogue = [
    { id: 'kannibale', group: 'Lebewesen', name: 'Kannibale', view: 25,
      note: 'Pixal3D-Modell, gerigged auf das Mocap-Skelett des Animation Studios. Im Spiel kommen Fuß-IK, Klettergriffe, Sprungbahn und Kopfblick prozedural dazu.',
      async build() {
        const [m, d] = await Promise.all([loadGlb('cannibal'), loadGlb('boneDagger')]);
        const object = cloneRig(m.scene);
        const bone = n => object.getObjectByName('mixamorig' + n);
        const hand = bone('RightHand'), thumb = bone('RightHandThumb1'), middle = bone('RightHandMiddle1');
        if (hand && thumb && middle) {
          const grip = new T.Group(); grip.add(cloneRig(d.scene)); hand.add(grip);
          const fingers = middle.position.clone().normalize(), side = thumb.position.clone().normalize();
          grip.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), side.addScaledVector(fingers, -side.dot(fingers)).normalize());
          grip.position.copy(fingers).multiplyScalar(middle.position.length() * .62);
        }
        // The same clips as in the game: keyframe clips first, old mocap clips only where no
        // keyframe clip has taken their role (rennen, klettern, tod).
        const sources = await Promise.all(Object.keys(assetUrls).filter(k => k.startsWith('clip/')).sort().map(loadGlb));
        const keyframes = adaptClips(m, sources);
        const roles = new Set(keyframes.map(c => clipKey(c.name)));
        const all = [...keyframes, ...m.animations.filter(c => !roles.has(clipKey(c.name)))];
        return { object, clips: all.map(c => ({ name: CLIP_NAMES[c.name] ?? c.name, clip: c })) };
      } },
    { id: 'vogel', group: 'Lebewesen', name: 'Rabe', view: -150,
      note: 'Aus Ovalen und Federfächern gebaut. Flügelschlag, Gleiten und Kopfbewegung sind prozedural, mit denselben Gelenken wie im Spiel.',
      async build() {
        const rig = createBirdRig();
        const material = new T.MeshPhysicalMaterial({ map: textures.feathers, vertexColors: true, side: T.DoubleSide, roughness: .85, specularIntensity: .27 });
        birdParts().forEach((geo, i) => rig.parts[i].add(new T.Mesh(geo, material)));
        for (const p of rig.parts) p.isBone = true;   // lets the skeleton overlay draw the joints
        const pose = (t, spread, wingbeat, glide, legs) => poseBird(rig, { time: t, phase: 0, spread, wingbeat, glide, legs });
        const object = new T.Group(); object.add(rig.bird); rig.bird.position.y = .16;
        return { object, clips: [
          { name: 'Sitzen (Kopf dreht sich)', duration: 8, apply: t => { rig.bird.rotation.set(.13, 0, 0); pose(t, 0, 0, 0, 1); } },
          { name: 'Auffliegen', duration: 3, apply: t => {
            const spread = smooth(0, .24, t), legs = 1 - smooth(.1, .51, t);
            const wingbeat = Math.sin(t * TAU * mix(6, 4.15, smooth(.65, 3.8, t)) + 1.35);
            rig.bird.rotation.set(mix(.13, -.35, spread), 0, 0); pose(t, spread, wingbeat, 0, legs); } },
          { name: 'Flügelschlag', duration: 2, apply: t => { rig.bird.rotation.set(-.1, 0, 0); pose(t, 1, Math.sin(t * TAU * 3.25), 0, 0); } },
          { name: 'Gleiten', duration: 6, apply: t => {
            const glide = smooth(-.32, .68, Math.sin(t * .91 * TAU / 5.7));
            rig.bird.rotation.set(0, 0, .25 + .18 * Math.sin(t * .36 * TAU / 2.3)); pose(t, 1, Math.sin(t * TAU * 3.25), glide, 0); } },
        ] };
      } },
    { id: 'hand', group: 'Ausrüstung', name: 'Hand mit Handschuh', view: 30,
      note: 'Gewichtetes GLB-Mesh mit beweglichem Handgelenk (Knochen „Unterarm“). Im Spiel richtet es sich zum Ellbogen aus.',
      async build() { const m = await loadGlb('hand'); return { object: cloneRig(m.scene), clips: [] }; } },
    { id: 'schwert', group: 'Ausrüstung', name: 'Schwert', view: 30,
      note: 'Polierte Klinge mit Farb-, Normal-, Rauheits- und Metalltextur. Im Spiel spiegelt sie eine Umgebungs-Cubemap.',
      async build() { const m = await loadGlb('sword'); return { object: cloneRig(m.scene), clips: [] }; } },
    { id: 'viewmodel', group: 'Ausrüstung', name: 'Hand mit Schwert', view: 30,
      note: 'So hält die Spielfigur das Schwert in der Ego-Ansicht.',
      async build() { const [h, s] = await Promise.all([loadGlb('hand'), loadGlb('sword')]); const g = new T.Group(); g.add(cloneRig(h.scene), cloneRig(s.scene)); return { object: g, clips: [] }; } },
    { id: 'dolch', group: 'Ausrüstung', name: 'Knochendolch', view: 40,
      note: 'Pixal3D-Modell aus einem Referenzbild. Der Kannibale trägt ihn und lässt ihn beim Tod fallen.',
      async build() { const m = await loadGlb('boneDagger'); return { object: cloneRig(m.scene), clips: [] }; } },
    { id: 'tanne', group: 'Natur', name: 'Tanne', view: 20, note: '3D-Stamm mit Ästen und gekreuzten Zweigkarten. In der Ferne ersetzen Impostor-Karten den Baum.',
      async build() { return { object: treeModel(0, 18), clips: [] }; } },
    { id: 'fichte', group: 'Natur', name: 'Fichte', view: 20, note: 'Zweite Baumart mit längeren, hängenden Ästen.',
      async build() { return { object: treeModel(1, 18), clips: [] }; } },
    { id: 'fels', group: 'Natur', name: 'Felsblock', view: 30, at: [70, -150],
      note: 'Verformter Ikosaeder mit Schichtung. Granit, Kalk und Moos werden im Weltraum triplanar aufgetragen.',
      async build() { const m = new T.Mesh(rockGeometry(8421, 5), rockMaterial(textures)); m.scale.set(1.9, 1.1, 1.4); m.position.y = .5; const g = new T.Group(); g.add(m); return { object: g, clips: [] }; } },
    { id: 'kiesel', group: 'Natur', name: 'Kiesel', view: 30, at: [72, -152],
      note: 'Kleine Steine nutzen eine gröbere Geometrie (Detailstufe 1).',
      async build() { const m = new T.Mesh(rockGeometry(8421 + 3 * 64, 1), rockMaterial(textures)); m.scale.set(.25, .14, .2); m.position.y = .06; const g = new T.Group(); g.add(m); return { object: g, clips: [] }; } },
    { id: 'stumpf', group: 'Natur', name: 'Baumstumpf', view: 30, note: 'Übungsziel an der ersten Wegmarke. Rinde und Stirnholz mit Jahresringen.',
      async build() { const m = new T.Mesh(logGeometry(.385, .51, 1.31, 1.7), [bark(), endgrain(), endgrain()]); m.position.y = .655; const g = new T.Group(); g.add(m); return { object: g, clips: [] }; } },
    { id: 'treibholz', group: 'Natur', name: 'Treibholz', view: 30, note: 'Liegt im Bach und erzeugt Wellen und Schaum.',
      async build() { return { object: lying(new T.Mesh(logGeometry(.188, .246, 3.54, 2.4), [bark(), endgrain(), endgrain()])), clips: [] }; } },
    { id: 'stamm', group: 'Natur', name: 'Umgestürzter Stamm', view: 30, note: 'Verwitterter Stamm mit gesplitterten Enden.',
      async build() { return { object: lying(new T.Mesh(logGeometry(.2, .48, 7.5, 1.3, true), [bark(), endgrain(), endgrain()])), clips: [] }; } },
    { id: 'wurzel', group: 'Natur', name: 'Freiliegende Wurzeln', view: 30, note: 'Gebogene Wurzelröhren mit Verzweigungen, wie am Fuß großer Bäume.',
      async build() {
        const roots = [];
        for (let j = 0; j < 5; j++) {
          const a = j * TAU / 5 + .3, len = 2.2 + (j % 3) * .5, dx = Math.cos(a), dz = Math.sin(a);
          const route = [new T.Vector3(0, .26, 0)];
          for (let k = 1; k <= 5; k++) { const t = k / 5, across = .35 * Math.sin(t * Math.PI); route.push(new T.Vector3(dx * len * t + dz * across, mix(.02, -.08, t) + .06 * Math.sin(t * 7 + j), dz * len * t - dx * across)); }
          roots.push(rootTube(route, .2, j));
          const fork = route[2], v = new T.Vector3(fork.x + dx * .9 - dz * .65, -.04, fork.z + dz * .9 + dx * .65);
          roots.push(rootTube([fork, fork.clone().lerp(v, .59), v], .08, j + 1));
        }
        const g = new T.Group(); for (const r of roots) g.add(new T.Mesh(r, bark()));
        return { object: g, clips: [] };
      } },
  ];

  // ---------- DOM
  const root = document.createElement('div');
  root.id = 'fg-models'; root.className = 'fgm'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'fgm-title');
  const groups = [...new Set(catalogue.map(c => c.group))];
  root.innerHTML = `
    <aside class="fgm-list" aria-label="Modelle">
      <header><h2 id="fgm-title">Model Preview</h2><button type="button" class="fgm-close" aria-label="Model Preview schließen">×</button></header>
      ${groups.map(g => `<section><h3>${g}</h3>${catalogue.filter(c => c.group === g).map(c =>
        `<button type="button" data-model="${c.id}" aria-pressed="false">${c.name}</button>`).join('')}</section>`).join('')}
    </aside>
    <main class="fgm-stage">
      <canvas class="fgm-canvas" aria-label="3D-Ansicht"></canvas>
      <div class="fgm-caption"><strong class="fgm-name"></strong><span class="fgm-note"></span></div>
      <div class="fgm-loading" hidden>Wird geladen</div>
      <div class="fgm-hint">Linke Maustaste drehen · Rad zoomen · Rechte Maustaste verschieben · R Ansicht zurücksetzen</div>
      <div class="fgm-anim" hidden>
        <select class="fgm-clip" aria-label="Animation"></select>
        <button type="button" class="fgm-play" aria-label="Abspielen" aria-pressed="true"><i aria-hidden="true"></i></button>
        <input class="fgm-scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Zeitleiste">
        <output class="fgm-time">0,00 s</output>
        <label class="fgm-speed-label">Tempo <input class="fgm-speed" type="range" min="0.1" max="2" step="0.05" value="1" aria-label="Tempo"><output class="fgm-speed-value">1,00×</output></label>
      </div>
    </main>
    <aside class="fgm-side">
      <section><h3>Info</h3><dl class="fgm-info"></dl></section>
      <section><h3>Anzeige</h3>
        <label class="fgm-toggle"><input type="checkbox" data-show="grid" checked><span>Bodenraster mit Maßstab</span></label>
        <label class="fgm-toggle"><input type="checkbox" data-show="wire"><span>Gittermodell</span></label>
        <label class="fgm-toggle"><input type="checkbox" data-show="skeleton"><span>Skelett</span></label>
        <label class="fgm-toggle"><input type="checkbox" data-show="spin"><span>Automatisch drehen</span></label>
      </section>
      <section class="fgm-buttons"><button type="button" class="fgm-reset">Ansicht zurücksetzen</button></section>
    </aside>`;
  document.body.appendChild(root);
  const $ = s => root.querySelector(s);
  const canvas = $('.fgm-canvas'), stage = $('.fgm-stage');
  const ui = { name: $('.fgm-name'), note: $('.fgm-note'), loading: $('.fgm-loading'), anim: $('.fgm-anim'), clip: $('.fgm-clip'),
    play: $('.fgm-play'), scrub: $('.fgm-scrub'), time: $('.fgm-time'), speed: $('.fgm-speed'), speedValue: $('.fgm-speed-value'), info: $('.fgm-info') };
  const toggles = Object.fromEntries([...root.querySelectorAll('[data-show]')].map(i => [i.dataset.show, i]));

  // ---------- 3D
  let renderer, scene, camera, controls, grid, shadow, skeletonHelper = null;
  const world = new T.Group();
  function init() {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = new T.Scene();
    const pmrem = new T.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    scene.environmentIntensity = .5;
    scene.add(new T.HemisphereLight('#cfd9e6', '#3a3428', .75));
    const key = new T.DirectionalLight('#fff1dc', 2.3); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -.0004; key.shadow.normalBias = .02;
    const rim = new T.DirectionalLight('#a9bdf2', 1.1);
    scene.add(key, key.target, rim);
    scene.userData.key = key; scene.userData.rim = rim;
    shadow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShadowMaterial({ opacity: .32 }));
    shadow.rotation.x = -Math.PI / 2; shadow.receiveShadow = true;
    scene.add(world, shadow);
    camera = new T.PerspectiveCamera(38, 1, .01, 500);
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = .09; controls.autoRotateSpeed = 1.6;
  }

  // ---------- current model
  const cache = new Map();
  let current = null, mixer = null, clips = [], clip = null, action = null, time = 0, playing = true, speed = 1, scrubbing = false;
  const box = new T.Box3(), size = new T.Vector3(), centre = new T.Vector3();
  const fmt = (v, d = 2) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

  async function select(id) {
    const entry = catalogue.find(c => c.id === id) ?? catalogue[0];
    for (const b of root.querySelectorAll('[data-model]')) b.setAttribute('aria-pressed', String(b.dataset.model === entry.id));
    ui.name.textContent = entry.name; ui.note.textContent = entry.note;
    ui.loading.hidden = false;
    let built = cache.get(entry.id);
    if (!built) {
      try { built = await entry.build(); }
      catch (error) { ui.loading.textContent = 'Konnte nicht geladen werden'; console.error(error); return; }
      built.object.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
      cache.set(entry.id, built);
    }
    ui.loading.hidden = true;
    if (current?.entry === entry) return;
    world.clear();
    if (skeletonHelper) { scene.remove(skeletonHelper); skeletonHelper.dispose?.(); skeletonHelper = null; }
    const holder = new T.Group();
    holder.position.set(entry.at?.[0] ?? 0, 0, entry.at?.[1] ?? 0);   // rocks shade by world position: keep them on dry ground
    holder.add(built.object);
    world.add(holder);
    current = { entry, built, holder };
    // animation
    mixer = null; action = null; clip = null; time = 0;
    clips = built.clips;
    if (clips.length) {
      if (clips.some(c => c.clip)) mixer = built.mixer ??= new T.AnimationMixer(built.object);
      mixer?.stopAllAction();
      ui.clip.innerHTML = clips.map((c, i) => `<option value="${i}">${c.name}</option>`).join('');
      ui.anim.hidden = false;
      chooseClip(0);
    } else ui.anim.hidden = true;
    // Measure rigged models in their rest pose (standing height), others in the first clip pose.
    let skinned = false; built.object.traverse(o => { if (o.isSkinnedMesh) { skinned = true; o.skeleton.pose(); } });
    if (!skinned) applyClipTime();
    built.object.updateMatrixWorld(true);
    box.setFromObject(built.object, true);
    built.restPose = skinned;
    // Frame the camera on every pose the clips reach (spread wings, the fall), not just the first.
    const frameBox = box.clone();
    if (clips.length) {
      const keep = clips.indexOf(clip), probe = new T.Box3();
      clips.forEach((c, i) => {
        chooseClip(i);
        for (let k = 0; k < 6; k++) { time = duration() * k / 6; applyClipTime(); probe.setFromObject(built.object, true); frameBox.union(probe); }
      });
      chooseClip(Math.max(0, keep));
    } else if (skinned) applyClipTime();
    built.frameSize = frameBox.getSize(new T.Vector3()); built.frameCentre = frameBox.getCenter(new T.Vector3()); built.frameBase = frameBox.min.y;
    box.getSize(size); box.getCenter(centre);
    built.size = size.clone(); built.centre = centre.clone(); built.base = box.min.y;
    // skeleton
    const hasBones = (() => { let n = 0; built.object.traverse(o => { if (o.isBone) n++; }); return n; })();
    toggles.skeleton.disabled = !hasBones;
    toggles.skeleton.parentElement.classList.toggle('fgm-off', !hasBones);
    if (hasBones) { skeletonHelper = new T.SkeletonHelper(built.object); skeletonHelper.material.depthTest = false; skeletonHelper.material.color.set('#e7c886'); skeletonHelper.renderOrder = 10; scene.add(skeletonHelper); }
    setupStage();
    applyToggles();
    writeInfo(entry, built, hasBones);
    resetView();
    try { localStorage.setItem('falkengrat-preview', entry.id); } catch {}
  }

  function niceStep(v) {
    const steps = [.01, .02, .05, .1, .25, .5, 1, 2, 5, 10];
    return steps.find(s => s >= v) ?? 10;
  }
  function setupStage() {
    const { built, holder } = current;
    const s = built.size, extent = Math.max(s.x, s.z, s.y * .6);
    const cell = niceStep(extent / 4);
    const cells = Math.max(6, Math.ceil(extent * 2.4 / cell));
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    grid = new T.GridHelper(cell * cells, cells, '#d3b480', '#6c7564');
    grid.material.transparent = true; grid.material.opacity = .55; grid.material.depthWrite = false;
    grid.position.set(holder.position.x + built.centre.x, built.base + .001, holder.position.z + built.centre.z);
    scene.add(grid);
    shadow.scale.setScalar(cell * cells * 1.2);
    shadow.position.set(grid.position.x, built.base + .0005, grid.position.z);
    current.cell = cell;
    const key = scene.userData.key, rim = scene.userData.rim, r = Math.max(s.x, s.y, s.z);
    const c = new T.Vector3(holder.position.x + built.centre.x, built.base, holder.position.z + built.centre.z);
    key.position.copy(c).add(new T.Vector3(r * 1.4, r * 2.2, r * 1.8)); key.target.position.copy(c);
    const cam = key.shadow.camera; cam.left = cam.bottom = -r * 1.3; cam.right = cam.top = r * 1.3; cam.near = r * .1; cam.far = r * 6; cam.updateProjectionMatrix();
    rim.position.copy(c).add(new T.Vector3(-r * 1.6, r * 1.3, -r * 2));
  }

  function writeInfo(entry, built, bones) {
    let tris = 0, verts = 0;
    const textures = new Map(), materials = new Set();
    built.object.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      verts += g.attributes.position.count;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
          const t = m[k]; const img = t?.image;
          if (img && img.width) textures.set(t, [img.width, img.height, k]);
        }
        if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u?.value?.isTexture && u.value.image?.width) textures.set(u.value, [u.value.image.width, u.value.image.height, 'Shader']);
      }
    });
    // rock textures sit in shader uniforms added at compile time
    if (entry.id === 'fels' || entry.id === 'kiesel') for (const k of ['granite', 'limestone', 'moss', 'rockNormal']) { const t = textures_[k]; if (t?.image) textures.set(t, [t.image.width, t.image.height, k]); }
    const list = [...textures.values()];
    const biggest = list.reduce((m, t) => t[0] * t[1] > m[0] * m[1] ? t : m, [0, 0]);
    const s = built.size;
    const rows = [
      [built.restPose ? 'Größe in Ruhepose (B × T × H)' : 'Größe (B × T × H)', `${fmt(s.x)} × ${fmt(s.z)} × ${fmt(s.y)} m`],
      ['Raster', `${fmt(current.cell, current.cell < .1 ? 2 : current.cell < 1 ? 2 : 0)} m pro Feld`],
      ['Dreiecke', Math.round(tris).toLocaleString('de-DE')],
      ['Eckpunkte', verts.toLocaleString('de-DE')],
      ['Materialien', String(materials.size)],
      ['Texturen', list.length ? `${list.length}, größte ${biggest[0]} × ${biggest[1]}` : 'keine (Vertexfarben)'],
      ['Knochen', bones ? String(bones) : '—'],
      ['Animationen', built.clips.length ? String(built.clips.length) : '—'],
    ];
    ui.info.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  }
  const textures_ = textures;

  function resetView() {
    if (!current) return;
    const { built, holder, entry } = current;
    const s = built.frameSize ?? built.size, c = built.frameCentre ?? built.centre;
    const radius = Math.max(.05, Math.hypot(s.x, s.y, s.z) * .5);
    const target = new T.Vector3(holder.position.x + c.x, c.y, holder.position.z + c.z);
    // Fit into the narrower of the two fields of view (the stage is often taller than wide).
    const vHalf = T.MathUtils.degToRad(camera.fov * .5), hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    const dist = radius / Math.sin(Math.min(vHalf, hHalf)) * 1.08;
    const az = T.MathUtils.degToRad(entry.view ?? 30), el = T.MathUtils.degToRad(14);
    camera.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(az) * Math.cos(el) * dist);
    camera.near = Math.max(.005, dist / 200); camera.far = dist * 40; camera.updateProjectionMatrix();
    controls.target.copy(target);
    controls.minDistance = radius * .2; controls.maxDistance = dist * 6;
    controls.update();
  }

  // ---------- animation player
  function chooseClip(i) {
    clip = clips[i]; time = 0;
    if (mixer) {
      mixer.stopAllAction(); action = null;
      if (clip.clip) { action = mixer.clipAction(clip.clip); action.setLoop(T.LoopRepeat, Infinity); action.play(); }
    }
    ui.clip.value = String(i);
    applyClipTime();
  }
  const duration = () => clip ? (clip.clip?.duration ?? clip.duration) : 0;
  function applyClipTime() {
    if (!clip) return;
    if (clip.clip && action) { action.time = time; mixer.update(0); }
    else if (clip.apply) clip.apply(time);
    current?.built.object.updateMatrixWorld(true);
  }
  function showTime() {
    const d = duration();
    if (!scrubbing) ui.scrub.value = String(d ? Math.round(time / d * 1000) : 0);
    ui.time.value = `${fmt(time)} / ${fmt(d)} s`;
  }
  function setPlaying(value) {
    playing = value;
    ui.play.setAttribute('aria-pressed', String(playing));
    ui.play.setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
    ui.play.classList.toggle('paused', !playing);
  }

  // ---------- toggles
  function applyToggles() {
    if (!current) return;
    if (grid) grid.visible = toggles.grid.checked;
    shadow.visible = true;
    current.built.object.traverse(o => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m.wireframe = toggles.wire.checked; }
    });
    if (skeletonHelper) skeletonHelper.visible = toggles.skeleton.checked;
    controls.autoRotate = toggles.spin.checked;
  }

  // ---------- loop
  let frame = 0, last = 0, open = false;
  function resize() {
    const w = Math.max(2, stage.clientWidth), h = Math.max(2, stage.clientHeight);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function loop(now) {
    if (!open) return;
    frame = requestAnimationFrame(loop);
    const dt = Math.min(.1, last ? (now - last) / 1000 : 0); last = now;
    if (clip && playing && !scrubbing) {
      time += dt * speed;
      const d = duration();
      if (d > 0) time %= d;
      applyClipTime();
    }
    showTime();
    controls.update();
    renderer.render(scene, camera);
  }

  function show(id) {
    if (!renderer) init();
    root.hidden = false; open = true;
    document.body.classList.add('fgm-open');
    resize();
    let saved = null; try { saved = localStorage.getItem('falkengrat-preview'); } catch {}
    select(id ?? current?.entry.id ?? saved ?? 'kannibale');
    last = 0; cancelAnimationFrame(frame); frame = requestAnimationFrame(loop);
    root.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true }) ?? $('.fgm-close').focus();
  }
  let opener = null;
  function hide() {
    open = false; root.hidden = true; cancelAnimationFrame(frame);
    document.body.classList.remove('fgm-open');
    opener?.focus?.({ preventScroll: true });
  }

  // ---------- events
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-model]');
    if (b) select(b.dataset.model);
  });
  $('.fgm-close').addEventListener('click', hide);
  $('.fgm-reset').addEventListener('click', resetView);
  for (const t of Object.values(toggles)) t.addEventListener('change', applyToggles);
  ui.clip.addEventListener('change', () => chooseClip(Number(ui.clip.value)));
  ui.play.addEventListener('click', () => setPlaying(!playing));
  ui.speed.addEventListener('input', () => { speed = Number(ui.speed.value); ui.speedValue.value = fmt(speed) + '×'; });
  ui.scrub.addEventListener('input', () => { scrubbing = true; time = Number(ui.scrub.value) / 1000 * duration(); applyClipTime(); });
  ui.scrub.addEventListener('change', () => { scrubbing = false; });
  ui.scrub.addEventListener('pointerup', () => { scrubbing = false; });
  window.addEventListener('resize', () => { if (open) resize(); });
  // Keys belong to the preview while it is open (the game and menu never see them).
  window.addEventListener('keydown', e => {
    if (!open) return;
    if (e.target.closest?.('select, input[type="range"]') && !['Escape', 'KeyR'].includes(e.code)) { e.stopPropagation(); return; }
    if (e.code === 'Escape') { e.preventDefault(); hide(); }
    else if (e.code === 'KeyR') resetView();
    else if (e.code === 'Space' && clip && !e.target.closest?.('button')) { e.preventDefault(); setPlaying(!playing); }
    e.stopPropagation();
  }, true);

  return {
    open(id, from) { opener = from ?? document.activeElement; show(id); },
    close: hide,
    get isOpen() { return open; },
    catalogue: catalogue.map(c => ({ id: c.id, name: c.name, group: c.group })),
    select,
    // test hooks
    state: () => current && ({
      id: current.entry.id, size: current.built.size.toArray().map(v => +v.toFixed(3)), clips: clips.map(c => c.name), clip: clip?.name ?? null,
      time: +time.toFixed(3), playing, speed, info: [...ui.info.querySelectorAll('div')].map(d => d.textContent),
      wire: toggles.wire.checked, skeleton: toggles.skeleton.checked, skeletonAvailable: !toggles.skeleton.disabled, grid: toggles.grid.checked,
      camera: camera.position.toArray().map(v => +v.toFixed(2)),
    }),
    play: value => setPlaying(value), setSpeed: v => { ui.speed.value = String(v); ui.speed.dispatchEvent(new Event('input')); },
    clip: i => chooseClip(i), seek: s => { time = s; applyClipTime(); showTime(); },
    toggle: (name, value) => { toggles[name].checked = value; applyToggles(); },
    resetView,
    renderStats() {
      resize(); controls.update(); renderer.render(scene, camera);
      const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let n = 0, x0 = w, x1 = 0, y0 = h, y1 = 0, lum = 0;
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        if (px[i + 3] > 200) { n++; lum += px[i] + px[i + 1] + px[i + 2]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
      const total = (w / 2) * (h / 2);
      return { w, h, filled: +(n / total).toFixed(3), box: n ? [+(x0 / w).toFixed(2), +(y0 / h).toFixed(2), +(x1 / w).toFixed(2), +(y1 / h).toFixed(2)] : null, meanRgb: n ? Math.round(lum / n / 3) : 0 };
    },
  };
}
