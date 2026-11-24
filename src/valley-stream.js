export function riverX(z) {
  return 12.5+9.2*Math.sin((z+30)*.035)+5.8*Math.sin((z+24)*.062)+.009*z-10*Math.exp(-((z-2)**2)/580);
}

export function riverWidth(z) {
  return 3.65+1.05*Math.sin(z*.040+1.1)+.65*Math.sin(z*.093);
}

export const waterLevel=z=>6.7-z*.034+.09*Math.sin(z*.15);
export const riverBank=(x,z)=>Math.abs(x-riverX(z))-riverWidth(z);
export const channelSlope=z=>(riverX(z+.2)-riverX(z-.2))/.4;
export const riverSpeed=z=>1.15+.37*Math.sin(z*.071+.35)+.24*Math.sin(z*.139+1.4);
