import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'openapi/cloudmail-v1.openapi.json')));
if (spec.openapi !== '3.1.0') throw new Error('OpenAPI 3.1 contract missing');
if (!spec.servers.some(x => x.url === '/api/v1') || !spec.servers.some(x => x.url === '/api')) throw new Error('v1 + legacy servers missing');
const re = /app\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;
const source = new Set();
for (const file of fs.readdirSync(path.join(root, 'src/api')).filter(x=>x.endsWith('.js'))) {
  const text=fs.readFileSync(path.join(root,'src/api',file),'utf8');
  for (const m of text.matchAll(re)) source.add(`${m[1]} ${m[2].replace(/:([A-Za-z0-9_]+)/g,'{$1}').replace(/\/\*$/,'/{path}')}`);
}
const documented = new Set();
for (const [route, methods] of Object.entries(spec.paths)) for (const method of Object.keys(methods)) documented.add(`${method} ${route}`);
const missing=[...source].filter(x=>!documented.has(x));
const stale=[...documented].filter(x=>!source.has(x));
if (missing.length || stale.length) throw new Error(`OpenAPI drift missing=${missing.join(',')} stale=${stale.join(',')}`);
const index=fs.readFileSync(path.join(root,'src/index.js'),'utf8');
if (!index.includes("'/api/v1/'") || !index.includes("'/api/openapi.json'")) throw new Error('API v1/OpenAPI runtime aliases missing');
console.log(`✅ OpenAPI/versioning contract PASS (${source.size} operations)`);
