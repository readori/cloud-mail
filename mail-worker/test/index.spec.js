import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import cryptoUtils from '../src/utils/crypto-utils';
import rateLimitService from '../src/service/rate-limit-service';
import settingService from '../src/service/setting-service';
import jwtUtils from '../src/utils/jwt-utils';

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

	it('records the IP of every login and shows it to the admin (GET /user/loginLog)', async () => {
		await SELF.fetch('http://example.com/api/init', { method: 'POST', headers: { 'X-Init-Secret': env.init_secret } });
		// 旧部署未重新 /init 时也能自动建表
		await env.db.prepare('DROP TABLE IF EXISTS login_log').run();
		const json = { 'Content-Type': 'application/json' };
		await SELF.fetch('http://example.com/api/register', {
			method: 'POST', headers: json,
			body: JSON.stringify({ email: 'admin@example.com', password: 'admin-password-123' })
		});
		const loginFrom = async (ip) => (await (await SELF.fetch('http://example.com/api/login', {
			method: 'POST', headers: { ...json, 'CF-Connecting-IP': ip, 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
			body: JSON.stringify({ email: 'admin@example.com', password: 'admin-password-123' })
		})).json()).data.token;
		await loginFrom('203.0.113.7');
		const token = await loginFrom('2001:db8::1');
		const { userId } = await jwtUtils.verifyToken({ env }, token);

		const response = await SELF.fetch(`http://example.com/api/user/loginLog?userId=${userId}`, { headers: { Authorization: `Bearer ${token}` } });
		const body = await response.json();
		expect(body.code).toBe(200);
		expect(body.data.total).toBe(2);
		expect(body.data.list.map(item => item.ip)).toEqual(['2001:db8::1', '203.0.113.7']);
		expect(body.data.list[0]).toMatchObject({ method: 'password' });
		expect(body.data.list[0].createTime).toBeTruthy();

		const anonymous = await SELF.fetch(`http://example.com/api/user/loginLog?userId=${userId}`);
		expect(anonymous.status).toBe(401);

		// 管理员可以查看所有用户的登录日志，并按邮箱/IP 筛选
		await SELF.fetch('http://example.com/api/register', {
			method: 'POST', headers: json,
			body: JSON.stringify({ email: 'member@example.com', password: 'member-password-123' })
		});
		const memberToken = (await (await SELF.fetch('http://example.com/api/login', {
			method: 'POST', headers: { ...json, 'CF-Connecting-IP': '198.51.100.9' },
			body: JSON.stringify({ email: 'member@example.com', password: 'member-password-123' })
		})).json()).data.token;
		const all = await (await SELF.fetch('http://example.com/api/loginLog/list', { headers: { Authorization: `Bearer ${token}` } })).json();
		expect(all.code).toBe(200);
		expect(all.data.list[0]).toMatchObject({ email: 'member@example.com', ip: '198.51.100.9' });
		expect(all.data.list.map(item => item.email)).toContain('admin@example.com');
		const byIp = await (await SELF.fetch('http://example.com/api/loginLog/list?ip=203.0', { headers: { Authorization: `Bearer ${token}` } })).json();
		expect(byIp.data.list.map(item => item.ip)).toEqual(['203.0.113.7']);

		// 关键词搜索：邮箱片段、IP 片段、设备/系统、登录方式；多个词需全部命中
		const search = async (keyword) => (await (await SELF.fetch(`http://example.com/api/loginLog/list?keyword=${encodeURIComponent(keyword)}`, { headers: { Authorization: `Bearer ${token}` } })).json()).data;
		expect((await search('member')).list.map(item => item.email)).toEqual(['member@example.com']);
		expect((await search('113.7')).list.map(item => item.ip)).toEqual(['203.0.113.7']);
		expect((await search('iPhone')).total).toBe(2);
		expect((await search('密码')).total).toBe(3);
		expect((await search('admin db8')).list.map(item => item.ip)).toEqual(['2001:db8::1']);
		expect((await search('100%')).total).toBe(0);

		// 普通用户看不到任何登录日志，包括自己的
		const urls = ['/api/loginLog/list', `/api/user/loginLog?userId=${userId}`];
		for (const url of urls) {
			const denied = await SELF.fetch(`http://example.com${url}`, { headers: { Authorization: `Bearer ${memberToken}` } });
			expect((await denied.json()).code).toBe(403);
		}

		// 「登录日志」是可分配的权限：出现在权限树中，分配给身份后该身份的用户即可查看
		const tree = await (await SELF.fetch('http://example.com/api/role/tree', { headers: { Authorization: `Bearer ${token}` } })).json();
		expect(JSON.stringify(tree.data)).toContain('login-log:query');
		const { perm_id: permId } = await env.db.prepare(`SELECT perm_id FROM perm WHERE perm_key = 'login-log:query'`).first();
		const { type: memberRole } = await env.db.prepare(`SELECT type FROM user WHERE email = 'member@example.com'`).first();
		await env.db.prepare('INSERT INTO role_perm (role_id, perm_id) VALUES (?, ?)').bind(memberRole, permId).run();
		for (const url of urls) {
			const allowed = await SELF.fetch(`http://example.com${url}`, { headers: { Authorization: `Bearer ${memberToken}` } });
			expect((await allowed.json()).code).toBe(200);
		}
	});

	it('renews a near-expiry JWT so active app sessions never hit the 30-day hard expiry', async () => {
		await SELF.fetch('http://example.com/api/init', { method: 'POST', headers: { 'X-Init-Secret': env.init_secret } });
		const json = { 'Content-Type': 'application/json' };
		await SELF.fetch('http://example.com/api/register', {
			method: 'POST', headers: json,
			body: JSON.stringify({ email: 'renew@example.com', password: 'renew-password-123' })
		});
		const login = await (await SELF.fetch('http://example.com/api/login', {
			method: 'POST', headers: json,
			body: JSON.stringify({ email: 'renew@example.com', password: 'renew-password-123' })
		})).json();
		const payload = await jwtUtils.verifyToken({ env }, login.data.token);

		// 一个还有效但 1 天后过期的 JWT(同一会话)
		const nearExpiry = await jwtUtils.generateToken({ env }, { userId: payload.userId, token: payload.token }, 24 * 60 * 60);
		const response = await SELF.fetch('http://example.com/api/my/loginUserInfo', { headers: { Authorization: nearExpiry } });
		expect((await response.json()).code).toBe(200);
		const renewed = response.headers.get('X-Refreshed-Token');
		expect(renewed).toBeTruthy();
		expect((await jwtUtils.verifyToken({ env }, renewed)).exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(29 * 24 * 60 * 60);

		const fresh = await SELF.fetch('http://example.com/api/my/loginUserInfo', { headers: { Authorization: renewed } });
		expect((await fresh.json()).code).toBe(200);
		expect(fresh.headers.get('X-Refreshed-Token')).toBeNull();
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
