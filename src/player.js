import * as T from 'three';
import { altitude, clamp, mix, waterAt } from './math.js';

export function createPlayer(camera, collision, audio) {
  const ground = new T.Vector3(), velocity = new T.Vector3(), keys = new Set();
  const direction = new T.Vector3();
  const euler = new T.Euler(0,0,0,'YXZ');
  let yaw=0,pitch=0,bob=0,step=0,vY=0,eyeY=0,grounded=true;
  let lookX=0,lookY=0,stride=0,jumpPending=false,eyeVelocity=0,landing=0;
  let touchHorizontal=0,touchVertical=0;
  let bobStrength=1;
  const eyeHeight=1.69;
  const place = (x,z,heading,tilt) => {
    ground.set(x,collision.floorAt(x,z,altitude(x,z)+.3),z);
    eyeY=ground.y+eyeHeight;
    camera.position.set(ground.x,eyeY,ground.z);
    yaw=heading; pitch=tilt;
    euler.set(pitch,yaw,0);
    camera.quaternion.setFromEuler(euler);
    camera.updateMatrixWorld();
    velocity.set(0,0,0);
    vY=0;
    eyeVelocity=0;
    landing=0;
    stride=0;
    grounded=true;
    jumpPending=false;
  };
  place(-9,-107,-.21,.065);
  return {
    ground,velocity,keys,
    enterTrail(){place(9,1.2,-.15,-.055);},
    motion(amount){bobStrength=amount;},
    jump(){jumpPending=true;},
    steer(horizontal,vertical){touchHorizontal=horizontal;touchVertical=vertical;},
    look(dx,dy,sensitivity=1) {
      yaw-=clamp(dx,-90,90)*.0022*sensitivity;
      pitch=clamp(pitch-clamp(dy,-90,90)*.0022*sensitivity,-1.47,1.47);
      lookX=clamp(lookX+dx*.0023,-.31,.31);
      lookY=clamp(lookY+dy*.0023,-.26,.26);
    },
    place,
    // Turn the head without moving (test scripts).
    turn(heading,tilt){yaw=heading;pitch=tilt;euler.set(pitch,yaw,0);camera.quaternion.setFromEuler(euler);camera.updateMatrixWorld();},
    update(dt,moving) {
      const run=keys.has('ShiftLeft')||keys.has('ShiftRight');
      const left=keys.has('KeyA')||keys.has('ArrowLeft');
      const right=keys.has('KeyD')||keys.has('ArrowRight');
      const front=keys.has('KeyW')||keys.has('ArrowUp');
      const back=keys.has('KeyS')||keys.has('ArrowDown');
      const horizontal=clamp(Number(right)-Number(left)+touchHorizontal,-1,1);
      const vertical=clamp(Number(front)-Number(back)+touchVertical,-1,1);
      const sprint=moving&&run&&front&&!back&&vertical===1;
      direction.set(horizontal*.81,0,-vertical*(vertical<0?.70:1));
      if(direction.lengthSq()>1)direction.normalize();
      if(!moving)direction.set(0,0,0);
      direction.applyAxisAngle(T.Object3D.DEFAULT_UP,yaw);
      const water=waterAt(ground.x,ground.z);
      const wet=water.bank<0?clamp(water.level-ground.y,0,1):0;
      const speed=(sprint ? 5.6 : 2.88)*(1-wet*.51);
      const response=grounded?(direction.lengthSq()>.001?5.9:8.0):2.15;
      velocity.lerp(direction.multiplyScalar(speed),1-Math.exp(-dt*response));
      const oldX=ground.x,oldZ=ground.z;
      collision.move(ground,velocity,dt,grounded);
      const floor=collision.floorAt(ground.x,ground.z,ground.y+(grounded?.28:.024));
      if(moving&&jumpPending&&grounded){ vY=4.1; grounded=false; }
      jumpPending=false;
      if(grounded && floor<ground.y-.45){grounded=false;vY=-1;}
      if(!grounded){
        vY-=dt*14.7;
        ground.y+=vY*dt;
        if(ground.y<=floor){
          if(vY<-2.7&&moving) {
            audio.step(.87,true);
            landing=Math.min(.023,-vY*.0042);
          }
          grounded=true;vY=0;ground.y=floor;
        }
      } else {
        ground.y=floor;
      }
      const distance=Math.hypot(ground.x-oldX,ground.z-oldZ);
      if(grounded){
        const pace=sprint ? 1.17 : .79;
        bob+=distance*Math.PI/pace;
        step+=distance;
        if(step>pace){step%=pace;if(moving){if(wet>.08)audio.splash(wet);else audio.step(sprint?.72:.50);}}
      }
      const actualSpeed=dt>0?distance/dt:0;
      stride=mix(stride,clamp(actualSpeed/4.7,0,1)*Number(grounded),1-Math.exp(-dt*8.4));
      landing*=Math.exp(-dt*10);
      const targetY=ground.y+eyeHeight;
      const spring=grounded?18:29;
      const remaining=eyeY-targetY;
      const springVelocity=eyeVelocity+remaining*spring;
      const damping=Math.exp(-spring*dt);
      eyeY=targetY+(remaining+springVelocity*dt)*damping;
      eyeVelocity=(eyeVelocity-spring*springVelocity*dt)*damping;
      const sway= bobStrength*stride;
      const eyeOffset=(Math.cos(bob*2)*.0105*sway-landing*bobStrength);
      camera.position.set(ground.x,eyeY+eyeOffset,ground.z);
      euler.set(pitch,yaw,Math.sin(bob)*.00145*sway);
      camera.quaternion.setFromEuler(euler);
      lookX*=Math.exp(-dt*9.5);
      lookY*=Math.exp(-dt*9.5);
      return {bob,stride,lookX,lookY,sprint,pitch,landing};
    },
  };
}

export function createSound() {
  let ctx, master, windGain, streamGain, streamPan, noise, muted=false, ambience=false;
  let quietBirds=0;   // songbirds sleep at night (and fall silent when something prowls)
  const scratch = Math.random;
  function noiseSound(duration,frequency,amount,kind='bandpass',delay=0,pan=0) {
    if(!ctx||muted)return;
    const t=ctx.currentTime+delay;
    const src=ctx.createBufferSource(), filter=ctx.createBiquadFilter(), gain=ctx.createGain();
    src.buffer=noise;
    filter.type=kind;
    filter.frequency.setValueAtTime(frequency,t);
    filter.frequency.exponentialRampToValueAtTime(frequency*.29,t+duration);
    filter.Q.value=.62;
    gain.gain.setValueAtTime(.001,t);
    gain.gain.exponentialRampToValueAtTime(amount,t+duration*.09);
    gain.gain.exponentialRampToValueAtTime(.001,t+duration);
    src.connect(filter).connect(gain);
    const stereo=ctx.createStereoPanner();
    stereo.pan.value=pan;gain.connect(stereo).connect(master);
    src.start(t,scratch()*1.7);
    src.stop(t+duration);
  }
  function bird() {
    if(!ctx || muted || !ambience || Math.random()<quietBirds) return;
    for(let i=0;i<3;i++){
      const osc=ctx.createOscillator(), gain=ctx.createGain(), pan=ctx.createStereoPanner();
      const t=ctx.currentTime+i*.146, hz=1240+scratch()*1270;
      osc.frequency.setValueAtTime(hz,t);
      osc.frequency.exponentialRampToValueAtTime(hz*1.45,t+.055);
      osc.frequency.exponentialRampToValueAtTime(hz*.92,t+.116);
      gain.gain.setValueAtTime(.001,t);
      gain.gain.exponentialRampToValueAtTime(.016,t+.024);
      gain.gain.exponentialRampToValueAtTime(.001,t+.13);
      pan.pan.value=.48;
      osc.connect(gain).connect(pan).connect(master);
      osc.start(t); osc.stop(t+.14);
    }
  }
  return {
    get context(){return ctx;},
    get output(){return master;},
    set quietBirds(value){quietBirds=value;},
    start() {
      if(!ctx) {
        const Audio=window.AudioContext||window.webkitAudioContext;
        if(!Audio)return;
        ctx=new Audio();
        master=ctx.createGain();
        master.gain.value=muted?0:.48;
        master.connect(ctx.destination);
        noise=ctx.createBuffer(1,ctx.sampleRate*3,ctx.sampleRate);
        const data=noise.getChannelData(0);
        for(let i=0;i<data.length;i++) data[i]=scratch()*2-1;
        const wind=ctx.createBufferSource(),filter=ctx.createBiquadFilter();
        wind.buffer=noise; wind.loop=true;
        filter.type='lowpass'; filter.frequency.value=245;
        windGain=ctx.createGain();windGain.gain.value=.24;
        wind.connect(filter).connect(windGain).connect(master);
        const gust=ctx.createOscillator(), strength=ctx.createGain();
        gust.frequency.value=.13; strength.gain.value=.08;
        gust.connect(strength).connect(windGain.gain);
        gust.start(); wind.start();
        const stream=ctx.createBufferSource(),flowFilter=ctx.createBiquadFilter();
        stream.buffer=noise;stream.loop=true;stream.playbackRate.value=.82;
        flowFilter.type='bandpass';flowFilter.frequency.value=1430;flowFilter.Q.value=.47;
        streamGain=ctx.createGain();streamGain.gain.value=0;
        streamPan=ctx.createStereoPanner();
        stream.connect(flowFilter).connect(streamGain).connect(streamPan).connect(master);
        stream.start(0,.83);
        window.setInterval(bird,5600);
      }
      void ctx.resume();
      ambience=true;
    },
    suspend() {
      ambience=false;
      if (ctx?.state==='running') void ctx.suspend();
    },
    toggle() {
      muted=!muted;
      if(ctx) master.gain.setTargetAtTime(muted?0:.48,ctx.currentTime,.08);
      return muted;
    },
    stream(distance,pan){
      if(!ctx||!ambience)return;
      streamGain.gain.setTargetAtTime(.15/(1+(Math.max(0,distance)/7)**2),ctx.currentTime,.23);
      streamPan.pan.setTargetAtTime(clamp(pan,-.78,.78),ctx.currentTime,.23);
    },
    step(amount,landing=false){
      noiseSound(landing?.25:.16,1100+scratch()*480,amount*.37,'lowpass');
      noiseSound(.078,135+scratch()*40,amount*.29,'bandpass');
    },
    swing(){noiseSound(.31,840,.39,'bandpass',.075);},
    wingbeat(distance,pan){
      const amount=.18/(1+distance*.17);
      for(let i=0;i<4;i++)noiseSound(.090,1200-i*96,amount*(1-i*.17),'bandpass',.19+i*.142,pan);
    },
    splash(depth){noiseSound(.21,2300,.21+depth*.31,'lowpass');noiseSound(.13,480,.16,'bandpass',.055);},
    hit(){noiseSound(.19,185,.82,'bandpass');noiseSound(.16,1850,.33,'bandpass',.015);},
  };
}
