import BizError from '../error/biz-error';
import reqUtils from '../utils/req-utils';
import { parseBooleanEnv, toInteger } from '../utils/input-utils';

async function checkD1(c, scope, ip, limit, windowSeconds, windowId) {
	if (!c.env?.db || typeof c.env.db.prepare !== 'function') return false;
	const bucket = `${scope}:${ip}:${windowId}`;
	try {
		const row = await c.env.db.prepare(`
			INSERT INTO rate_limit_bucket (bucket_key, count, expires_at)
			VALUES (?, 1, ?)
			ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1
			RETURNING count
		`).bind(bucket, (windowId + 1) * windowSeconds + 60).first();
		if (Number(row?.count || 0) > limit) throw new BizError('请求过于频繁，请稍后再试', 429);
		return true;
	} catch (error) {
		if (error instanceof BizError) throw error;
		// Upgrade compatibility: before POST /init creates the table, keep the legacy KV limiter alive.
		if (String(error?.message || '').toLowerCase().includes('no such table')) return false;
		throw error;
	}
}

async function checkKv(c, scope, ip, limit, windowSeconds, windowId) {
	if (!c.env?.kv) return;
	const key = `rate:${scope}:${ip}:${windowId}`;
	const current = Number(await c.env.kv.get(key) || 0);
	if (current >= limit) throw new BizError('请求过于频繁，请稍后再试', 429);
	await c.env.kv.put(key, String(current + 1), { expirationTtl: windowSeconds + 60 });
}

const rateLimitService = {
	async cleanup(c) {
		if (!c.env?.db || typeof c.env.db.prepare !== 'function') return;
		try {
			await c.env.db.prepare(`DELETE FROM rate_limit_bucket WHERE expires_at < ?`).bind(Math.floor(Date.now() / 1000)).run();
		} catch (error) {
			if (!String(error?.message || '').toLowerCase().includes('no such table')) throw error;
		}
	},

	async check(c, scope, options = {}) {
		if (parseBooleanEnv(c.env.rate_limit_disabled, false)) return;
		const limit = toInteger(options.limit, { defaultValue: 20, min: 1, max: 10000 });
		const windowSeconds = toInteger(options.windowSeconds, { defaultValue: 900, min: 60, max: 86400 });
		const ip = reqUtils.getIp(c);
		const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
		if (await checkD1(c, scope, ip, limit, windowSeconds, windowId)) return;
		await checkKv(c, scope, ip, limit, windowSeconds, windowId);
	}
};

export default rateLimitService;
