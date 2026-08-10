import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(root, 'src');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|vue)$/.test(entry.name)) files.push(full);
  }
}
walk(sourceRoot);
const all = files.map(file => [file, fs.readFileSync(file, 'utf8')]);

for (const [file, text] of all) {
  assert.doesNotMatch(text, /localStorage\.(?:getItem|setItem)\(['"]token['"]/, `auth token persistence in ${file}`);
  assert.doesNotMatch(text, /dangerouslyUseHTMLString\s*:\s*true/, `dangerous Element Plus HTML in ${file}`);
  assert.doesNotMatch(text, /\.innerHTML\s*=/, `direct innerHTML assignment in ${file}`);
}
const axios = fs.readFileSync(path.join(sourceRoot, 'axios/index.js'), 'utf8');
const session = fs.readFileSync(path.join(sourceRoot, 'auth/session.js'), 'utf8');
const safeHtml = fs.readFileSync(path.join(sourceRoot, 'utils/safe-html.js'), 'utf8');
assert.match(axios, /withCredentials:\s*true/);
assert.match(axios, /X-CFMail-Web/);
assert.match(axios, /X-CSRF-Token/);
assert.match(session, /purgeLegacyAuthToken/);
assert.match(safeHtml, /BLOCKED_TAGS/);
assert.match(safeHtml, /replaceChildren/);
assert.match(safeHtml, /javascript:/);

console.log('✅ Web localStorage/XSS client hardening contract PASS');
