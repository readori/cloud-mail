import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const BASE = 'http://example.com/api';

async function post(path, body, headers = {}) {
	return SELF.fetch(`${BASE}${path}`, { method: 'POST', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body ?? {}) });
}
async function get(path, headers = {}) {
	return SELF.fetch(`${BASE}${path}`, { headers });
}
async function del(path, headers = {}) {
	return SELF.fetch(`${BASE}${path}`, { method: 'DELETE', headers });
}
const bearer = token => ({ Authorization: `Bearer ${token}` });

async function loginToken(email, password) {
	const res = await post('/login', { email, password });
	const body = await res.json();
	return body?.data?.token;
}

describe('super-admin impersonation', () => {
	let adminToken;

	beforeAll(async () => {
		await SELF.fetch(`${BASE}/init`, { method: 'POST', headers: { 'X-Init-Secret': env.init_secret } });
		await post('/register', { email: 'admin@example.com', password: 'admin-password-123' });
		adminToken = await loginToken('admin@example.com', 'admin-password-123');
		const roles = await (await get('/role/selectUse', bearer(adminToken))).json();
		const type = roles.data[0].roleId;
		await post('/user/add', { email: 'victim@example.com', password: 'victim-password-123', type }, bearer(adminToken));
		await post('/user/add', { email: 'other@example.com', password: 'other-password-123', type }, bearer(adminToken));
	});

	async function victimId() {
		const list = await (await get('/user/list?num=1&size=50', bearer(adminToken))).json();
		return list.data.list.find(u => u.email === 'victim@example.com').userId;
	}

	it('lets the super-admin impersonate another account and act as them', async () => {
		const id = await victimId();
		const start = await post('/impersonate/start', { userId: id }, bearer(adminToken));
		const startBody = await start.json();
		expect(startBody.code).toBe(200);
		const impToken = startBody.data.token;
		expect(impToken).toBeTruthy();
		expect(impToken).not.toBe(adminToken);

		// The impersonation session is the target account.
		const me = await (await get('/my/loginUserInfo', bearer(impToken))).json();
		expect(me.data.email).toBe('victim@example.com');

		// status reflects impersonation and names the originating admin.
		const status = await (await get('/impersonate/status', bearer(impToken))).json();
		expect(status.data).toMatchObject({ impersonating: true, adminEmail: 'admin@example.com' });
		expect(status.data.target.email).toBe('victim@example.com');
	});

	it('forbids credential/account-destruction and nested impersonation while impersonating', async () => {
		const id = await victimId();
		const impToken = (await (await post('/impersonate/start', { userId: id }, bearer(adminToken))).json()).data.token;

		expect((await (await SELF.fetch(`${BASE}/my/resetPassword`, {
			method: 'PUT', headers: { ...JSON_HEADERS, ...bearer(impToken) },
			body: JSON.stringify({ password: 'hijacked-password-123' })
		})).json()).code).toBe(403);

		expect((await del('/my/delete', bearer(impToken))).status).toBe(403);
		expect((await post('/impersonate/start', { userId: id }, bearer(impToken))).status).toBe(403);
	});

	it('returns to the super-admin on stop and ends the session', async () => {
		const id = await victimId();
		const impToken = (await (await post('/impersonate/start', { userId: id }, bearer(adminToken))).json()).data.token;

		const stop = await post('/impersonate/stop', {}, bearer(impToken));
		const stopBody = await stop.json();
		expect(stopBody.code).toBe(200);
		expect(stopBody.data.admin.email).toBe('admin@example.com');
		const backToAdmin = stopBody.data.token;

		// The returned token is the admin again.
		const who = await (await get('/my/loginUserInfo', bearer(backToAdmin))).json();
		expect(who.data.email).toBe('admin@example.com');

		// The impersonation token no longer works.
		expect((await get('/my/loginUserInfo', bearer(impToken))).status).toBe(401);
	});

	it('refuses impersonating the admin themselves and non-admins calling it', async () => {
		const adminList = await (await get('/user/list?num=1&size=50', bearer(adminToken))).json();
		const adminId = adminList.data.list.find(u => u.email === 'admin@example.com').userId;
		expect((await post('/impersonate/start', { userId: adminId }, bearer(adminToken))).status).toBe(400);

		const victimToken = await loginToken('victim@example.com', 'victim-password-123');
		const otherId = adminList.data.list.find(u => u.email === 'other@example.com').userId;
		// A normal user cannot impersonate anyone, nor read the audit log.
		expect((await post('/impersonate/start', { userId: otherId }, bearer(victimToken))).status).toBe(403);
		expect((await get('/impersonate/logs', bearer(victimToken))).status).toBe(403);
	});

	it('records one audit row per impersonation, visible only to the super-admin', async () => {
		const id = await victimId();
		const impToken = (await (await post('/impersonate/start', { userId: id }, bearer(adminToken))).json()).data.token;
		await post('/impersonate/stop', {}, bearer(impToken));

		const logs = await (await get('/impersonate/logs?num=1&size=50', bearer(adminToken))).json();
		expect(logs.code).toBe(200);
		const row = logs.data.list.find(r => r.targetEmail === 'victim@example.com' && r.endTime);
		expect(row).toBeTruthy();
		expect(row.adminEmail).toBe('admin@example.com');
		expect(row.startTime).toBeTruthy();
	});

	it('grants the target\'s own admin permissions during impersonation, but keeps the safety gates', async () => {
		const list = await (await get('/user/list?num=1&size=50', bearer(adminToken))).json();
		const victim = list.data.list.find(u => u.email === 'victim@example.com');
		// Make the victim an admin-capable account: grant its role user:query + all-email:query.
		for (const key of ['user:query', 'all-email:query']) {
			const row = await env.db.prepare('SELECT perm_id AS id FROM perm WHERE perm_key = ?').bind(key).first();
			if (row?.id) await env.db.prepare('INSERT INTO role_perm (role_id, perm_id) VALUES (?, ?)').bind(victim.type, row.id).run().catch(() => {});
		}
		const impToken = (await (await post('/impersonate/start', { userId: victim.userId }, bearer(adminToken))).json()).data.token;

		// Full impersonation: the target's own admin pages work (this is the bug we are fixing — they used to 403).
		expect((await get('/user/list?num=1&size=10', bearer(impToken))).status).toBe(200);
		expect((await get('/allEmail/list?num=1&size=10', bearer(impToken))).status).not.toBe(403); // perm granted; 200 in prod (test D1 lacks a column)

		// Safety gates still hold regardless of the target's perms:
		// changing this account's own login password / self-delete, nested impersonation, push registration.
		expect((await (await SELF.fetch(`${BASE}/my/resetPassword`, {
			method: 'PUT', headers: { ...JSON_HEADERS, ...bearer(impToken) },
			body: JSON.stringify({ password: 'hijacked-password-123' })
		})).status)).toBe(403);
		expect((await del('/my/delete', bearer(impToken))).status).toBe(403);
		expect((await post('/impersonate/start', { userId: victim.userId }, bearer(impToken))).status).toBe(403);
		expect((await post('/device/register', { token: 'x', platform: 'ios' }, bearer(impToken))).status).toBe(403);

		// The super-admin (env.admin) is always protected, even while impersonating an admin-capable account.
		const adminUser = list.data.list.find(u => u.email === 'admin@example.com');
		expect((await (await SELF.fetch(`${BASE}/user/setPwd`, {
			method: 'PUT', headers: { ...JSON_HEADERS, ...bearer(impToken) },
			body: JSON.stringify({ userId: adminUser.userId, password: 'take-over-admin-123' })
		})).status)).not.toBe(200);
		// Confirm the admin password is unchanged.
		expect((await post('/login', { email: 'admin@example.com', password: 'admin-password-123' })).status).toBe(200);
		await post('/impersonate/stop', {}, bearer(impToken));
	});

	it('lets the impersonator use the mailbox (read + star) but nothing admin', async () => {
		const id = await victimId();
		const impToken = (await (await post('/impersonate/start', { userId: id }, bearer(adminToken))).json()).data.token;
		// Mailbox routes are reachable (allowlisted): they must not be forbidden (403) by impersonation.
		expect((await get('/email/list?accountId=0&num=1&size=10', bearer(impToken))).status).not.toBe(403);
		expect((await get('/star/list?num=1&size=10', bearer(impToken))).status).not.toBe(403);
		expect((await get('/my/loginUserInfo', bearer(impToken))).status).toBe(200);
		// Managing the target's own sub-mailboxes (add/delete) is allowed, not forbidden by impersonation.
		expect((await get('/account/list?num=1&size=10', bearer(impToken))).status).not.toBe(403);
		expect((await post('/account/add', { email: 'sub@example.com' }, bearer(impToken))).status).not.toBe(403);
		expect((await del('/account/delete?accountId=999999', bearer(impToken))).status).not.toBe(403);
		await post('/impersonate/stop', {}, bearer(impToken));
	});

	it('invalidates the impersonation session once the target is banned', async () => {
		const id = await victimId();
		const impToken = (await (await post('/impersonate/start', { userId: id }, bearer(adminToken))).json()).data.token;
		expect((await get('/my/loginUserInfo', bearer(impToken))).status).toBe(200);
		await SELF.fetch(`${BASE}/user/setStatus`, { method: 'PUT', headers: { ...JSON_HEADERS, ...bearer(adminToken) }, body: JSON.stringify({ userId: id, status: 1 }) });
		expect((await get('/my/loginUserInfo', bearer(impToken))).status).toBe(401);
		// restore for other tests
		await SELF.fetch(`${BASE}/user/restore`, { method: 'PUT', headers: { ...JSON_HEADERS, ...bearer(adminToken) }, body: JSON.stringify({ userId: id }) }).catch(() => {});
		await env.db.prepare('UPDATE user SET status = 0 WHERE user_id = ?').bind(id).run().catch(() => {});
	});

	it('leaves no extra login_log entry for the target when impersonating', async () => {
		const id = await victimId();
		const before = await env.db.prepare('SELECT COUNT(*) AS n FROM login_log WHERE user_id = ?').bind(id).first();
		const impToken = (await (await post('/impersonate/start', { userId: id }, bearer(adminToken))).json()).data.token;
		await get('/my/loginUserInfo', bearer(impToken));
		await post('/impersonate/stop', {}, bearer(impToken));
		const after = await env.db.prepare('SELECT COUNT(*) AS n FROM login_log WHERE user_id = ?').bind(id).first();
		expect(after.n).toBe(before.n);
	});
});
