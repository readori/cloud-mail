import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const src = path.join(root, 'src');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(vue|js|ts)$/.test(entry.name)) files.push(p);
  }
}
walk(src);
const violations = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (/console\.log\s*\(/.test(text)) violations.push(`${path.relative(root, file)}: console.log`);
  if (/dangerouslyUseHTMLString\s*:\s*true/.test(text)) violations.push(`${path.relative(root, file)}: dangerouslyUseHTMLString`);
}
const router = fs.readFileSync(path.join(src, 'router/index.js'), 'utf8');
if (/path\s*:\s*['\"]\/test['\"]/.test(router)) violations.push('src/router/index.js: production /test route');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/vite\s+preview(?=.*--mode\s+release)(?=.*--outDir\s+\.\.\/mail-worker\/dist)/.test(pkg.scripts?.preview || '')) {
  violations.push('package.json: preview must use release mode and explicitly serve ../mail-worker/dist');
}
const releaseEnv = fs.readFileSync(path.join(root, '.env.release'), 'utf8');
if (!/^\s*VITE_OUT_DIR\s*=\s*\.\.\/mail-worker\/dist\s*$/m.test(releaseEnv)) {
  violations.push('.env.release: VITE_OUT_DIR must remain ../mail-worker/dist for Worker Assets');
}
if (violations.length) throw new Error(`production hygiene violations:\n${violations.join('\n')}`);
console.log('✅ Web production hygiene: no /test, console.log, dangerous HTML errors PASS');
