import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const auth = read('src/security/auth-session.js');
const security = read('src/security/security.js');
const login = read('src/api/login-api.js');
const oauth = read('src/api/oauth-api.js');
const hono = read('src/hono/hono.js');
const index = read('src/index.js');

assert.match(auth, /__Host-cfmail_session/);
assert.match(auth, /httpOnly:\s*true/);
assert.match(auth, /sameSite:\s*'Strict'/);
assert.match(auth, /X-CSRF-Token/);
assert.match(security, /assertCookieCsrf/);
assert.match(security, /getAuthToken/);
assert.match(login, /setWebSession/);
assert.match(login, /authenticated:\s*true/);
assert.match(oauth, /setWebSession/);
assert.match(hono, /Access-Control-Allow-Credentials/);
assert.match(hono, /Content-Security-Policy/);
assert.match(index, /secureStaticResponse/);
assert.match(index, /frame-ancestors 'none'/);
assert.match(index, /object-src 'none'/);

console.log('✅ HttpOnly web session + CSRF + CSP contract PASS');
