import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pages=process.argv[2]==='--pages';
const output=pages?resolve(root,'docs/region'):resolve(process.argv[2]??resolve(root,'dist'));
await mkdir(output,{recursive:true});
if(!pages)await promisify(execFile)(process.execPath,[resolve(root,'tools/build.mjs'),'--out='+resolve(output,'Falkengrat-Wald.html')]);
const template=await readFile(resolve(root,'src/region/index.html'),'utf8');
await writeFile(resolve(output,pages?'index.html':'Falkengrat-Region.html'),template.replace('/* WORLD_URL */',pages?'../':'Falkengrat-Wald.html'));
