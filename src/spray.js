import * as T from 'three';
import { altitude, clamp, random, riverBank, waterLevel } from './math.js';
import { nightShade } from './atmosphere.js';

const environmentGlsl=`
  uniform sampler2D opaque;
  uniform vec3 nightShade;
  uniform vec2 viewport;
  float waterLight(){
    vec3 surface=texture2D(opaque,gl_FragCoord.xy/viewport).rgb;
    return mix(.58,1.,smoothstep(.013,.18,dot(surface,vec3(.2126,.7152,.0722))));
  }
`;

function streamFans(scene,foam,time,probePass,opaque,viewport){
  const capacity=72,meshSource=new T.PlaneGeometry(1,1,7,10);
  const geometry=new T.InstancedBufferGeometry();
  geometry.index=meshSource.index;
  geometry.attributes.uv=meshSource.attributes.uv;
  geometry.attributes.position=meshSource.attributes.position;
  const origin=new T.InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(T.DynamicDrawUsage);
  const impulse=new T.InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('origin',origin);
  geometry.setAttribute('impulse',impulse);
  geometry.instanceCount=0;
  const material=new T.ShaderMaterial({
    side:T.DoubleSide,transparent:true,depthWrite:false,forceSinglePass:true,
    uniforms:{time,probePass,opaque,viewport,nightShade,foam:{value:foam}},
    vertexShader:`
      uniform float time,probePass;
      attribute vec4 origin,impulse;
      varying vec2 patchUv;
      varying float age,seed,energy;
      void main(){
        patchUv=uv;age=(time-origin.w)/impulse.w;seed=origin.x*.138+origin.z*.194;
        energy=impulse.z;
        if(age>1.||probePass>.5){gl_Position=vec4(2.,2.,2.,1.);return;}
        float s=uv.x*2.-1.,t=uv.y*clamp(time-origin.w,0.,.55);
        float width=(.070+t*.57)*energy;
        vec2 lateral=vec2(impulse.y,-impulse.x);
        vec2 fan=impulse.xy*(energy*(1.9-.76*abs(s))*t)+lateral*(s*width);
        float ridge=sin(uv.x*18.7+seed*3.)*.22+sin(uv.x*37.-seed*5.)*.13;
        float rise=(2.46*energy+ridge)*t-4.91*t*t;
        rise*=1.-s*s*.35;
        vec3 p=origin.xyz+vec3(fan.x,max(.005,rise),fan.y);
        gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
      }`,
    fragmentShader:`
      uniform sampler2D foam;
      ${environmentGlsl}
      varying vec2 patchUv;
      varying float age,seed,energy;
      void main(){
        vec2 p=patchUv;
        vec3 tear=texture2D(foam,p*vec2(.22,.14)+vec2(seed,age*.11)).rgb;
        vec2 distortion=vec2(tear.b,tear.r)*.15;
        vec3 skin=texture2D(foam,p*vec2(1.42,.58)+distortion+seed+vec2(age*.082,-age*.059)).rgb;
        vec3 grain=texture2D(foam,p*vec2(.79,.62)-distortion+vec2(seed,-age*.14)).rgb;
        float border=abs(p.x*2.-1.);
        float tip=smoothstep(.57,1.,p.y);
        float shell=1.-smoothstep(.72,.995,border+(tear.r-.4)*.32+tip*.17);
        float ripping=smoothstep(.30,.73,tear.b*.63+grain.r*.37);
        float web=smoothstep(.11,.56,skin.r*.44+grain.g*.22+ripping*.47);
        float fade=smoothstep(.018,.15,age)*(1.-smoothstep(.48,1.,age));
        float foamFilm=mix(.33,.96,smoothstep(.16,.76,skin.r*.31+skin.g*.22+ripping*.54));
        float opacity=shell*fade*smoothstep(.04,.19,p.y)*(web*.72+.13)*(1.-.67*tip);
        if(opacity<.023)discard;
        vec3 tint=mix(vec3(.22,.37,.36),vec3(.73,.84,.83),foamFilm)*waterLight();
        gl_FragColor=vec4(tint*nightShade,opacity*.74);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const mesh=new T.Mesh(geometry,material);
  mesh.frustumCulled=false;mesh.renderOrder=8;scene.add(mesh);
  const fans=Array.from({length:capacity},()=>({start:-99,life:0}));
  let next=0;
  return {
    launch(x,z,dx,dz,energy,life){
      Object.assign(fans[next++%capacity],{x,y:waterLevel(z)+.017,z,dx,dz,energy,life,start:time.value});
    },
    update(){
      let n=0;
      for(const f of fans){
        if(time.value-f.start>=f.life)continue;
        origin.setXYZW(n,f.x,f.y,f.z,f.start);
        impulse.setXYZW(n,f.dx,f.dz,f.energy,f.life);
        n++;
      }
      geometry.instanceCount=n;
      if(n){
        origin.clearUpdateRanges();origin.addUpdateRange(0,n*4);origin.needsUpdate=true;
        impulse.clearUpdateRanges();impulse.addUpdateRange(0,n*4);impulse.needsUpdate=true;
      }
      return n;
    },
  };
}

export function createSpray(scene,{probePass,time,opaque,size:viewport},foam){
  const capacity=4800,rng=random(31677),fans=streamFans(scene,foam,time,probePass,opaque,viewport);
  const particles=Array.from({length:capacity},()=>({age:0,life:0,x:0,y:0,z:0,vx:0,vy:0,vz:0,radius:0,kind:0}));
  const positions=new Float32Array(capacity*3),velocity=new Float32Array(capacity*3),shape=new Float32Array(capacity*3);
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));
  geometry.setAttribute('velocity',new T.BufferAttribute(velocity,3).setUsage(T.DynamicDrawUsage));
  geometry.setAttribute('drop',new T.BufferAttribute(shape,3).setUsage(T.DynamicDrawUsage));
  const material=new T.ShaderMaterial({uniforms:{viewport,probePass,opaque,nightShade},depthWrite:false,transparent:true,
    vertexShader:`
      attribute vec3 velocity,drop;
      uniform vec2 viewport;
      uniform float probePass;
      varying vec2 direction;
      varying float strength,stretch,kind;
      void main(){
        vec4 eye=modelViewMatrix*vec4(position,1.);
        gl_Position=projectionMatrix*eye;
        if(probePass>.5){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=1.;return;}
        vec3 motion=(modelViewMatrix*vec4(velocity,0.)).xyz;
        vec2 screen=motion.xy-motion.z*eye.xy/min(-.1,eye.z);
        direction=length(screen)>.001?normalize(screen):vec2(0.,1.);
        kind=drop.z;
        stretch=1.+min(4.4,length(screen)*(.25+.68*kind));
        if(kind<.19)stretch=1.+min(.76,length(screen)*.14);
        float diameter=drop.x*viewport.y*projectionMatrix[1][1]*stretch/max(.15,-eye.z);
        gl_PointSize=clamp(diameter,1.,67.);
        strength=drop.y*min(1.0,diameter)*(1.-smoothstep(16.,32.,-eye.z));
      }`,
    fragmentShader:`
      ${environmentGlsl}
      varying vec2 direction;
      varying float strength,stretch,kind;
      void main(){
        vec2 p=gl_PointCoord*2.-1.;p.y=-p.y;
        vec2 q=vec2(dot(p,direction),dot(p,vec2(-direction.y,direction.x))*stretch);
        float shape=q.x*q.x+q.y*q.y*(1.12-.43*q.x);
        if(shape>1.||strength<.016)discard;
        float edge=smoothstep(.52,.96,shape);
        float falloff=1.-smoothstep(.42,.99,shape);
        float glint=exp(-19.*dot(q-vec2(.52,.08),q-vec2(.52,.08)));
        float white=smoothstep(.55,1.,kind);
        vec3 color=mix(vec3(.29,.47,.49),vec3(.79,.90,.93),edge*.57+white*.43)+glint*.36;
        float film=(.49+.30*white+.28*glint)*falloff;
        if(kind<.19){
          color=vec3(.62,.77,.78);
          film=exp(-shape*2.9)*.145;
        }
        gl_FragColor=vec4(color*waterLight()*nightShade,strength*film);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const drops=new T.Points(geometry,material);
  drops.frustumCulled=false;drops.renderOrder=10;scene.add(drops);
  let head=0,live=0,sheets=0;
  return {
    get live(){return live;},
    get sheets(){return sheets;},
    splash(x,z,dx,dz,power,count,fanCount=0){
      for(let i=0;i<fanCount;i++){
        const bias=(rng()-.5)*.49;
        const lateral=(rng()-.5)*.15;
        fans.launch(x+dz*lateral,z-dx*lateral,dx+dz*bias,dz-dx*bias,power*(.78+rng()*.32),.25+rng()*.19);
      }
      for(let i=0;i<count;i++){
        const p=particles[head++%capacity],side=(rng()-.5)*2;
        const fleck=rng();
        const mist=fleck<.19,fragment=fleck>.68;
        const forward=.23+rng()*power*(fragment?2.45:1.75);
        const lateral=side*(.20+rng()*power*.96);
        p.x=x+(rng()-.5)*.19;p.z=z+(rng()-.5)*.19;p.y=waterLevel(p.z)+.037;
        p.vx=dx*forward+dz*lateral;p.vz=dz*forward-dx*lateral;
        p.vy=.53+rng()*power*(fragment?2.84:2.34);
        p.life=mist?.42+rng()*.46:.24+rng()*.65;
        p.age=0;p.kind=fleck;
        p.radius=mist?.021+rng()*.037:.0023+rng()**2*(fragment?.012:.0067)*clamp(power,.65,2.1);
      }
    },
    update(dt){
      live=0;
      for(const p of particles){
        if(p.age>=p.life)continue;
        p.age+=dt;
        const gravity=p.kind<.19?7.1:9.81;
        p.y+=(p.vy-.5*gravity*dt)*dt;
        p.vy-=gravity*dt;
        const drag=1-dt*(p.kind<.19?2.17:.74);
        p.vx*=drag;p.vz*=drag;
        p.x+=p.vx*dt;p.z+=p.vz*dt;
        const base=riverBank(p.x,p.z)<-.20?waterLevel(p.z):Math.max(waterLevel(p.z),altitude(p.x,p.z));
        if(p.y<base+.01&&p.vy<0){p.age=p.life;continue;}
        let i=live*3;
        positions[i]=p.x;positions[i+1]=p.y;positions[i+2]=p.z;
        velocity[i]=p.vx;velocity[i+1]=p.vy;velocity[i+2]=p.vz;
        shape[i]=p.radius;shape[i+1]=clamp((p.life-p.age)*7.0,0,1)*clamp((p.y-base)*38,0,1);shape[i+2]=p.kind;
        live++;
      }
      geometry.setDrawRange(0,live);
      if(live)for(const attr of Object.values(geometry.attributes)){
        attr.clearUpdateRanges();attr.addUpdateRange(0,live*attr.itemSize);attr.needsUpdate=true;
      }
      sheets=fans.update();
    },
  };
}
