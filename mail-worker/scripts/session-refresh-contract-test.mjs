import fs from 'node:fs';
import assert from 'node:assert/strict';

const service = fs.readFileSync(new URL('../src/service/login-service.js', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api/login-api.js', import.meta.url), 'utf8');
const security = fs.readFileSync(new URL('../src/security/security.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0004_refresh_sessions.sql', import.meta.url), 'utf8');

assert.match(api, /app\.post\('\/refresh'/);
assert.match(security, /\['POST', '\/refresh'\]/);
assert.match(service, /crypto\.subtle\.digest\('SHA-256'/);
assert.match(service, /DELETE FROM refresh_session WHERE refresh_hash = \? AND expires_at > \?/);
assert.match(service, /Number\(consumed\?\.meta\?\.changes \|\| 0\) !== 1/);
assert.match(service, /REFRESH_TOKEN_EXPIRE/);
assert.doesNotMatch(migration, /refresh_token\s+TEXT/i, 'plaintext refresh token column is forbidden');
assert.match(migration, /refresh_hash TEXT PRIMARY KEY/);
assert.match(migration, /ON DELETE CASCADE/);
assert.match(service, /DELETE FROM refresh_session WHERE user_id = \? AND session_token = \?/);
assert.match(service, /DELETE FROM refresh_session WHERE expires_at <= \?/);

console.log('CloudMail refresh-session rotation contract: PASS');
