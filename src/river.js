import * as T from 'three';
import { channelSlope, clamp, random, riverBank, riverGlsl, riverSpeed, riverX, riverWidth, waterLevel } from './math.js';
import { sunDirection, hazeColor, nightShade } from './atmosphere.js';
import { createSpray } from './spray.js';

const maxObstacles=12,maxTrail=12;

export function createRiver(time,obstacles,foamTexture) {
  const scene=new T.Scene();
  const trail=Array.from({length:maxTrail},()=>new T.Vector4(0,0,-100,0));
  const headings=Array.from({length:maxTrail},()=>new T.Vector4());
  const uniforms={time,opaque:{value:null},size:{value:new T.Vector2()},sun:{value:sunDirection},sky:{value:hazeColor},
    probePass:{value:0},nightShade,trail:{value:trail},headings:{value:headings},bodyWake:{value:new T.Vector4()},
    bodyHeading:{value:new T.Vector2(0,1)},detail:{value:1},foamMap:{value:foamTexture}};
  const spray=createSpray(scene,uniforms,foamTexture);
  const material=new T.ShaderMaterial({uniforms,side:T.DoubleSide,
    vertexShader:`
      attribute float span;
      attribute vec2 current;
      varying vec3 worldPos,eyePos;
      varying float across;
      varying vec2 stream;
      void main(){
        worldPos=position;across=span;stream=current;
        vec4 v=viewMatrix*vec4(position,1.);
        eyePos=v.xyz;gl_Position=projectionMatrix*v;
      }`,
    fragmentShader:`
      uniform sampler2D opaque,foamMap;
      uniform vec2 size;
      uniform vec3 sun,sky,nightShade;
      uniform float time,probePass,detail;
      uniform int obstacleCount;
      uniform vec4 obstacle[${maxObstacles}];
      uniform vec4 obstacleFlow[${maxObstacles}];
      uniform vec4 trail[${maxTrail}],headings[${maxTrail}],bodyWake;
      uniform vec2 bodyHeading;
      uniform mat4 projectionMatrix;
      varying vec3 worldPos,eyePos;
      varying float across;
      varying vec2 stream;
      float noiseHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.545);}
      ${riverGlsl}
      float noise2(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(noiseHash(i),noiseHash(i+vec2(1,0)),f.x),
          mix(noiseHash(i+vec2(0,1)),noiseHash(i+1.),f.x),f.y);
      }
      float surface(vec2 p){
        float channel=channelAt(p.y);
        vec2 flow=vec2(p.x-channel,p.y);
        vec2 adv=flow-vec2(.071,stream.y)*time;
        vec2 warp=vec2(noise2(adv*.65),noise2(adv*.61+31.))*1.67;
        return .029*noise2(adv*vec2(1.8,2.8)+warp)+.053*noise2(adv*.83+warp)+
          .006*sin(flow.y*7.2-flow.x*.83-time*5.8+7.*warp.x)*(.27+.73*warp.y*.59);
      }
      vec2 relativeTo(vec2 p,vec2 f){
        return vec2(dot(p,vec2(f.y,-f.x)),dot(p,f));
      }
      void rockWake(vec2 p,vec4 hull,vec4 flow,inout vec2 slope,inout float froth){
        vec2 f=flow.xy,q=relativeTo(p-hull.xy,f);
        float down=q.y-hull.w*.46;
        if(abs(q.x)>hull.z*2.7+1.6||down< -hull.w*2.8-.65||down>hull.w*7.+3.)return;
        vec2 ellipse=q/vec2(hull.z+.088,hull.w+.10);
        float edge=length(ellipse);
        float crest=exp(-pow((edge-1.08)*4.7,2.))*(1.-smoothstep(-.42,.55,q.y/max(.1,hull.w)));
        vec2 outward=normalize(p-hull.xy+vec2(.0001));
        slope+=outward*sin((edge-.85)*7.4)*crest*.42*flow.z;
        float d=max(0.,down);
        float zone=smoothstep(-.4,.15,down)*exp(-d/(1.6+hull.w*2.4));
        float front=hull.z*.91+d*.23;
        float meander=noise2(vec2(d*4.8-time*.79,q.x*4.3))-.5;
        float trough=abs(q.x)-front+.099*meander;
        float seam=exp(-pow(trough/(.095+d*.09+hull.z*.12),2.));
        float shear=sin(trough*22.-d*3.4+time*2.9)*seam*zone;
        float eddy=noise2(vec2(q.x*8.1,d*4.9-time*flow.w*3.7));
        float vortex=cos(q.y*13.8-time*6.+q.x*6.)*exp(-q.x*q.x/(.14+hull.z*.72+d*.20))*zone;
        slope+=(vec2(f.y,-f.x)*(shear*sign(q.x)*.28)+f*vortex*.19)*flow.z;
        froth+=flow.z*(crest*.91 + zone*(seam*.55+max(0.,vortex)*.22))*mix(.39,1.,smoothstep(.31,.77,eddy));
      }
      void main(){
        vec2 p=worldPos.xz, uv=gl_FragCoord.xy/size;
        float eyeDepth=-eyePos.z;
        float nearDetail=1.-smoothstep(18.,104.,eyeDepth);
        const float e=.045;
        vec2 slope=vec2(surface(p+vec2(e,0))-surface(p-vec2(e,0)),
          surface(p+vec2(0,e))-surface(p-vec2(0,e)))/(2.*e);
        float froth=0.;
        if(eyeDepth<50.&&probePass<.5){
          for(int j=0;j<${maxObstacles};j++){
            if(j>=obstacleCount)break;
            rockWake(p,obstacle[j],obstacleFlow[j],slope,froth);
          }
          if(bodyWake.z>.005){
            vec2 q=relativeTo(p-bodyWake.xy,bodyHeading);
            float bow=exp(-pow((length(q*vec2(1.,.86))-.33)*12.,2.))*smoothstep(-.09,.21,q.y);
            slope+=normalize(p-bodyWake.xy+vec2(.0001))*bow*.42*bodyWake.z;
            froth+=bow*.66*bodyWake.z;
          }
          for(int j=0;j<${maxTrail};j++){
            float age=time-trail[j].z;
            if(age<0.||age>3.1)continue;
            vec2 delta=p-trail[j].xy-headings[j].zw*age;
            if(dot(delta,delta)>12.)continue;
            vec2 q=relativeTo(delta,headings[j].xy);
            float expand=.19+age*.61, decay=exp(-age*.90);
            float rim=abs(q.x)-expand;
            float crest=exp(-pow(rim/(.08+age*.060),2.))*exp(-pow((q.y+.14+age*.36)/(.16+age*.16),2.));
            float spread=length(q*vec2(1.,.84))-expand;
            float ripple=sin(spread*26.)*exp(-spread*spread*27.-age*1.62);
            float energy=trail[j].w*decay;
            slope+=normalize(delta+vec2(.0001))*(ripple*.30+crest*.48)*energy;
            float bubbles=1.-smoothstep(.24,.52+age*.18,length(q+vec2(0.,.16)));
            froth+=(crest*.57+bubbles*.23)*energy;
          }
        }
        vec3 normal=normalize(vec3(-slope.x*nearDetail,1.,.034-slope.y*nearDetail));
        vec3 v=normalize(cameraPosition-worldPos);
        vec3 rv=reflect(-v,normal);
        if(probePass>.5){
          gl_FragColor=vec4(mix(vec3(.026,.085,.071)*nightShade,sky*.78,pow(1.-max(0.,dot(v,normal)),4.)),1.);
          return;
        }
        vec3 reye=normalize((viewMatrix*vec4(rv,0.)).xyz);
        vec4 bed=texture2D(opaque,uv);
        float thickness=clamp((bed.a-eyeDepth)*max(.08,abs(v.y)),.0,2.5);
        vec2 distort=(viewMatrix*vec4(normal-vec3(0,1,0),0.)).xy*.039*min(1.,thickness*1.8);
        vec4 refracted=texture2D(opaque,clamp(uv+distort,.001,.999));
        if(refracted.a<eyeDepth)refracted=bed;
        vec3 transmission=exp(-thickness*vec3(1.01,.50,.37));
        vec3 water=refracted.rgb*transmission+vec3(.020,.105,.085)*nightShade*(1.-transmission);
        if(eyeDepth<36. && thickness>.035&&thickness<1.6){
          float trace=max(0.,refracted.a-eyeDepth)*length(eyePos)/max(.2,eyeDepth);
          vec2 floorPos=p-v.xz*trace;
          vec2 caustic=floorPos*vec2(.22,.31)+slope*.061-time*vec2(.028,.073);
          float a=texture2D(foamMap,caustic).r,b=texture2D(foamMap,caustic*.63+vec2(.2,-.032*time)).r;
          float floorLight=smoothstep(.021,.20,dot(refracted.rgb,vec3(.2126,.7152,.0722)));
          float onBed=smoothstep(.04,.22,thickness)*(1.-smoothstep(.46,1.42,thickness));
          water+=water*vec3(.81,1.,.86)*(max(a,b*.69)*.27*floorLight*onBed*nearDetail);
        }
        vec3 reflected=mix(vec3(.035,.070,.049)*nightShade,sky*.94,smoothstep(.035,.39,rv.y));
        float travel=.25;
        for(int i=0;i<14;i++){
          vec3 samplePos=eyePos+reye*travel;
          vec4 clip=projectionMatrix*vec4(samplePos,1.);
          vec2 q=clip.xy/clip.w*.5+.5;
          if(i>=int(detail)||clip.w<.1||any(lessThan(q,vec2(.002)))||any(greaterThan(q,vec2(.998))))break;
          vec4 hit=texture2D(opaque,q);
          float gap=-samplePos.z-hit.a;
          if(hit.a>1. && gap>.015 && gap<.68+travel*.21){
            vec2 edge=smoothstep(vec2(0.),vec2(.07),min(q,1.-q));
            reflected=mix(reflected,hit.rgb,edge.x*edge.y*.91);break;
          }
          travel=travel*1.41+.18;
        }
        float fresnel=.025+.76*pow(1.-clamp(dot(normal,v),0.,1.),5.);
        vec3 color=mix(water,reflected,fresnel);
        float currentSpeed=stream.y*mix(1.,.68,smoothstep(.70,1.05,abs(across)));
        vec2 advected=p-vec2(stream.x*.62,1.)*currentSpeed*time;
        float swirl=noise2(advected*3.8+.51)*.65+noise2(p*7.9-vec2(.01,2.4)*time)*.35;
        float strain=noise2(p*11.7+vec2(swirl*3.,-time*1.3));
        vec2 foamUV=advected*vec2(1.08,.82)+vec2(swirl,strain)*.114;
        vec3 film=texture2D(foamMap,foamUV).rgb;
        vec3 knot=texture2D(foamMap,foamUV*.61+vec2(.19,.62)).rgb;
        float edgeFoam=(1.-smoothstep(.012,.10,thickness))*smoothstep(.50,.84,swirl)*.34;
        float density=clamp(froth+edgeFoam,0.,1.4);
        float filmWall=max(film.r*.76,film.g*.64);
        float fragments=smoothstep(.37,.84,knot.b*.65+swirl*.52);
        float foamMass=smoothstep(.44,.77,strain*.56+swirl*.44);
        float pattern=mix(filmWall*.74,knot.r*.27+film.g*.50,fragments*.69);
        pattern=max(pattern,foamMass*.83);
        float coverage=smoothstep(.15,.83,density*(.23+pattern*1.36))*nearDetail;
        float scatter=.74+.25*film.g-.15*film.r;
        float illumination=mix(.59,1.0,smoothstep(.011,.12,dot(refracted.rgb,vec3(.2126,.7152,.0722))));
        color=mix(color,vec3(.73,.84,.83)*scatter*illumination*nightShade,coverage*.91);
        float glint=pow(max(0.,dot(rv,sun)),270.)*nearDetail;
        color+=mix(vec3(.55,.62,.80),vec3(.87,.73,.53),nightShade.g)*glint*.16*max(nightShade.g,.35);
        color=mix(color,sky,1.-exp(-pow(eyeDepth*.00248,2.)));
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  for(let start=-470;start<176;start+=12){
    const positions=[],coords=[],currents=[],indices=[];
    for(let i=0;i<=48;i++){
      const z=start+i*.25,center=riverX(z),width=riverWidth(z)+.35;
      for(const side of [-1,1]){
        positions.push(center+side*width,waterLevel(z),z);coords.push(side);currents.push(channelSlope(z),riverSpeed(z));
      }
      const a=i*2;
      if(i<48)indices.push(a,a+2,a+1,a+1,a+2,a+3);
    }
    const geo=new T.BufferGeometry();
    geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    geo.setAttribute('current',new T.Float32BufferAttribute(currents,2));
    geo.setAttribute('span',new T.Float32BufferAttribute(coords,1));geo.setIndex(indices);
    const local=obstacles.filter(o=>o.z>start-12&&o.z<start+15)
      .sort((a,b)=>b.width*b.strength-a.width*a.strength).slice(0,maxObstacles);
    const shader=new T.ShaderMaterial({
      side:material.side,vertexShader:material.vertexShader,fragmentShader:material.fragmentShader,
      uniforms:{...uniforms,obstacleCount:{value:local.length},
        obstacle:{value:Array.from({length:maxObstacles},(_,i)=>local[i]
          ?new T.Vector4(local[i].x,local[i].z,local[i].width,local[i].length):new T.Vector4())},
        obstacleFlow:{value:Array.from({length:maxObstacles},(_,i)=>local[i]
          ?new T.Vector4(local[i].dx,local[i].dz,local[i].strength,riverSpeed(local[i].z)):new T.Vector4())}},
    });
    geo.computeBoundingSphere();scene.add(new T.Mesh(geo,shader));
  }
  const rng=random(914);
  const emitters=obstacles.filter(o=>o.strength>.29&&o.width>.17&&o.faces.length)
    .map(o=>({...o,timer:rng()}));
  let nextTrail=0,lastX=Infinity,lastZ=Infinity,feet=0,side=1,rockBursts=0,footBursts=0;
  return {scene,uniforms,
    stats:()=>({obstacles:obstacles.length,rockBursts,footBursts,drops:spray.live,sheets:spray.sheets,trail:nextTrail}),
    update(dt,player,camera,moving,quality){
      uniforms.detail.value=quality.shadows?14:9;
      for(const rock of emitters){
        const distance=Math.hypot(rock.x-camera.x,rock.z-camera.z);
        if(distance>(quality.shadows?25:16))continue;
        rock.timer-=dt;
        if(rock.timer>0)continue;
        const face=rock.faces[Math.floor(rng()*rock.faces.length)];
        if(riverBank(face.x,face.z)<.06){
          const power=clamp(.30+rock.strength*.34+rock.width*.17+riverSpeed(face.z)*.22,.47,1.19);
          const outward=(face.side<0?-1:1)*(.46+rng()*.52);
          const dx=rock.dz*outward-rock.dx*.61,dz=-rock.dx*outward-rock.dz*.61;
          const fade=1-clamp((distance-5)/25,0,.7);
          const count=Math.floor((19+power*27)*fade*(quality.shadows?1:.64));
          spray.splash(face.x,face.z,dx,dz,power,count,power>.76&&distance<16?1+Number(power>1.05&&rng()<.28):0);
          rockBursts++;
        }
        rock.timer=.125+rng()*.22+distance*.012;
      }
      const {x,y,z}=player.ground;
      const wet=moving&&riverBank(x,z)<.12?clamp(waterLevel(z)-y,0,1):0;
      uniforms.bodyWake.value.set(x,z,0,0);
      if(wet>.06){
        const vzFlow=riverSpeed(z)*.86, vxFlow=channelSlope(z)*vzFlow;
        const vx=player.velocity.x-vxFlow,vz=player.velocity.z-vzFlow;
        const speed=Math.hypot(vx,vz);
        const dx=vx/Math.max(.05,speed),dz=vz/Math.max(.05,speed);
        uniforms.bodyHeading.value.set(dx,dz);
        const force=clamp(speed*.36*wet+.13,0,1.05);
        uniforms.bodyWake.value.z=force;
        const traveled=Math.hypot(x-lastX,z-lastZ);
        if(traveled>.31 && player.velocity.length()>.37){
          if(traveled<2)feet+=traveled;else feet=0;
          const i=nextTrail++%maxTrail;
          trail[i].set(x,z,time.value,force);
          headings[i].set(dx,dz,vxFlow*.77,vzFlow*.77);
          lastX=x;lastZ=z;
          if(feet>.73){
            side*=-1;feet%=.73;
            const power=clamp(.62+force*.95,0,1.48);
            spray.splash(x+dz*side*.17,z-dx*side*.17,dx*.54+dz*side*.81,dz*.54-dx*side*.81,
              power,Math.floor(37+power*37),power>1.17?2:1);
            footBursts++;
          }
        }
      }else{lastX=Infinity;feet=0;}
      spray.update(dt);
    }};
}
