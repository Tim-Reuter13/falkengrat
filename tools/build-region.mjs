import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? resolve(root, 'dist'));
const source = resolve(root, 'src/region');
const [page, style, image, js, notice] = await Promise.all([
  readFile(resolve(source, 'index.html'), 'utf8'),
  readFile(resolve(source, 'style.css'), 'utf8'),
  readFile(resolve(root, 'assets/oldhoffen-wanderkarte.webp')),
  build({ entryPoints: [resolve(source, 'main.js')], bundle: true, minify: true,
    write: false, format: 'iife', target: 'es2022', legalComments: 'inline' }),
  readFile(resolve(root, 'node_modules/three/LICENSE'), 'utf8'),
  promisify(execFile)(process.execPath, [
    resolve(root, 'tools/build.mjs'), '--out=' + resolve(output, 'Falkengrat-Wald.html'),
  ]),
]);
const html = page.replace('/* REGION_STYLES */', () => style)
  .replace('/* REGION_ART */', () => 'data:image/webp;base64,' + image.toString('base64'))
  .replace('/* REGION_CODE */', () => js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'))
  .replace('</body>', () => `<!-- Three.js\n${notice}\n-->\n</body>`);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'Falkengrat-Region.html'), html);
console.log(resolve(output, 'Falkengrat-Region.html'));
