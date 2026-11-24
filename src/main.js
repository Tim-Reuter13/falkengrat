import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createBladeProbe } from './reflections.js';
import { createBirds } from './birds.js';
import assetUrls from 'game-assets';
import { altitude, clamp, overlook, pathX, riverBank, riverX, waterLevel } from './math.js';
import { createRiver } from './river.js';
import { placeDeadwood } from './wood.js';
import { createAnimalTraces, createHabitatPlants } from './ecology.js';
import { createStreamLife } from './stream-life.js';
import { createDayNight, createLighting, createPipeline, createSky, hazeColor, forestHaze, quadVertex } from './atmosphere.js';
import { createBeamVolume, createFlashlight } from './flashlight.js';
import { createRocks, createTerrain } from './landscape.js';
import { createMountainScenery } from './mountains.js';
import { bladesPerTuft, createForestFloor, createForestProps, createGrass } from './groundcover.js';
import { createForest, createUnderstory, exportTreeAtlas } from './forest.js';
import { createPlayer, createSound } from './player.js';
import { createTouchControls } from './touch-controls.js';
import { makeCollision } from './collision.js';
import { createSword } from './sword.js';
import { createAirEffects } from './vfx.js';
import { createCannibal } from './cannibal.js';
import { createNightAmbience } from './night-ambience.js';
import { adaptClips } from './cannibal/clips.js';
import { createModelPreview } from './model-preview.js';

const $ = id => document.getElementById(id);
const canvas=$('game'), play=$('play'), menu=$('menu'), subtitle=$('subtitle');
const qualityInput=$('quality'), metrics=$('metrics'), prompt=$('toast');
const sound=$('sound'), objective=$('objective'), guide=$('guide');
const urlOptions=new URLSearchParams(location.search);
const presets={
  speed: {name:'Performance',scale:.78,min:.49,treeNear:22,distance:360,plants:39,grass:31,grassNear:15,props:36,clouds:4,rays:14,rayScale:.24,shadows:false,ao:false},
  balanced: {name:'Ausgewogen',scale:1.0,min:.57,treeNear:34,distance:480,plants:51,grass:43,grassNear:23,props:56,clouds:6,rays:22,rayScale:.30,shadows:true,ao:true},
  high: {name:'Cinematic',scale:1.12,min:.68,treeNear:43,distance:560,plants:66,grass:54,grassNear:29,props:63,clouds:8,rays:30,rayScale:.36,shadows:true,ao:true},
};

function preference(key,value) {
  try {
    if(value!==undefined) localStorage.setItem(key,value);
    return localStorage.getItem(key);
  } catch { return null; }
}

async function loadTextures(renderer) {
  const loader = new T.TextureLoader();
  const mask = new Set(['fir','spruce','fern','sprig','alps','foothills','props','habitat','atlasFir','atlasSpruce','endgrain','endgrainNormal']);
  const data = new Set(['groundNormal','rockNormal','barkNormal','atlasFir','atlasSpruce','meadowNormal','limestoneNormal','endgrainNormal','soilNormals','foam']);
  const models3d=new Set(['hand','sword','cannibal','boneDagger']);
  const records=await Promise.all(Object.entries(assetUrls).filter(([key])=>!models3d.has(key)&&!key.startsWith('sfx/')&&!key.startsWith('clip/')).map(async ([key,url])=>{
    const tex=await loader.loadAsync(url);
    tex.colorSpace=data.has(key) ? T.NoColorSpace : T.SRGBColorSpace;
    tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    tex.wrapS=tex.wrapT=mask.has(key)?T.ClampToEdgeWrapping:T.RepeatWrapping;
    return [key,tex];
  }));
  const textures=Object.fromEntries(records);
  for(const key of ['soilSwatches','soilNormals']){
    const source=textures[key],image=source.image,tile=image.width/4;
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=tile;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    const pixels=new Uint8Array(tile*tile*4*8);
    for(let i=0;i<8;i++){
      context.setTransform(1,0,0,-1,0,tile);
      context.drawImage(image,i%4*tile,Math.floor(i/4)*tile,tile,tile,0,0,tile,tile);
      pixels.set(context.getImageData(0,0,tile,tile).data,i*tile*tile*4);
    }
    const array=new T.DataArrayTexture(pixels,tile,tile,8);
    array.colorSpace=source.colorSpace;array.wrapS=array.wrapT=T.RepeatWrapping;
    array.minFilter=T.LinearMipmapLinearFilter;array.magFilter=T.LinearFilter;
    array.generateMipmaps=true;array.anisotropy=source.anisotropy;array.needsUpdate=true;
    source.dispose();
    textures[key]=array;
  }
  return textures;
}

function buildTrailMarker(scene,text,x,z,bark) {
  const ground=altitude(x,z);
  const wood=new T.MeshStandardMaterial({color:0x887057,map:bark,roughness:.93});
  const post=new T.Mesh(new T.BoxGeometry(.12,1.65,.16),wood);
  post.position.set(x,ground+.73,z);
  post.rotation.z=.03;
  post.castShadow=true;
  const plank=new T.Mesh(new T.BoxGeometry(.91,.31,.064),wood);
  plank.position.set(x,ground+1.29,z+.138);
  plank.rotation.z=-.021;
  plank.castShadow=true;
  const texture=document.createElement('canvas');
  texture.width=384;texture.height=128;
  const c=texture.getContext('2d');
  c.clearRect(0,0,384,128);
  c.textAlign='center';c.textBaseline='middle';
  c.font='700 44px Georgia';
  c.fillStyle='#e6d2a6';
  c.fillText(text,192,66);
  const map=new T.CanvasTexture(texture);
  map.colorSpace=T.SRGBColorSpace;
  const type=new T.Mesh(new T.PlaneGeometry(.87,.29),new T.MeshLambertMaterial({map,transparent:true,depthWrite:false}));
  type.position.copy(plank.position);type.position.z+=.033;
  type.rotation.z=plank.rotation.z;
  scene.add(post,plank,type);
}

async function game() {
  const renderer=new T.WebGLRenderer({canvas,powerPreference:'high-performance',antialias:false,alpha:false});
  renderer.setPixelRatio(1);
  renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.09;
  renderer.setClearColor(hazeColor,1);
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=T.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate=false;
  renderer.shadowMap.needsUpdate=true;
  renderer.info.autoReset=false;
  const errors=[];
  renderer.debug.onShaderError=(gl,program,vert,frag)=>{
    const error=[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vert),gl.getShaderInfoLog(frag)].filter(Boolean).join('\n');
    errors.push(error);
    console.error('Falkengrat Shader',error);
  };
  const scene=new T.Scene();
  const fog=new T.FogExp2(hazeColor,forestHaze);
  scene.fog=fog;
  const camera=new T.PerspectiveCamera(63,1,.075,3400);
  scene.add(camera);
  const models=new GLTFLoader();
  const [textures,hand,blade,cannibalModel,daggerModel]=await Promise.all([loadTextures(renderer),models.loadAsync(assetUrls.hand),models.loadAsync(assetUrls.sword),
    models.loadAsync(assetUrls.cannibal),models.loadAsync(assetUrls.boneDagger)]);
  // Keyframe clips from the Animation Studio replace the cannibal's old mocap clips by role.
  const clipSources=await Promise.all(Object.keys(assetUrls).filter(k=>k.startsWith('clip/')).sort().map(k=>models.loadAsync(assetUrls[k])));
  cannibalModel.animations.push(...adaptClips(cannibalModel,clipSources));
  const collision=makeCollision(),audio=createSound();
  const player=createPlayer(camera,collision,audio);
  const clock={value:0};
  const updateSky=createSky(scene);
  const updateLight=createLighting(scene);
  const dayNight=createDayNight(renderer,fog);
  const timeInput=$('timeofday');
  function setNight(value,instant=false){
    dayNight.set(value,instant);
    if(timeInput)timeInput.value=value?'night':'day';
    preference('falkengrat-time',value?'night':'day');
  }
  setNight(preference('falkengrat-time')==='night',true);
  timeInput?.addEventListener('change',()=>setNight(timeInput.value==='night'));
  const pipe=createPipeline(renderer);
  // Hand torch (F, mouse wheel = focus) with its volumetric beam.
  const flashlight=createFlashlight({scene,camera,collision});
  pipe.volume=createBeamVolume(flashlight,quadVertex);
  createMountainScenery(scene,textures);
  const {perches,contacts,waterObstacles}=createRocks(scene,textures,collision);
  const forest=createForest(scene,renderer,textures,collision,clock);
  const deadwood=placeDeadwood(scene,textures,collision);
  waterObstacles.push(...deadwood.wakes);
  const river=createRiver(clock,waterObstacles,textures.foam);
  const probe=createBladeProbe(renderer,scene,river);
  const floor=createForestFloor(collision,contacts);
  createTerrain(scene,textures,floor);
  const setPlantDistance=createUnderstory(scene,textures,clock,floor);
  const updateGrass=createGrass(scene,floor,clock,pipe.groundImage);
  const updateProps=createForestProps(scene,textures,floor);
  const habitat=createHabitatPlants(scene,textures,floor,clock,pipe.plantLight,river.uniforms.probePass);
  const animalTraces=createAnimalTraces(scene,textures);
  const streamLife=createStreamLife(scene,clock);
  const air=createAirEffects(clock,forest.trees,river.uniforms);
  pipe.overlay=air.scene;pipe.postOverlay=air.postScene;
  buildTrailMarker(scene,'Falkengrat',pathX(-24)-2.75,-24,textures.bark);
  buildTrailMarker(scene,'Aussicht',overlook.x+2.75,overlook.z-1.8,textures.bark);
  const birds=createBirds(scene,textures,perches,collision,audio);
  // Layer 3 = what casts shadows in the torch light: every real shadow caster (not the invisible
  // canopy silhouettes made for the sun) plus the near trunks and crowns (layer 3 only).
  camera.layers.enable(3);
  scene.traverse(o=>{if(o.castShadow&&o.material&&o.material.colorWrite!==false)o.layers.enable(3);});
  flashlight.light.shadow.camera.layers.set(3);
  const sfx=Object.fromEntries(Object.entries(assetUrls).filter(([key])=>key.startsWith('sfx/')).map(([key,url])=>[key.slice(4),url]));
  const cannibal=createCannibal({scene,camera,collision,audio,trees:forest.trees,model:cannibalModel,dagger:daggerModel,sounds:sfx,
    isNight:()=>dayNight.night,onCatch:()=>caught(),flashlight});
  // Crickets and an owl at night (real recordings); they fall silent around the cannibal.
  const nightSounds=createNightAmbience({audio,camera,sounds:sfx});
  let nightLevel=0;
  // Settings > Modelle: every creature, item and prop in its own 3D viewer.
  const modelPreview=createModelPreview({assetUrls,textures});
  $('fg-open-models')?.addEventListener('click',event=>modelPreview.open(undefined,event.currentTarget));

  let toastTime=0;
  function toast(text,seconds=2.3) {
    prompt.textContent=text;
    prompt.classList.add('shown');
    toastTime=seconds;
  }
  let practiceHit=false;
  const sword=createSword(camera,scene,collision,audio,type=>{
    if(type==='stump'&&!practiceHit){
      practiceHit=true;
      toast('Übungstreffer');
    }
  },{hand:hand.scene,sword:blade.scene},probe,[cannibal]);
  const calm=$('calm');
  const savedMotion=preference('falkengrat-calm');
  calm.checked=savedMotion===null?matchMedia('(prefers-reduced-motion: reduce)').matches:savedMotion==='true';
  function setCalm(){
    const amount=calm.checked?0:1;
    player.motion(amount);
    sword.motion(amount);
  }
  setCalm();
  calm.addEventListener('change',()=>{setCalm();preference('falkengrat-calm',String(calm.checked));});

  let active=false, photo=false, locked=false, lookDrag=false, awaitingLock=false, dragDistance=0;
  const touchPause=$('touch-pause');
  const touch=createTouchControls(canvas,{
    isActive: ()=>active,
    move: player.steer,
    look: (dx,dy)=>player.look(dx,dy,2.4),
    tap: ()=>{if(!photo)sword.attack();},
  });
  const desktopFov=camera.fov;
  let last=performance.now(), lastDraw=0, elapsed=0, frameCount=0, realTime=0, sampledFPS=0;
  let sampleWindow=0, windowFrames=0, reached=false, framesRendered=0;
  let qualityKey=preference('falkengrat-quality')||'balanced';
  if(!Object.hasOwn(presets,qualityKey))qualityKey='balanced';
  qualityInput.value=qualityKey;
  let quality=presets[qualityKey];
  let scale=quality.scale;
  let viewportWidth=1,viewportHeight=1;
  let lastCalls=0,lastTriangles=0;
  let debug=false;
  function resize() {
    viewportWidth=Math.max(2,window.innerWidth);
    viewportHeight=Math.max(2,window.innerHeight);
    camera.aspect=viewportWidth/viewportHeight;
    camera.fov=touch.enabled&&touch.portrait.matches?78:desktopFov;
    camera.updateProjectionMatrix();
    pipe.resize(viewportWidth,viewportHeight,scale,quality.rayScale);
  }
  function changeQuality(value){
    qualityKey=Object.hasOwn(presets,value)?value:'balanced';
    quality=presets[qualityKey];
    qualityInput.value=qualityKey;
    scale=quality.scale;windowFrames=0;sampleWindow=0;
    renderer.shadowMap.needsUpdate=true;
    preference('falkengrat-quality',qualityKey);
    resize();
  }
  function setPhoto(value) {
    photo=value;
    document.body.classList.toggle('photo',photo);
    sword.block(false);
    sword.show(!photo);
  }
  function pause() {
    active=false;lookDrag=false;awaitingLock=false;
    touch.reset();
    sword.block(false);
    if(document.pointerLockElement===canvas)document.exitPointerLock();
    player.keys.clear();
    audio.suspend();
    document.body.classList.remove('playing');
    play.querySelector('span').textContent='Weiter erkunden';
    subtitle.textContent='Dein Standort bleibt erhalten.';
    play.focus({preventScroll:true});
  }
  const death=$('death');
  let dead=false;
  function caught(){
    dead=true;active=false;
    touch.reset();
    sword.block(false);player.keys.clear();
    document.body.classList.remove('playing');
    document.body.classList.add('dead');
    if(document.pointerLockElement===canvas)document.exitPointerLock();
    death.hidden=false;
    $('death-again').focus({preventScroll:true});
  }
  function revive(){
    dead=false;death.hidden=true;
    document.body.classList.remove('dead');
    cannibal.reset();
    player.enterTrail();
    launch();
  }
  $('death-again').addEventListener('click',revive);
  let lockEnabled=true,firstEntry=true;
  function launch() {
    if(touch.enabled&&!touch.portrait.matches)return;
    if(firstEntry){player.enterTrail();firstEntry=false;}
    active=true;
    touch.reset();
    setPhoto(false);
    document.body.classList.add('playing');
    audio.start();
    canvas.focus({preventScroll:true});
    if(touch.enabled||!lockEnabled||document.pointerLockElement===canvas||!canvas.requestPointerLock)return;
    awaitingLock=true;
    try {
      const result=canvas.requestPointerLock();
      if(result?.catch)result.catch(()=>{
        lockEnabled=false;awaitingLock=false;
        if(active)toast('Zum Umsehen Maus ziehen',3.8);
      });
    }catch{
      lockEnabled=false;awaitingLock=false;
      toast('Zum Umsehen Maus ziehen',3.8);
    }
  }

  document.addEventListener('pointerlockchange',()=>{
    const wasLocked=locked;
    locked=document.pointerLockElement===canvas;
    awaitingLock=false;
    if(wasLocked&&!locked&&active)pause();
  });
  document.addEventListener('pointerlockerror',()=>{
    if(!awaitingLock)return;
    lockEnabled=false;awaitingLock=false;
    if(active)toast('Zum Umsehen Maus ziehen',3.8);
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&active)pause();
    last=performance.now();
  });
  window.addEventListener('blur',()=>{player.keys.clear();sword.block(false);lookDrag=false;touch.reset();});
  touch.portrait.addEventListener('change',()=>{
    if(active&&touch.enabled&&!touch.portrait.matches)pause();
  });
  touchPause.addEventListener('click',()=>{if(active)pause();});
  window.addEventListener('resize',resize);
  play.addEventListener('click',launch);
  qualityInput.addEventListener('change',()=>changeQuality(qualityInput.value));
  let muted=preference('falkengrat-muted')==='true';
  if(muted)audio.toggle();
  function showAudio(){
    sound.textContent=muted?'Ton aus':'Ton an';
    sound.setAttribute('aria-pressed',String(!muted));
  }
  function toggleSound(){muted=audio.toggle();preference('falkengrat-muted',String(muted));showAudio();}
  sound.addEventListener('click',toggleSound);
  showAudio();
  window.addEventListener('keydown',event=>{
    if(event.code==='F3') {event.preventDefault();if(!event.repeat){debug=!debug;metrics.hidden=!debug;}return;}
    if(!active||(event.target===touchPause&&event.code==='Space'))return;
    if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape'].includes(event.code))event.preventDefault();
    if(event.code==='Space'){if(!event.repeat)player.jump();return;}
    if(event.code==='Escape'&&!event.repeat){pause();return;}
    if(event.code==='KeyP'&&!event.repeat){setPhoto(!photo);return;}
    if(event.code==='KeyM'&&!event.repeat){toggleSound();toast(muted?'Ton aus':'Ton an');return;}
    if(event.code==='KeyN'&&!event.repeat){setNight(!dayNight.night);toast(dayNight.night?'Nacht':'Tag');return;}
    if(event.code==='KeyF'&&!event.repeat){flashlight.toggle();return;}
    if(event.code==='KeyE'&&!event.repeat){if(cannibal.take(player.ground))toast('Knochendolch aufgehoben',3);return;}
    if(['Digit1','Digit2','Digit3'].includes(event.code)&&!event.repeat){
      changeQuality(['speed','balanced','high'][Number(event.code.slice(-1))-1]);
      toast(quality.name);return;
    }
    player.keys.add(event.code);
  });
  window.addEventListener('keyup',e=>player.keys.delete(e.code));
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  // Mouse wheel turns the torch head (flood <-> spot).
  window.addEventListener('wheel',event=>{if(!active||!flashlight.on)return;event.preventDefault();flashlight.wheel(event.deltaY);},{passive:false});
  canvas.addEventListener('pointerdown',event=>{
    if(!active||event.pointerType==='touch')return;
    if(event.button===2){sword.block(!photo);return;}
    if(event.button!==0||photo&&locked)return;
    if(locked)sword.attack();
    else {
      lookDrag=true;dragDistance=0;
      canvas.setPointerCapture(event.pointerId);
    }
  });
  document.addEventListener('pointermove',event=>{
    if(!active||event.pointerType==='touch'||(!locked&&!lookDrag))return;
    dragDistance+=Math.abs(event.movementX)+Math.abs(event.movementY);
    player.look(event.movementX,event.movementY);
  });
  document.addEventListener('pointerup',event=>{
    if(event.pointerType==='touch')return;
    if(event.button===2)sword.block(false);
    if(event.button===0&&lookDrag){
      if(dragDistance<5&&active&&!photo)sword.attack();
      lookDrag=false;
    }
  });
  canvas.addEventListener('lostpointercapture',event=>{if(event.pointerType!=='touch')lookDrag=false;});
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault(); if(active)pause();
    play.disabled=true;play.querySelector('span').textContent='Grafikkontext verloren';
    subtitle.textContent='Lade die Seite neu, um weiterzuspielen.';
  });
  window.addEventListener('pagehide',()=>{touch.reset();audio.suspend();});
  resize();

  // The source build can regenerate the exact PNG impostors it ships with.
  if(urlOptions.has('dev')){
    window.falkengrat={
      get ready(){return framesRendered>0;}, errors,
      state:()=>({x:player.ground.x,y:player.ground.y,z:player.ground.z,fps:sampledFPS,quality:qualityKey,
        scale,locked,active,reached,practiceHit,weaponVisible:sword.visible,cubeCaptures:probe.captures,
        models:sword.rig.children.map(model=>model.getObjectsByProperty('isMesh',true).length),birds:birds.state(),
        waterDepth:riverBank(player.ground.x,player.ground.z)<0?Math.max(0,waterLevel(player.ground.z)-player.ground.y):0,
        calls:lastCalls,triangles:lastTriangles,trees:forest.count}),
      riverX,
      birdHomes:birds.homes,
      waterEffects:river.stats,
      ecology:()=>({bladesPerTuft,rootSites:deadwood.rootSites,fallen:deadwood.fallen,species:habitat.counts,
        ...animalTraces,driftingLeaves:streamLife.leaves,midgeGroups:streamLife.midgeGroups}),
      atlas:()=>exportTreeAtlas(renderer,forest.targets),
      place:(x,z,heading,tilt)=>player.place(x,z,heading,tilt),
      night:value=>setNight(value,true),
      nightSounds:nightSounds.state,cannibal:{state:cannibal.state,...Object.fromEntries(Object.entries(cannibal.debug).map(([k,f])=>[k,(...a)=>f(...a,player.ground)]))},
      look:(heading,tilt)=>player.place(player.ground.x,player.ground.z,heading,tilt),
      // Fixed-step logic without rendering: scripted player (each(t) may move/turn him),
      // used to test the cannibal's behaviour fast and reproducibly.
      simulate:(seconds,each,step=1/60)=>{
        const out=[];
        for(let t=0;t<seconds;t+=step){
          const r=each?.(t,step);
          if(r==='stop')break;
          for(let i=0;i<2;i++)player.update(step/2,!cannibal.catching);
          dayNight.update(step);
          camera.updateMatrixWorld();
          flashlight.update(step,{bob:0,stride:0,motion:0});
          cannibal.update(step,player.ground,true);
          cannibal.frame(step);
          camera.updateMatrixWorld();
        }
        return out;
      },
      turn:(heading,tilt)=>player.turn(heading,tilt),
      // Draw one frame on demand (also when the page is not visible) and return it as JPEG.
      snapshot:(width=960,quality=.8)=>{
        const t=performance.now();lastDraw=0;last=Math.min(last,t-16);loop(t);
        const c=document.createElement('canvas');c.width=width;c.height=Math.round(width*canvas.height/canvas.width);
        c.getContext('2d').drawImage(canvas,0,0,c.width,c.height);return c.toDataURL('image/jpeg',quality);
      },
      camera,cannibalModel:cannibal.root,preview:modelPreview,torch:flashlight,beam:pipe.volume,gpu:()=>pipe.gpuTime,
    };
  }

  function loop(now) {
    requestAnimationFrame(loop);
    // The model preview covers the screen and renders on its own canvas.
    if(modelPreview.isOpen){last=now;return;}
    const delta=(now-last)/1000;
    if(delta<0 || (lastDraw&&now-lastDraw<(active?4:43)))return;
    last=now;lastDraw=now;
    const dt=Math.min(delta,.22);
    elapsed+=dt;realTime+=delta;frameCount++;
    if(active){sampleWindow+=delta;windowFrames++;}
    if(toastTime>0&&(toastTime-=dt)<=0)prompt.classList.remove('shown');
    const steps=Math.max(1,Math.ceil(dt/.035));
    let movement;
    for(let i=0;i<steps;i++)movement=player.update(dt/steps,active&&!cannibal.catching);
    clock.value=elapsed;
    flashlight.update(dt,{bob:movement?.bob??0,stride:movement?.stride??0,motion:calm.checked?.3:1});
    cannibal.cues.swing=sword.swinging;
    cannibal.update(dt,player.ground,active);
    cannibal.frame(dt);
    if(cannibal.catching&&sword.visible)sword.show(false);
    if(active&&frameCount%15===3&&cannibal.canTake&&Math.hypot(cannibal.knife.position.x-player.ground.x,cannibal.knife.position.z-player.ground.z)<2)toast('E · Knochendolch aufheben',.6);
    sword.update(dt,elapsed,movement);
    const distance=Math.hypot(player.ground.x-overlook.x,player.ground.z-overlook.z);
    if(active&&distance<4.6&&!reached){
      reached=true;
      toast('Aussichtspunkt erreicht',4.8);
    }
    if(frameCount%10===1){
      objective.textContent=reached?'Aussichtspunkt erreicht':'Aussichtspunkt · '+Math.round(distance)+' m';
      guide.classList.toggle('hidden',reached);
    }
    if(realTime>=.8){
      sampledFPS=Math.round(frameCount/realTime);
      realTime=0;frameCount=0;
      if(debug)metrics.textContent=sampledFPS+' FPS  /  '+Math.round(scale*100)+' %  /  '+lastCalls+' Calls  /  '+Math.round(lastTriangles/1000)+'k Tris';
    }
    if(sampleWindow>=2.1){
      const fps=windowFrames/sampleWindow;
      // Share of each frame the GPU is busy. It shows headroom even when vsync caps the rate,
      // so fast GPUs render above 100 % (device pixels, plus supersampling on Cinematic).
      const busy=pipe.gpuTime===null?null:pipe.gpuTime*fps/1000;
      const ceiling=quality.scale*Math.min(2,Math.max(1,window.devicePixelRatio||1))*(qualityKey==='high'?1.25:1);
      let step=0;
      if(fps<54||busy!==null&&busy>.85)step=-.085;
      else if(busy===null?fps>67:busy<.5)step=busy!==null&&busy<.3?.085:.043;
      const next=clamp(scale+step,quality.min,ceiling);
      if(Math.abs(next-scale)>.012){scale=next;resize();}
      windowFrames=0;sampleWindow=0;
    }
    const preset=quality;
    const coverage=camera.position;
    if(active&&framesRendered%8===0){
      const side=riverX(coverage.z)-coverage.x;
      audio.stream(riverBank(coverage.x,coverage.z),Math.sign(side)*camera.matrixWorld.elements[0]*Math.min(1,Math.abs(side)/8));
    }
    forest.update(coverage,preset);
    updateGrass(coverage,preset.grass,preset.grassNear);
    updateProps(preset.props);
    setPlantDistance(preset.plants);
    habitat.update(preset.plants+6);
    streamLife.update(dt,coverage);
    air.update(coverage,preset,canvas);
    dayNight.update(dt);
    // Eye adaptation to what the torch lights; mist in the beam thickens at night.
    renderer.toneMappingExposure=dayNight.exposure*flashlight.adaptation;
    pipe.volumeDensity=dayNight.night?.014:.004;
    if(flashlight.on)renderer.shadowMap.needsUpdate=true;
    updateSky(camera,elapsed,preset.clouds);
    if(updateLight(coverage,preset.shadows))renderer.shadowMap.needsUpdate=true;
    birds.update(dt,elapsed,camera,active,player.velocity.length(),sword.swinging,cannibal.threat);
    nightLevel+=((dayNight.night?1:0)-nightLevel)*(1-Math.exp(-dt/3));
    nightSounds.update(dt,active?nightLevel:0,cannibal.threat,cannibal.presence);
    audio.quietBirds=Math.max(nightLevel*.95,cannibal.presence);
    river.update(dt,player,coverage,active,preset);
    renderer.info.reset();
    probe.update(dt,coverage,sword.rig,preset);
    pipe.draw(scene,camera,preset,river,dt,active&&!calm.checked);
    lastCalls=renderer.info.render.calls;
    lastTriangles=renderer.info.render.triangles;
    if(framesRendered++===0){
      play.disabled=false;
      play.querySelector('span').textContent='Wald betreten';
      subtitle.textContent='Folge dem Bach durch den Bergwald zum Aussichtspunkt.';
      menu.classList.add('ready');
    }
  }
  requestAnimationFrame(loop);
}

game().catch(error=>{
  console.error(error);
  play.querySelector('span').textContent='Spiel konnte nicht starten';
  subtitle.textContent='Öffne Falkengrat in einem Browser mit WebGL 2 und aktiver Hardwarebeschleunigung.';
});
