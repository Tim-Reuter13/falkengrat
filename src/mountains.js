import * as T from 'three';
import { hazeColor, nightShade } from './atmosphere.js';

function arc(radius,bottom,height,heading,width,repeat) {
  const vertices=[], uv=[], indices=[];
  const segments=112;
  for(let i=0;i<=segments;i++){
    const u=i/segments, angle=heading+(u-.5)*width;
    const x=Math.sin(angle)*radius, z=-Math.cos(angle)*radius-47;
    vertices.push(x,bottom,z,x,bottom+height,z);
    uv.push(u*repeat,0,u*repeat,1);
    if(i<segments){
      const a=i*2;
      indices.push(a,a+1,a+2,a+1,a+3,a+2);
    }
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);
  return geometry;
}

export function createMountainScenery(scene,textures) {
  const bands=[
    {map:textures.foothills,radius:1650,bottom:-198,height:795,heading:2.52,width:Math.PI*2,repeat:2,haze:.34},
    {map:textures.alps,radius:1200,bottom:-180,height:951,heading:.46,width:1.97,repeat:1,haze:.13},
  ];
  bands.forEach((band,index)=>{
    if(!band.map)return;
    const material=new T.ShaderMaterial({
      uniforms:{portrait:{value:band.map},fogTint:{value:hazeColor},haze:{value:band.haze},wrap:{value:index===0?1:0},nightShade},
      side:T.DoubleSide,depthWrite:false,
      vertexShader:`
        varying vec2 picture;
        void main(){
          picture=uv;
          vec4 clip=projectionMatrix*vec4(mat3(viewMatrix)*position,1.);
          gl_Position=clip.xyww;
        }
      `,
      fragmentShader:`
        uniform sampler2D portrait;
        uniform vec3 fogTint,nightShade;
        uniform float haze,wrap;
        varying vec2 picture;
        void main(){
          vec2 coord=picture;
          if(wrap>.5){
            coord.x=1.-abs(mod(coord.x,2.)-1.);
          }else{
            // Lower both extremities into the foothills before fading the texture seam.
            float crest=smoothstep(.0,.16,picture.x)*smoothstep(.0,.20,1.-picture.x);
            coord.y=.072+(coord.y-.072)/mix(.27,1.,crest);
            if(coord.y>1.)discard;
          }
          vec4 pixel=texture2D(portrait,coord);
          float edge=wrap>.5?1.:smoothstep(0.,.023,picture.x)*smoothstep(0.,.023,1.-picture.x);
          float coverage=pixel.a*edge;
          float threshold=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
          if(coverage<mix(.22,.77,threshold))discard;
          vec3 base=pixel.rgb*vec3(.97,.99,1.03);
          float valley=1.-smoothstep(.045,.43,picture.y);
          base*=nightShade;
          base=mix(base,fogTint*.94,haze+valley*(.76-haze));
          gl_FragColor=vec4(base,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const model = new T.Mesh(arc(band.radius,band.bottom,band.height,band.heading,band.width,band.repeat),material);
    model.frustumCulled=false;
    model.renderOrder=101+index;
    scene.add(model);
  });
}
