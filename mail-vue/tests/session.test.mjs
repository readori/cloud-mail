import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { removed: [], removeItem(k){ this.removed.push(k); } };
globalThis.document = { cookie: 'other=1; cfmail_csrf=abc%20123; x=2' };
const session = await import('../src/auth/session.js');

test('auth state is memory-only', () => {
  session.setAuthenticated(true); assert.equal(session.isAuthenticated(), true);
  session.setAuthenticated(false); assert.equal(session.isAuthenticated(), false);
});
test('legacy token is removed but never read', () => {
  session.purgeLegacyAuthToken(); assert.deepEqual(globalThis.localStorage.removed, ['token']);
});
test('csrf cookie is decoded', () => assert.equal(session.readCsrfToken(), 'abc 123'));
