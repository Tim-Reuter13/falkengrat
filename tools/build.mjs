import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)??resolve(root,'dist/Falkengrat.html'));
const bake=process.argv.includes('--bake');
const files={
  earth:'earth.jpg',moss:'moss.jpg',granite:'granite.jpg',bark:'bark.jpg',
  groundNormal:'earth-normal.png',rockNormal:'granite-normal.png',barkNormal:'bark-normal.png',
  fir:'fir.webp',spruce:'spruce.webp',fern:'fern.webp',sprig:'fir-branch.webp',
  alps:'alps.webp',foothills:'foothills.webp',hand:'hand.glb',sword:'schwert.glb',feathers:'raven-feathers.webp',props:'woodland-clutter.webp',
  endgrain:'endgrain.webp',endgrainNormal:'endgrain-normal.webp',soilSwatches:'soil-swatches.webp',soilNormals:'soil-normal.webp',
  foam:'foam-cells.webp',
  habitat:'habitat-atlas.webp',
  meadow:'meadow.jpg',turf:'woodland-turf.jpg',needles:'needle-bed.jpg',limestone:'limestone.jpg',
  meadowNormal:'meadow-normal.webp',limestoneNormal:'limestone-normal.webp',
  ...(bake?{}:{atlasFir:'impostor-fir.png',atlasSpruce:'impostor-spruce.png'}),
  cannibal:'kannibale.glb',boneDagger:'knochendolch.glb',
};
// Recorded CC0 sounds (assets/sfx/CREDITS.json), embedded as sfx/<name>.
for(const file of (await readdir(resolve(root,'assets/sfx'))).filter(f=>f.endsWith('.mp3')).sort())files['sfx/'+file.slice(0,-4)]='sfx/'+file;
const types={'.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.glb':'model/gltf-binary','.mp3':'audio/mpeg'};
const entries=await Promise.all(Object.entries(files).map(async ([key,file])=>{
  const data=await readFile(resolve(root,'assets',file));
  return [key,`data:${types[extname(file)]};base64,${data.toString('base64')}`];
}));
const result=await build({
  entryPoints:[resolve(root,'src/main.js')],bundle:true,write:false,format:'iife',
  target:'es2022',minify:true,legalComments:'inline',
  plugins:[{
    name:'embedded-textures',
    setup(builder){
      builder.onResolve({filter:/^game-assets$/},()=>({path:'game-assets',namespace:'embedded'}));
      builder.onLoad({filter:/.*/,namespace:'embedded'},()=>({contents:'export default '+JSON.stringify(Object.fromEntries(entries)),loader:'js'}));
    },
  }],
});
const template=await readFile(resolve(root,'src/index.html'),'utf8');
const style=await readFile(resolve(root,'src/style.css'),'utf8');
// Main and pause menu: styles follow the game styles, the controller runs after the game script.
const poster=await readFile(resolve(root,'assets/menu-panorama.webp'));
const menuStyle=(await readFile(resolve(root,'src/menu.css'),'utf8'))
  .replace('/* FG_POSTER */',()=>'data:image/webp;base64,'+poster.toString('base64'));
const menuCode=(await readFile(resolve(root,'src/menu.js'),'utf8')).replace(/<\/script/gi,'<\\/script');
const notice=await readFile(resolve(root,'node_modules/three/LICENSE'),'utf8');
const source=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const html=template.replace('/* GAME_STYLES */',()=>style+'\n'+menuStyle).replace('/* GAME_CODE */',()=>source).replace('/* MENU_CODE */',()=>menuCode)
  .replace('</body>',()=>`<!-- Three.js\n${notice}\n-->\n</body>`);
await mkdir(dirname(output),{recursive:true});
await writeFile(output,html);
console.log(output+' ('+(Buffer.byteLength(html)/1024/1024).toFixed(2)+' MiB)');
