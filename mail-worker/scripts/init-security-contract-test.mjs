import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const initApi = fs.readFileSync(path.join(root, 'src/api/init-api.js'), 'utf8');
const initCore = fs.readFileSync(path.join(root, 'src/init/init.js'), 'utf8');
const security = fs.readFileSync(path.join(root, 'src/security/security.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(initApi.includes("app.post('/init'"), 'POST /init route is missing');
assert(initApi.includes("c.req.header('X-Init-Secret')"), 'POST /init must read X-Init-Secret');
assert(initApi.includes("app.get('/init/:secret'"), 'Legacy GET tombstone route is missing');
assert(initApi.includes('410'), 'Legacy GET /init/:secret must return 410 Gone');
assert(!initApi.includes("c.req.param('secret')"), 'Legacy URL secret must never be read');
assert(!initApi.includes("dbInit.init(c, c.req.param"), 'Legacy GET must never call database initialization');
assert(initCore.includes('c.env.init_secret'), 'Dedicated init_secret binding is missing');
assert(!initCore.includes('c.env.jwt_secret'), 'Database initialization must never fall back to JWT secret');
assert(initCore.includes('this.isLocked(c.env?.init_locked)'), 'INIT_LOCKED maintenance guard is missing');
assert(initCore.includes("return c.text('Database initialization is locked', 423)"), 'Locked initialization must fail closed with 423');
assert(security.includes("['POST', '/init']"), 'POST /init must remain reachable before JWT auth');
assert(security.includes("['GET', /^\\/init\\/[^/]+$/]"), 'Legacy 410 tombstone must remain reachable without JWT');

console.log('✅ Database initialization security contract PASS');
console.log('   - POST /init + X-Init-Secret only');
console.log('   - GET /init/:secret is a 410 tombstone and never reads the URL secret');
console.log('   - init_secret is independent from JWT secret; INIT_LOCKED maintenance guard is present');
