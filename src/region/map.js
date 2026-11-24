import { sites } from './layout.js';
import { toMap } from './geography.js';
import { drawPlan } from './plan.js';

export function createTrailMap({player, pause, launch, active, travel}){
  const dialog=document.getElementById('trail-map'), plan=document.getElementById('trail-plan');
  const art=document.getElementById('trail-art'), mode=document.getElementById('trail-mode');
  const close=document.getElementById('trail-close');
  let resume=false;
  function open(){
    if(dialog.open)return;
    resume=active();
    if(resume)pause();
    const point=toMap(player.ground.x,player.ground.z);
    drawPlan(plan,point);
    dialog.showModal();
    close.focus();
  }
  function finish(play){
    dialog.close();
    if(play)launch();
  }
  mode.addEventListener('click',()=>{
    plan.hidden=!plan.hidden;art.hidden=!plan.hidden;
    mode.textContent=plan.hidden?'Routenplan':'Wanderkarte';
  });
  close.addEventListener('click',()=>finish(resume));
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish(resume);});
  dialog.addEventListener('keydown',e=>{
    if(e.code==='KeyK'&&!e.repeat){e.preventDefault();e.stopPropagation();finish(resume);}
  });
  dialog.querySelectorAll('[data-destination]').forEach(button=>button.addEventListener('click',()=>{
    travel(sites[button.dataset.destination]);finish(true);
  }));
  document.getElementById('open-trail-map').addEventListener('click',open);
  return {open};
}
