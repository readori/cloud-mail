import app from '../hono/hono';
import { dbInit } from '../init/init';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

function healthChecks(c) {
	return {
		d1: Boolean(c.env?.db && typeof c.env.db.prepare === 'function'),
		kv: Boolean(c.env?.kv && typeof c.env.kv.get === 'function' && typeof c.env.kv.put === 'function'),
		jwtSecret: typeof c.env?.jwt_secret === 'string' && c.env.jwt_secret.length >= 32,
		initSecret: typeof c.env?.init_secret === 'string' && c.env.init_secret.length >= 32,
		configEncryptionKey: typeof c.env?.config_encryption_key === 'string' && c.env.config_encryption_key.length >= 32
	};
}

// Public readiness is intentionally coarse. It is safe for load balancers and deployment
// gates without disclosing which security binding/secret is missing to unauthenticated callers.
app.get('/health', (c) => {
	const checks = healthChecks(c);
	return c.json({ status: 'ok', service: 'cloud-mail', ready: Object.values(checks).every(Boolean) });
});

// Detailed diagnostics require an authenticated administrator. This keeps operational
// troubleshooting available without exposing configuration state publicly.
app.get('/health/detail', (c) => {
	const user = c.get('user');
	if (!user?.email || !c.env?.admin || user.email.toLowerCase() !== String(c.env.admin).toLowerCase()) {
		throw new BizError(t('unauthorized'), 403);
	}
	const checks = healthChecks(c);
	return c.json({ status: 'ok', service: 'cloud-mail', ready: Object.values(checks).every(Boolean), checks });
});

app.post('/init', async (c) => {
	return dbInit.init(c, c.req.header('X-Init-Secret'));
});

// Security tombstone for pre-hardening clients/bookmarks. Never read or compare the path
// segment: secrets in URLs can be captured by browser history, proxies, analytics or logs.
app.get('/init/:secret', (c) => {
	return c.text('Legacy initialization URL retired. Use POST /api/init with X-Init-Secret.', 410);
});
