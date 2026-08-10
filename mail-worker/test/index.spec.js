import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import cryptoUtils from '../src/utils/crypto-utils';
import rateLimitService from '../src/service/rate-limit-service';

describe('CloudMail runtime smoke', () => {
	it('serves the real health endpoint through the Worker entrypoint', async () => {
		const response = await SELF.fetch('http://example.com/api/health');
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.service).toBe('cloud-mail');
		expect(body.checks.d1).toBe(true);
		expect(body.checks.kv).toBe(true);
	});

	it('keeps the retired URL-secret init endpoint inert', async () => {
		const response = await SELF.fetch('http://example.com/api/init/should-never-be-consumed');
		expect(response.status).toBe(410);
		expect(await response.text()).toContain('X-Init-Secret');
	});

	it('hashes new passwords at the industrial policy cost while accepting old hashes for rehash', async () => {
		expect(cryptoUtils.iterationsFromEnv({})).toBe(150_000);
		expect(cryptoUtils.iterationsFromEnv({ password_pbkdf2_iterations: '1' })).toBe(100_000);
		const salt = cryptoUtils.generateSalt();
		const legacy = await cryptoUtils.genHashPassword('correct horse battery staple', salt, 100_000);
		expect(await cryptoUtils.verifyPassword('correct horse battery staple', salt, legacy)).toBe(true);
		expect(cryptoUtils.needsRehash(legacy, 150_000)).toBe(true);
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

});
