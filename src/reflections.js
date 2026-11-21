import * as T from 'three';

// Separate read and write cubes so a blade never shows half of two different locations.
export function createBladeProbe(renderer,scene,river) {
  const makeTarget=()=>new T.WebGLCubeRenderTarget(128,{type:T.HalfFloatType,generateMipmaps:true,
    minFilter:T.LinearMipmapLinearFilter,magFilter:T.LinearFilter});
  let back=makeTarget(),front=makeTarget();
  const uniform={value:front.texture};
  const probe=new T.CubeCamera(.12,3400,back);
  probe.coordinateSystem=renderer.coordinateSystem;
  probe.updateCoordinateSystem();
  probe.layers.enable(2);
  const origin=new T.Vector3(Infinity,0,0);
  let face=0,age=100,revision=0;
  function update(dt,position,rig,quality) {
    age+=dt;
    if(!rig.visible)return;
    const distance=origin.distanceToSquared(position);
    const teleported=distance>24**2;
    if(face===0 && age<(quality.shadows?1.85:3.2) && distance<6)return;
    if(teleported)face=0;
    if(face===0){
      origin.copy(position);probe.position.copy(position);probe.updateMatrixWorld(true);age=0;
    }
    const previous=renderer.getRenderTarget();
    const auto=renderer.autoClear,shadowRequest=renderer.shadowMap.needsUpdate;
    renderer.shadowMap.needsUpdate=false;
    rig.visible=false;river.uniforms.probePass.value=1;
    const count=teleported||revision===0?6:1;
    try{
      for(let i=0;i<count && face<6;i++,face++){
        back.texture.generateMipmaps=face===5;
        renderer.setRenderTarget(back,face);
        renderer.autoClear=true;
        renderer.render(scene,probe.children[face]);
        renderer.autoClear=false;
        renderer.render(river.scene,probe.children[face]);
      }
      if(face===6){[front,back]=[back,front];uniform.value=front.texture;face=0;revision++;}
    }finally{
      river.uniforms.probePass.value=0;rig.visible=true;renderer.autoClear=auto;
      renderer.shadowMap.needsUpdate=shadowRequest;renderer.setRenderTarget(previous);
    }
  }
  return {uniform,update,get captures(){return revision;}};
}
