import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import cryptoUtils from '../src/utils/crypto-utils';
import rateLimitService from '../src/service/rate-limit-service';
import settingService from '../src/service/setting-service';

describe('CloudMail runtime smoke', () => {
	it('serves the real health endpoint through the Worker entrypoint', async () => {
		const response = await SELF.fetch('http://example.com/api/health');
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.service).toBe('cloud-mail');
		expect(body.ready).toBe(true);
		expect(body.checks).toBeUndefined();
	});

	it('keeps the retired URL-secret init endpoint inert', async () => {
		const response = await SELF.fetch('http://example.com/api/init/should-never-be-consumed');
		expect(response.status).toBe(410);
		expect(await response.text()).toContain('X-Init-Secret');
	});

	it('does not expose detailed dependency health anonymously', async () => {
		const response = await SELF.fetch('http://example.com/api/health/detail');
		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body?.data?.checks ?? body?.checks).toBeUndefined();
	});

	it('hashes new passwords at the Workers-supported PBKDF2 cost while accepting old hashes for rehash', async () => {
		expect(cryptoUtils.iterationsFromEnv({})).toBe(100_000);
		expect(cryptoUtils.iterationsFromEnv({ password_pbkdf2_iterations: '600000' })).toBe(100_000);
		const created = await cryptoUtils.hashPassword('correct horse battery staple', cryptoUtils.iterationsFromEnv({ password_pbkdf2_iterations: '600000' }));
		expect(created.hash).toMatch(/^pbkdf2-sha256\$100000\$/);
		expect(cryptoUtils.iterationsFromEnv({ password_pbkdf2_iterations: '1' })).toBe(100_000);
		const salt = cryptoUtils.generateSalt();
		const legacy = await cryptoUtils.genHashPassword('correct horse battery staple', salt, 100_000);
		expect(await cryptoUtils.verifyPassword('correct horse battery staple', salt, legacy)).toBe(true);
		expect(cryptoUtils.needsRehash(legacy, 100_000)).toBe(false);
	});
	it('never asks workerd for more PBKDF2 iterations than it supports (admin add-user 500 regression)', async () => {
		// Deployed Workers reject PBKDF2 above 100000 iterations (local workerd does not enforce it);
		// before the fix the default was 150000, so /user/add, /register and password resets all
		// failed in production with an internal server error.
		for (const configured of [undefined, '100000', '150000', '2000000']) {
			expect(cryptoUtils.iterationsFromEnv({ password_pbkdf2_iterations: configured })).toBeLessThanOrEqual(100_000);
		}
		const { salt, hash } = await cryptoUtils.hashPassword('admin-created-password-123', 600_000);
		expect(hash.startsWith('pbkdf2-sha256$100000$')).toBe(true);
		expect(await cryptoUtils.verifyPassword('admin-created-password-123', salt, hash)).toBe(true);
		expect(await cryptoUtils.verifyPassword('wrong', salt, 'pbkdf2-sha256$150000$AAAA')).toBe(false);
	});

	it('lets the admin add a user mailbox from the backend (POST /user/add)', async () => {
		const init = await SELF.fetch('http://example.com/api/init', {
			method: 'POST',
			headers: { 'X-Init-Secret': env.init_secret }
		});
		expect(init.status).toBe(200);

		const json = { 'Content-Type': 'application/json' };
		const register = await SELF.fetch('http://example.com/api/register', {
			method: 'POST', headers: json,
			body: JSON.stringify({ email: 'admin@example.com', password: 'admin-password-123' })
		});
		expect((await register.json()).code).toBe(200);

		const login = await SELF.fetch('http://example.com/api/login', {
			method: 'POST', headers: json,
			body: JSON.stringify({ email: 'admin@example.com', password: 'admin-password-123' })
		});
		const { data: { token } } = await login.json();
		const auth = { ...json, Authorization: `Bearer ${token}` };

		const roles = await (await SELF.fetch('http://example.com/api/role/selectUse', { headers: auth })).json();
		const type = roles.data[0].roleId;
		const add = await SELF.fetch('http://example.com/api/user/add', {
			method: 'POST', headers: auth,
			body: JSON.stringify({ email: 'new-user@example.com', password: 'new-user-password', type })
		});
		expect(await add.json()).toMatchObject({ code: 200 });

		// 未指定身份时使用默认身份(上游 v3.3 开放 API 行为)
		const addDefault = await SELF.fetch('http://example.com/api/user/add', {
			method: 'POST', headers: auth,
			body: JSON.stringify({ email: 'default-role@example.com', password: 'new-user-password' })
		});
		expect(await addDefault.json()).toMatchObject({ code: 200 });

		const newLogin = await SELF.fetch('http://example.com/api/login', {
			method: 'POST', headers: json,
			body: JSON.stringify({ email: 'new-user@example.com', password: 'new-user-password' })
		});
		expect((await newLogin.json()).code).toBe(200);
	});

	it('re-adds upstream setting columns when a deploy skipped /init', async () => {
		await SELF.fetch('http://example.com/api/init', { method: 'POST', headers: { 'X-Init-Secret': env.init_secret } });
		await env.db.prepare('ALTER TABLE setting DROP COLUMN webhook_secret').run();
		await env.db.prepare('ALTER TABLE setting DROP COLUMN google_switch').run();
		const row = await settingService.refresh({ env, set() {}, get() {} });
		expect(row.webhookSecret).toBe('');
		expect(row.googleSwitch).toBe(1);
		const columns = (await env.db.prepare('PRAGMA table_info(setting)').all()).results.map(item => item.name);
		expect(columns).toContain('webhook_secret');
		expect(columns).toContain('google_switch');
	});

	it('uses D1 atomic rate-limit buckets once the migration is present', async () => {
		await env.db.prepare(`CREATE TABLE IF NOT EXISTS rate_limit_bucket (bucket_key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL)`).run();
		await env.db.prepare(`DELETE FROM rate_limit_bucket`).run();
		const context = {
			env,
			req: { header: name => name === 'CF-Connecting-IP' ? '203.0.113.9' : '' }
		};
		await rateLimitService.check(context, 'vitest-login', { limit: 2, windowSeconds: 60 });
		await rateLimitService.check(context, 'vitest-login', { limit: 2, windowSeconds: 60 });
		await expect(rateLimitService.check(context, 'vitest-login', { limit: 2, windowSeconds: 60 })).rejects.toMatchObject({ code: 429 });
		const row = await env.db.prepare(`SELECT count FROM rate_limit_bucket LIMIT 1`).first();
		expect(Number(row.count)).toBe(3);
	});


	it('publishes the versioned API/OpenAPI compatibility surface', async () => {
		const doc = await SELF.fetch('http://example.com/api/v1/openapi.json');
		expect(doc.status).toBe(200);
		expect(doc.headers.get('X-CloudMail-API-Version')).toBe('1');
		const body = await doc.json();
		expect(body.openapi).toMatch(/^3\./);
		expect(body.info?.title).toContain('CloudMail');
		expect(Object.keys(body.paths || {}).length).toBeGreaterThan(20);
	});

});
