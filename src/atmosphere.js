import * as T from 'three';

export const sunDirection = new T.Vector3(.48, .448, -.82).normalize();
export const hazeColor = new T.Color('#95a7b3');
export const forestHaze = .00248;
// Day/night state shared by every shader that does not use scene lights:
// daylight runs from 0 (night) to 1 (day); nightShade multiplies their unlit colours.
export const daylight = { value: 1 };
export const nightShade = { value: new T.Color(1, 1, 1) };
const dayHaze = hazeColor.clone(), nightHaze = new T.Color('#1a2231');
// Graphics tuning handles, only with ?dev in the URL.
const devTools = new URLSearchParams(location.search).has('dev') ? (window.falkengratGraphics = {}) : null;

const quadVertex = `
  varying vec2 vUv;
  void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}
`;

export function createSky(scene) {
  const uniforms = {
    sunDir: { value: sunDirection }, time: { value: 0 }, detail: { value: 7 },
    horizon: { value: hazeColor }, daylight,
  };
  const sky = new T.Mesh(new T.SphereGeometry(1650, 24, 12), new T.ShaderMaterial({
    uniforms, side: T.BackSide, depthWrite: false, depthTest: true,
    vertexShader: `
      varying vec3 viewRay;
      void main(){
        viewRay=position;
        vec4 clip=projectionMatrix*modelViewMatrix*vec4(position,1.);
        gl_Position=clip.xyww;
      }
    `,
    fragmentShader: `
      uniform vec3 sunDir,horizon;
      uniform float time,detail,daylight;
      varying vec3 viewRay;
      float hash(vec3 p) {
        p=fract(p*.3183099+vec3(.151,.253,.327));
        p*=17.;
        return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
      }
      float n3(vec3 p){
        vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
          mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
          mix(hash(i+vec3(0,1,1)),hash(i+1.),f.x),f.y),f.z);
      }
      float cloud(vec3 p){
        vec3 q=p*vec3(.0013,.0031,.0013);
        vec3 wind=vec3(time*.008,0.,time*.004);
        float macro=n3(q*1.14+wind);
        float form=macro*.67+n3(q*2.49+wind)*.23+n3(q*5.29)*.10;
        return smoothstep(.49,.69,form);
      }
      // Stars: one candidate per cell of a direction grid, twinkling slowly.
      float stars(vec3 rd){
        vec3 cell=floor(rd*380.);
        float h=hash(cell);
        if(h<.9965)return 0.;
        vec3 centre=(cell+.5+(vec3(hash(cell+3.1),hash(cell+7.7),hash(cell+1.3))-.5)*.6)/380.;
        float d=length(rd-normalize(centre))*380.;
        float twinkle=.65+.35*sin(time*(1.3+h*40.)+h*300.);
        return smoothstep(.55,0.,d)*(h-.9965)/.0035*twinkle;
      }
      void main(){
        vec3 rd=normalize(viewRay);
        float elevation=max(rd.y,0.);
        float mu=max(dot(rd,sunDir),0.);
        vec3 zenith=mix(vec3(.0016,.0030,.0085),vec3(.068,.218,.439),daylight);
        vec3 sky=mix(horizon*.91,zenith,pow(elevation,.48));
        sky+=(vec3(.21,.13,.058)*pow(mu,12.)*(1.-elevation*.33)+vec3(1.35,.84,.33)*pow(mu,82.)
          +vec3(11.,8.0,4.3)*smoothstep(.99978,.99992,mu))*daylight;
        // At night the moon stands where the sun was, so moonlight and shadows share one direction.
        float night=1.-daylight;
        vec3 moonAxis=normalize(cross(sunDir,vec3(0.,1.,0.)));
        vec2 disc=vec2(dot(rd,moonAxis),dot(rd,normalize(cross(moonAxis,sunDir))))/.0105;
        float moonDisc=smoothstep(1.,.93,length(disc))*step(0.,dot(rd,sunDir));
        float lit=smoothstep(-.55,.25,disc.x+.35);
        float mare=.82+.18*sin(disc.x*5.1+1.3)*sin(disc.y*4.3);
        sky+=night*(vec3(.62,.66,.74)*moonDisc*lit*mare*2.2+vec3(.05,.07,.11)*pow(mu,40.)+vec3(.012,.016,.026)*pow(mu,6.));
        sky+=night*vec3(.55,.60,.75)*stars(rd)*smoothstep(.02,.25,rd.y)*(1.-moonDisc);
        if(rd.y>.045){
          vec4 sum=vec4(0.);
          float edge=smoothstep(.047,.22,rd.y);
          for(int i=0;i<8;i++){
            if(float(i)>=detail || sum.a>.98) break;
            float f=(float(i)+.5)/detail;
            vec3 p=rd*((360.+f*330.)/rd.y)+vec3(-240.,0.,350.);
            float envelope=pow(max(0.,sin(f*3.14159)),.7);
            float density=cloud(p)*envelope;
            float opacity=1.-exp(-density*3.15/detail);
            if(opacity>.003){
              float facing=clamp(.54+(density-cloud(p+sunDir*132.)*envelope)*1.92,0.,1.);
              vec3 cream=mix(vec3(.22,.30,.40),vec3(1.18,1.14,1.06),facing);
              cream+=vec3(.40,.23,.09)*pow(mu,10.)*(1.-density);
              cream*=mix(vec3(.013,.016,.024)+vec3(.05,.055,.07)*pow(mu,8.),vec3(1.),daylight);
              sum.rgb+=(1.-sum.a)*cream*opacity;
              sum.a+=(1.-sum.a)*opacity;
            }
          }
          sky=mix(sky,sky*(1.-sum.a)+sum.rgb,edge);
        }
        gl_FragColor=vec4(sky,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = 100;
  scene.add(sky);
  return (camera, time, clouds) => {
    sky.position.copy(camera.position);
    uniforms.time.value = time;
    uniforms.detail.value = clouds;
  };
}

const lightRig = {};

// Night system: eases between day and night and drives lights, haze, exposure and the shared
// daylight/nightShade uniforms. The moon uses the sun's direction, so the shadow map stays valid.
export function createDayNight(renderer, fog) {
  const day = { sky:new T.Color('#c4d5e5'), ground:new T.Color('#736b52'), sun:new T.Color('#fff0d6'), ambient:1.24, light:3.15, exposure:1.09 };
  const night = { sky:new T.Color('#4a5f8c'), ground:new T.Color('#1b1d1c'), sun:new T.Color('#a8bcff'), ambient:.46, light:.7, exposure:2.5 };
  const unlit = new T.Color(.058, .074, .118), white = new T.Color(1, 1, 1);
  let target = 1, value = -1;
  function apply(d) {
    value = d;
    const s = d * d * (3 - 2 * d);
    daylight.value = s;
    const { ambient, sun } = lightRig;
    ambient.color.lerpColors(night.sky, day.sky, s);
    ambient.groundColor.lerpColors(night.ground, day.ground, s);
    ambient.intensity = T.MathUtils.lerp(night.ambient, day.ambient, s);
    sun.color.lerpColors(night.sun, day.sun, s);
    sun.intensity = T.MathUtils.lerp(night.light, day.light, s);
    hazeColor.lerpColors(nightHaze, dayHaze, s);
    fog.color.copy(hazeColor);
    renderer.setClearColor(hazeColor, 1);
    renderer.toneMappingExposure = T.MathUtils.lerp(night.exposure, day.exposure, s);
    nightShade.value.lerpColors(unlit, white, s);
  }
  return {
    get night() { return target === 0; },
    set(isNight, instant = false) { target = isNight ? 0 : 1; if (instant) apply(target); },
    update(dt) {
      if (value === target) return;
      const step = dt / 3.2;
      apply(value < 0 ? target : value < target ? Math.min(target, value + step) : Math.max(target, value - step));
    },
  };
}

export function createLighting(scene) {
  // Clear-sky balance: direct sun clearly outweighs sky fill, so cast shadows read.
  const ambient = new T.HemisphereLight('#c4d5e5', '#736b52', 1.24);
  const sun = new T.DirectionalLight('#fff0d6', 3.15);
  ambient.layers.enable(1);sun.layers.enable(1);
  ambient.layers.enable(2);sun.layers.enable(2);
  sun.castShadow = true;
  const shadow = sun.shadow;
  shadow.mapSize.set(2048,2048);
  shadow.camera.left = shadow.camera.bottom = -41;
  shadow.camera.right = shadow.camera.top = 41;
  shadow.camera.near = 1;
  shadow.camera.far = 190;
  shadow.bias = -.00026;
  shadow.normalBias = .023;
  shadow.radius = 2.2;
  scene.add(ambient, sun, sun.target);
  lightRig.ambient = ambient; lightRig.sun = sun;
  if (devTools) Object.assign(devTools, { ambient, sun });
  let previousX = Infinity, previousZ = Infinity;
  return (position, enabled) => {
    const shadowChanged=sun.castShadow!==enabled;
    sun.castShadow = enabled;
    const x = Math.round(position.x/8)*8, z = Math.round((position.z-8)/8)*8;
    if (!shadowChanged && previousX === x && previousZ === z && !shadow.needsUpdate) return false;
    previousX = x;
    previousZ = z;
    sun.target.position.set(x, position.y, z);
    sun.position.copy(sun.target.position).addScaledVector(sunDirection, 102);
    sun.target.updateMatrixWorld();
    shadow.needsUpdate = enabled;
    return enabled;
  };
}

export function createPipeline(renderer) {
  const raw = new T.WebGLRenderTarget(1,1,{ type: T.HalfFloatType });
  raw.depthTexture = new T.DepthTexture(1,1,T.UnsignedIntType);
  raw.depthTexture.minFilter = raw.depthTexture.magFilter = T.NearestFilter;
  const beams = new T.WebGLRenderTarget(1,1,{ depthBuffer:false });
  const opaque = new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,depthBuffer:false});
  const plantLight = new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,depthBuffer:false});
  const clipPlanes=new T.Vector2();
  const copyOpaque=new T.ShaderMaterial({
    uniforms:{image:{value:raw.texture},depth:{value:raw.depthTexture},clipPlanes:{value:clipPlanes}},
    vertexShader:quadVertex,depthTest:false,depthWrite:false,
    fragmentShader:`
      uniform sampler2D image,depth;
      uniform vec2 clipPlanes;
      varying vec2 vUv;
      void main(){
        float d=texture2D(depth,vUv).r;
        float meters=clipPlanes.x*clipPlanes.y/mix(clipPlanes.y,clipPlanes.x,d);
        gl_FragColor=vec4(texture2D(image,vUv).rgb,meters);
      }`
  });
  const previousVP=new T.Matrix4(),inverseVP=new T.Matrix4(),previousPos=new T.Vector3(Infinity,0,0);
  const sunUv = new T.Vector2();
  const point = new T.Vector3(), forward = new T.Vector3();
  const ortho = new T.Camera();
  const effect = new T.Scene();
  const rayUniforms = {
    depth: { value: raw.depthTexture }, screenSun: { value:sunUv },
    intensity: { value:0 }, sampleCount: { value:24 }, aspect: { value:1 },
    occlusion: {value:1}, clipPlanes:{value:new T.Vector2()},
  };
  const rayMaterial = new T.ShaderMaterial({
    uniforms: rayUniforms, vertexShader: quadVertex, depthTest: false, depthWrite: false,
    fragmentShader: `
      uniform sampler2D depth;
      uniform vec2 screenSun;
      uniform float intensity,sampleCount,aspect,occlusion;
      uniform vec2 clipPlanes;
      varying vec2 vUv;
      float meters(float z){return clipPlanes.x*clipPlanes.y/mix(clipPlanes.y,clipPlanes.x,z);}
      float contactOcclusion(float depth0,float angle){
        if(occlusion<.5 || depth0>.99998)return 0.;
        float center=meters(depth0);
        if(center>35.)return 0.;
        float radius=.122/max(center,1.);
        float obscured=0.;
        for(int i=0;i<7;i++){
          float a=float(i)*2.399963+angle*6.283185;
          vec2 offset=vec2(cos(a)/aspect,sin(a))*radius*(.42+float(i)*.112);
          float difference=center-meters(texture2D(depth,vUv+offset).r);
          obscured+=smoothstep(.019,.084,difference)*(1.-smoothstep(.16,.42,difference));
        }
        return obscured*.143*(1.-smoothstep(12.,35.,center));
      }
      void main(){
        float dither=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
        float startDepth=texture2D(depth,vUv).r;
        float total=0.;
        for(int i=0;i<32;i++){
          if(float(i)>=sampleCount) break;
          float t=(float(i)+dither)/sampleCount;
          vec2 uv=mix(vUv,screenSun,t*.984);
          float z=texture2D(depth,uv).r;
          float sky=step(.9999998,z);
          vec2 radial=(uv-screenSun)*vec2(aspect,1.);
          float r2=dot(radial,radial);
          float weight=exp(-r2*22.)*.64+exp(-r2*175.)*.36;
          vec2 edge=smoothstep(vec2(0.),vec2(.055),uv)*smoothstep(vec2(0.),vec2(.055),1.-uv);
          total+=sky*weight*edge.x*edge.y*(1.-.55*t);
        }
        float haze=smoothstep(.84,.994,startDepth);
        gl_FragColor=vec4(total/max(1.,sampleCount)*intensity*(.46+.54*haze),
          contactOcclusion(startDepth,dither),0.,1.);
      }
    `,
  });
  const finalUniforms = {
    previousVP:{value:previousVP},inverseVP:{value:inverseVP},shutter:{value:0},
    image: { value:raw.texture }, ray: { value:beams.texture }, depth: { value:raw.depthTexture },
    texel: { value:new T.Vector2() }, screenSun: { value:sunUv },
    enabled: { value:1 }, flare: { value:0 }, aspect: { value:1 }, daylight,
  };
  const finalMaterial = new T.ShaderMaterial({
    uniforms: finalUniforms, vertexShader: quadVertex, depthTest:false, depthWrite:false,
    fragmentShader: `
      uniform sampler2D image,ray,depth;
      uniform vec2 texel,screenSun;
      uniform float enabled,flare,aspect,daylight;
      uniform mat4 previousVP,inverseVP;
      uniform float shutter;
      varying vec2 vUv;
      float luma(vec3 c){return dot(c,vec3(.299,.587,.114));}
      vec3 sampleImage(vec2 uv){return texture2D(image,uv).rgb;}
      void main(){
        vec3 center=sampleImage(vUv);
        vec3 nw=sampleImage(vUv+vec2(-1.,1.)*texel), ne=sampleImage(vUv+texel);
        vec3 sw=sampleImage(vUv-texel), se=sampleImage(vUv+vec2(1.,-1.)*texel);
        float a=luma(nw),b=luma(ne),c=luma(sw),d=luma(se);
        float low=min(luma(center),min(min(a,b),min(c,d)));
        float high=max(luma(center),max(max(a,b),max(c,d)));
        if(high-low > max(.028,high*.16)){
          vec2 dir=vec2(-((a+b)-(c+d)),(a+c)-(b+d));
          float reg=max((a+b+c+d)*.046,.0078);
          dir=clamp(dir/(min(abs(dir.x),abs(dir.y))+reg),-2.5,2.5)*texel;
          center=(sampleImage(vUv+dir*.23)+sampleImage(vUv-dir*.23))*.5;
        }
        vec2 scatter=texture2D(ray,vUv).rg*enabled;
        float depthHere=texture2D(depth,vUv).r;
        if(shutter>0. && depthHere>.92){
          vec4 world=inverseVP*vec4(vUv*2.-1.,depthHere*2.-1.,1.);
          vec4 old=previousVP*world;
          if(old.w>0.){
            vec2 pixels=(vUv-(old.xy/old.w*.5+.5))*shutter/texel;
            float lengthPx=length(pixels);
            if(lengthPx>.65){
              vec2 flow=pixels*texel*min(1.,4.5/lengthPx);
              float weights=2.;vec3 sum=center*2.;
              for(int j=1;j<=3;j++){
                vec2 tap=clamp(vUv-flow*float(j)/3.,0.,1.);
                float dz=abs(texture2D(depth,tap).r-depthHere);
                float weight=1.-smoothstep(.00025,max(.0005,(1.-depthHere)*.21),dz);
                sum+=sampleImage(tap)*weight;weights+=weight;
              }
              center=sum/weights;
            }
          }
        }
        center*=1.-scatter.g*.27;
        center+=vec3(.93,.77,.58)*scatter.r*smoothstep(.89,.986,depthHere);
        if(flare>.001){
          float open=step(.9999998,texture2D(depth,screenSun).r);
          vec2 rel=(vUv-screenSun)*vec2(aspect,1.);
          float r=length(rel);
          vec2 ghost=(vUv-(.5-(screenSun-.5)*.44))*vec2(aspect,1.);
          float g=length(ghost);
          center+=flare*open*(vec3(.29,.17,.074)*exp(-r*7.)
            +vec3(.065,.15,.13)*exp(-g*32.)+vec3(.05,.045,.02)*exp(-abs(g-.064)*130.)*.26);
        }
        // Night vision: rods see little colour and lean blue, the frame edges sink further.
        float scotopic=1.-daylight;
        float lum=dot(center,vec3(.2126,.7152,.0722));
        center=mix(center,lum*vec3(.78,.92,1.18),scotopic*.62);
        vec2 frame=(vUv-.5)*vec2(1.,.84);
        center*=1.-dot(frame,frame)*mix(.17,.36,scotopic);
        float grain=fract(dot(gl_FragCoord.xy,vec2(.75487766,.56984029)))-.5;
        center+=grain*mix(.0022,.0012,scotopic);
        gl_FragColor=vec4(center,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  // Temporal anti-aliasing: the projection is jittered by a Halton sequence and each frame
  // is blended into a reprojected history, clamped to the current 3x3 neighbourhood.
  const history = [0,1].map(() => new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,depthBuffer:false}));
  const jitter = new T.Vector2(), plainProjection = new T.Matrix4(), plainInverse = new T.Matrix4();
  const halton = (index, base) => { let f = 1, r = 0; while (index > 0) { f /= base; r += f*(index%base); index = Math.floor(index/base); } return r; };
  let historyIndex = 0, historyValid = false, jitterIndex = 0;
  const taaUniforms = {
    current:{value:raw.texture}, history:{value:null}, depth:{value:raw.depthTexture},
    texel:{value:finalUniforms.texel.value}, clipPlanes:{value:clipPlanes},
    inverseVP:{value:inverseVP}, previousVP:{value:previousVP}, blend:{value:1},
  };
  const taaMaterial = new T.ShaderMaterial({
    uniforms: taaUniforms, vertexShader: quadVertex, depthTest:false, depthWrite:false,
    fragmentShader: `
      uniform sampler2D current,history,depth;
      uniform vec2 texel,clipPlanes;
      uniform mat4 inverseVP,previousVP;
      uniform float blend;
      varying vec2 vUv;
      vec3 toYCoCg(vec3 c){return vec3(dot(c,vec3(.25,.5,.25)),dot(c,vec3(.5,0.,-.5)),dot(c,vec3(-.25,.5,-.25)));}
      vec3 fromYCoCg(vec3 c){return vec3(c.x+c.y-c.z,c.x+c.z,c.x-c.y-c.z);}
      // Range compression keeps bright sky and spray pixels from dominating the average.
      vec3 compress(vec3 c){return c/(1.+max(c.r,max(c.g,c.b)));}
      vec3 expand(vec3 c){return c/max(1e-4,1.-max(c.r,max(c.g,c.b)));}
      vec3 tap(vec2 offset){return toYCoCg(compress(max(texture2D(current,vUv+offset*texel).rgb,0.)));}
      void main(){
        vec3 center=tap(vec2(0.));
        vec3 low=center,high=center,sum=center,squares=center*center;
        float nearest=texture2D(depth,vUv).r;
        vec2 nearestUv=vUv;
        const vec2 ring[8]=vec2[8](vec2(-1,-1),vec2(0,-1),vec2(1,-1),vec2(-1,0),vec2(1,0),vec2(-1,1),vec2(0,1),vec2(1,1));
        for(int i=0;i<8;i++){
          vec2 o=ring[i];
          vec3 c=tap(o);
          low=min(low,c);high=max(high,c);sum+=c;squares+=c*c;
          float d=texture2D(depth,vUv+o*texel).r;
          if(d<nearest){nearest=d;nearestUv=vUv+o*texel;}
        }
        vec3 mean=sum/9.,deviation=sqrt(max(squares/9.-mean*mean,0.));
        low=max(low,mean-deviation*1.25);high=min(high,mean+deviation*1.25);
        float meters=clipPlanes.x*clipPlanes.y/mix(clipPlanes.y,clipPlanes.x,nearest);
        vec2 previousUv=vUv;
        // The glove and blade move with the camera, so their history stays in place.
        if(meters>1.1){
          vec4 world=inverseVP*vec4(vUv*2.-1.,nearest*2.-1.,1.);
          vec4 old=previousVP*vec4(world.xyz/world.w,1.);
          previousUv=old.xy/old.w*.5+.5;
        }
        vec3 result=center;
        if(blend<1. && all(greaterThanEqual(previousUv,vec2(0.))) && all(lessThanEqual(previousUv,vec2(1.)))){
          vec3 past=toYCoCg(compress(max(texture2D(history,previousUv).rgb,0.)));
          past=clamp(past,low,high);
          float motion=length((vUv-previousUv)/texel);
          result=mix(past,center,clamp(blend+motion*.006,blend,.4));
        }
        gl_FragColor=vec4(expand(max(fromYCoCg(result),0.)),1.);
      }
    `,
  });
  finalUniforms.sharpen = { value:0 };
  finalMaterial.fragmentShader = finalMaterial.fragmentShader
    .replace('uniform float shutter;','uniform float shutter,sharpen;')
    .replace('if(high-low > max(.028,high*.16)){','if(sharpen>0.){\n          center=max(center+(center-(nw+ne+sw+se)*.25)*sharpen,0.);\n        } else if(high-low > max(.028,high*.16)){');
  // GPU frame time from timer queries. The resolution scaler uses it to find headroom even
  // when the frame rate is capped by vsync. The bench profiler times draws itself, so skip then.
  const gl = renderer.getContext();
  const timer = window.__prof ? null : gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pendingQueries = [];
  let gpuTime = null;
  const beginTimer = () => {
    if (!timer || pendingQueries.length > 6) return null;
    const query = gl.createQuery();
    gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    return query;
  };
  const endTimer = query => {
    if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); pendingQueries.push(query); }
    while (pendingQueries.length && gl.getQueryParameter(pendingQueries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const done = pendingQueries.shift();
      const ms = gl.getQueryParameter(done, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(done);
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpuTime = gpuTime === null ? ms : gpuTime * .85 + ms * .15;
    }
  };
  if (devTools) Object.assign(devTools, { renderer, finalUniforms, rayUniforms, taaUniforms });
  const quad = new T.Mesh(new T.PlaneGeometry(2,2),finalMaterial);
  quad.frustumCulled = false;
  effect.add(quad);
  return {
    groundImage:{value:opaque.texture},
    plantLight:{value:plantLight.texture},
    get gpuTime() { return gpuTime; },
    resize(w,h,scale,rayScale) {
      const width = Math.max(2, Math.floor(w*scale)), height = Math.max(2, Math.floor(h*scale));
      // On high-density screens the canvas may grow up to device pixels, so a scale above 1 stays sharp.
      const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const displayScale=Math.min(density,Math.max(.64,scale*1.08));
      renderer.setSize(Math.max(2,Math.floor(w*displayScale)),Math.max(2,Math.floor(h*displayScale)),false);
      raw.setSize(width,height);
      opaque.setSize(Math.max(2,width>>1),Math.max(2,height>>1));
      plantLight.setSize(Math.max(2,width>>2),Math.max(2,height>>2));
      beams.setSize(Math.max(2,Math.floor(width*rayScale)),Math.max(2,Math.floor(height*rayScale)));
      history.forEach(target=>target.setSize(width,height));
      historyValid=false;
      finalUniforms.texel.value.set(1/width,1/height);
      finalUniforms.aspect.value = rayUniforms.aspect.value = w/h;
    },
    draw(scene,camera,quality,river,dt,motion) {
      const frameQuery=beginTimer();
      const taa=quality.taa!==false;
      plainProjection.copy(camera.projectionMatrix);
      plainInverse.copy(camera.projectionMatrixInverse);
      if(taa){
        jitterIndex=jitterIndex%8+1;
        jitter.set((halton(jitterIndex,2)-.5)*2/raw.width,(halton(jitterIndex,3)-.5)*2/raw.height);
        camera.projectionMatrix.elements[8]+=jitter.x;
        camera.projectionMatrix.elements[9]+=jitter.y;
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      }
      renderer.setRenderTarget(raw);
      renderer.render(scene,camera);
      clipPlanes.set(camera.near,camera.far);
      quad.material=copyOpaque;
      renderer.setRenderTarget(plantLight);
      renderer.render(effect,ortho);
      const visibleLayers=camera.layers.mask;
      renderer.setRenderTarget(raw);
      renderer.autoClear=false;
      camera.layers.set(2);
      renderer.render(scene,camera);
      camera.layers.mask=visibleLayers;
      renderer.setRenderTarget(opaque);
      renderer.render(effect,ortho);
      river.uniforms.opaque.value=opaque.texture;
      river.uniforms.size.value.set(raw.width,raw.height);
      renderer.setRenderTarget(raw);
      renderer.render(river.scene,camera);
      camera.layers.set(1);
      renderer.render(scene,camera);
      camera.layers.mask=visibleLayers;
      // Air effects (shafts, mist, dust) go last so the grass cannot paint over them.
      if(this.overlay)renderer.render(this.overlay,camera);
      renderer.autoClear=true;
      camera.projectionMatrix.copy(plainProjection);
      camera.projectionMatrixInverse.copy(plainInverse);
      inverseVP.multiplyMatrices(camera.matrixWorld,plainInverse);
      const continuous=previousPos.distanceTo(camera.position)<3.5;
      finalUniforms.shutter.value=motion&&continuous?Math.min(.48,.0055/Math.max(.001,dt)):0;
      finalUniforms.image.value=raw.texture;
      finalUniforms.sharpen.value=0;
      if(taa){
        const read=history[historyIndex],write=history[1-historyIndex];
        taaUniforms.history.value=read.texture;
        taaUniforms.blend.value=historyValid&&continuous?.1:1;
        quad.material=taaMaterial;
        renderer.setRenderTarget(write);
        renderer.render(effect,ortho);
        historyIndex=1-historyIndex;historyValid=true;
        finalUniforms.image.value=write.texture;
        finalUniforms.sharpen.value=.2;
      } else historyValid=false;
      camera.getWorldDirection(forward);
      const alignment = forward.dot(sunDirection);
      point.copy(camera.position).addScaledVector(sunDirection,900).project(camera);
      sunUv.set(point.x*.5+.5,point.y*.5+.5);
      const offscreen = Math.max(Math.abs(point.x),Math.abs(point.y));
      const fade = alignment > 0 ? T.MathUtils.smoothstep(2.35-offscreen,0,1.1) : 0;
      finalUniforms.enabled.value = 0;
      finalUniforms.flare.value = offscreen < 1 ? fade*.17*daylight.value : 0;
      const raySamples=fade>.005?quality.rays:0;
      if (raySamples || quality.ao) {
        finalUniforms.enabled.value = 1;
        rayUniforms.intensity.value = fade * .25 * daylight.value;
        rayUniforms.sampleCount.value = raySamples;
        rayUniforms.occlusion.value = Number(quality.ao);
        rayUniforms.clipPlanes.value.set(camera.near,camera.far);
        quad.material = rayMaterial;
        renderer.setRenderTarget(beams);
        renderer.render(effect,ortho);
      }
      quad.material = finalMaterial;
      renderer.setRenderTarget(null);
      renderer.render(effect,ortho);
      if(this.postOverlay){
        renderer.autoClear=false;
        renderer.render(this.postOverlay,camera);
        renderer.autoClear=true;
      }
      previousVP.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      previousPos.copy(camera.position);
      endTimer(frameQuery);
    },
  };
}
