import BizError from '../error/biz-error';
import orm from '../entity/orm';
import { oauth } from '../entity/oauth';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import userService from './user-service';
import accountService from './account-service';
import loginService from './login-service';
import settingService from './setting-service';
import cryptoUtils from '../utils/crypto-utils';
import jwtUtils from '../utils/jwt-utils';
import rateLimitService from './rate-limit-service';
import { t } from '../i18n/i18n';
import { normalizeEmail, parseBooleanEnv, toInteger, toTrimmedString } from '../utils/input-utils';

const OAUTH_STATE_TTL = 600;
const OAUTH_BIND_TTL = 600;
const FETCH_TIMEOUT = 15_000;

const PROVIDERS = {
	linuxdo: { name: 'Linux DO', switchKey: 'linuxdoSwitch', idKey: 'linuxdoClientId', secretKey: 'linuxdoClientSecret' },
	github: { name: 'GitHub', switchKey: 'githubSwitch', idKey: 'githubClientId', secretKey: 'githubClientSecret' },
	google: { name: 'Google', switchKey: 'googleSwitch', idKey: 'googleClientId', secretKey: 'googleClientSecret' }
};

function normalizeProvider(value) {
	const key = String(value || '').trim().toLowerCase();
	if (!PROVIDERS[key]) throw new BizError('不支持的 OAuth 登录方式', 400);
	return key;
}

async function providerConfig(c, provider) {
	const meta = PROVIDERS[provider];
	const setting = await settingService.query(c);
	// 开关语义与上游一致：0 = 开启，1 = 关闭
	if (Number(setting[meta.switchKey]) !== 0) throw new BizError(t('oauthDisabled'), 403);
	const clientId = String(setting[meta.idKey] || '').trim();
	const clientSecret = String(setting[meta.secretKey] || '').trim();
	if (!clientId || !clientSecret) throw new BizError(`${meta.name} OAuth 配置不完整`, 503);
	return { ...meta, clientId, clientSecret, legacyCallbackUrl: setting.linuxdoCallbackUrl || '' };
}

// redirect_uri 必须是本站登录页(或旧版环境变量里登记的 Linux DO 回调地址)，防止授权码被导向第三方
function resolveRedirectUri(c, provider, config, requested) {
	const raw = toTrimmedString(requested, { name: 'redirectUri', max: 2048 });
	if (!raw) {
		if (provider === 'linuxdo' && config.legacyCallbackUrl) return config.legacyCallbackUrl;
		throw new BizError('redirectUri不能为空', 400);
	}
	if (provider === 'linuxdo' && config.legacyCallbackUrl && raw === config.legacyCallbackUrl) return raw;
	let parsed;
	try { parsed = new URL(raw); } catch { throw new BizError('redirectUri格式错误', 400); }
	const allowedOrigins = new Set([new URL(c.req.url).origin]);
	for (const item of String(c.env?.cors_origins || '').split(',')) {
		const origin = item.trim();
		if (origin && origin !== '*') allowedOrigins.add(origin);
	}
	if (!['https:', 'http:'].includes(parsed.protocol) || !allowedOrigins.has(parsed.origin) || parsed.pathname !== '/login' || parsed.search || parsed.hash) {
		throw new BizError('redirectUri不在允许范围内', 400);
	}
	return `${parsed.origin}/login`;
}

function cleanAvatar(value) {
	const avatar = toTrimmedString(value, { name: '头像', max: 2048 });
	if (!avatar) return '';
	try {
		const url = new URL(avatar);
		return ['https:', 'http:'].includes(url.protocol) ? avatar : '';
	} catch {
		return '';
	}
}

function cleanProviderUser(provider, source) {
	const id = provider === 'google' ? source?.sub : source?.id;
	const base = {
		oauthUserId: toTrimmedString(String(id ?? ''), { name: 'OAuth用户ID', required: true, max: 128 }),
		name: toTrimmedString(source?.name, { name: '名称', max: 256 }),
		platform: provider,
		active: 0,
		silenced: 1,
		trustLevel: 0
	};
	if (provider === 'linuxdo') {
		return {
			...base,
			username: toTrimmedString(source?.username, { name: '用户名', max: 128 }),
			avatar: cleanAvatar(source?.avatar_url),
			active: source?.active ? 0 : 1,
			silenced: source?.silenced ? 0 : 1,
			trustLevel: toInteger(source?.trust_level, { defaultValue: 0, min: 0, max: 100 })
		};
	}
	if (provider === 'github') {
		return { ...base, username: toTrimmedString(source?.login, { name: '用户名', max: 128 }), avatar: cleanAvatar(source?.avatar_url) };
	}
	return { ...base, username: toTrimmedString(source?.email, { name: '用户名', max: 254 }), avatar: cleanAvatar(source?.picture) };
}

async function fetchJson(url, init, errorMessage) {
	const response = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
	if (!response.ok) throw new BizError(errorMessage, 502);
	try {
		return await response.json();
	} catch {
		throw new BizError(errorMessage, 502);
	}
}

async function fetchProviderUser(provider, config, code, redirectUri) {
	if (provider === 'linuxdo') {
		const token = await fetchJson('https://connect.linux.do/oauth2/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: config.clientId,
				client_secret: config.clientSecret,
				code,
				redirect_uri: redirectUri,
				grant_type: 'authorization_code'
			}).toString()
		}, 'Linux DO OAuth 授权失败');
		if (typeof token?.access_token !== 'string') throw new BizError('Linux DO OAuth 返回无效', 502);
		return fetchJson('https://connect.linux.do/api/user', {
			headers: { Authorization: `Bearer ${token.access_token}` }
		}, 'Linux DO 用户信息获取失败');
	}

	if (provider === 'github') {
		const token = await fetchJson('https://github.com/login/oauth/access_token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({
				client_id: config.clientId,
				client_secret: config.clientSecret,
				code,
				redirect_uri: redirectUri
			})
		}, 'GitHub OAuth 授权失败');
		if (token?.error) throw new BizError(String(token.error_description || token.error).slice(0, 200), 401);
		if (typeof token?.access_token !== 'string') throw new BizError('GitHub OAuth 返回无效', 502);
		return fetchJson('https://api.github.com/user', {
			headers: { Authorization: `Bearer ${token.access_token}`, 'User-Agent': 'cloud-mail', Accept: 'application/vnd.github+json' }
		}, 'GitHub 用户信息获取失败');
	}

	const token = await fetchJson('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code,
			redirect_uri: redirectUri,
			grant_type: 'authorization_code'
		}).toString()
	}, 'Google OAuth 授权失败');
	if (typeof token?.access_token !== 'string') throw new BizError('Google OAuth 返回无效', 502);
	return fetchJson('https://openidconnect.googleapis.com/v1/userinfo', {
		headers: { Authorization: `Bearer ${token.access_token}` }
	}, 'Google 用户信息获取失败');
}

const oauthService = {
	async createState(c, provider = 'linuxdo') {
		provider = normalizeProvider(provider);
		await providerConfig(c, provider);
		await rateLimitService.check(c, 'oauth-state', { limit: 30, windowSeconds: 900 });
		const state = crypto.randomUUID();
		await c.env.kv.put(`oauth:state:${state}`, provider, { expirationTtl: OAUTH_STATE_TTL });
		return { state, provider, expiresIn: OAUTH_STATE_TTL };
	},

	async verifyState(c, state, provider) {
		if (!parseBooleanEnv(c.env.oauth_state_required, true)) return;
		const normalized = toTrimmedString(state, { name: 'OAuth state', required: true, max: 128 });
		const key = `oauth:state:${normalized}`;
		const stored = await c.env.kv.get(key);
		// 旧版本签发的 state 值为 '1'，只对应 Linux DO
		const storedProvider = stored === '1' ? 'linuxdo' : stored;
		if (!storedProvider || storedProvider !== provider) throw new BizError('OAuth state 无效或已过期', 401);
		await c.env.kv.delete(key);
	},

	async bindUser(c, params = {}) {
		await rateLimitService.check(c, 'oauth-bind', { limit: 10, windowSeconds: 3600 });
		const bindToken = toTrimmedString(params.bindToken, { name: '绑定凭证', required: true, max: 8192 });
		const payload = await jwtUtils.verifyToken(c, bindToken, { purpose: 'oauth-bind' });
		if (!payload || typeof payload.oauthUserId !== 'string' || typeof payload.nonce !== 'string') {
			throw new BizError('绑定凭证无效或已过期', 401);
		}
		await providerConfig(c, PROVIDERS[payload.provider] ? payload.provider : 'linuxdo');

		const nonceKey = `oauth:bind:${payload.nonce}`;
		const nonceValue = await c.env.kv.get(nonceKey);
		if (nonceValue !== payload.oauthUserId) throw new BizError('绑定凭证已使用或已过期', 401);
		await c.env.kv.delete(nonceKey);

		const email = normalizeEmail(params.email);
		const code = toTrimmedString(params.code, { name: '注册码', max: 128 });
		const oauthRow = await this.getById(c, payload.oauthUserId);
		if (!oauthRow) throw new BizError('OAuth 用户不存在或已过期', 404);
		if (Number(oauthRow.userId) > 0) throw new BizError('用户已绑定邮箱', 409);

		let createdUserId = 0;
		try {
			await loginService.register(c, { email, password: cryptoUtils.genRandomPwd(20), code }, true);
			const userRow = await userService.selectByEmail(c, email);
			if (!userRow) throw new BizError('邮箱账户创建失败', 500);
			createdUserId = userRow.userId;
			const updated = await orm(c).update(oauth)
				.set({ userId: userRow.userId })
				.where(and(eq(oauth.oauthUserId, payload.oauthUserId), eq(oauth.userId, 0)))
				.returning()
				.get();
			if (!updated) throw new BizError('该 OAuth 用户已被绑定', 409);
			const token = await loginService.login(c, { email }, true);
			return { userInfo: updated, token };
		} catch (error) {
			if (createdUserId) {
				try {
					await accountService.physicsDeleteByUserIds(c, [createdUserId]);
					await userService.rollbackCreate(c, createdUserId);
				} catch (cleanupError) { console.error('OAuth 注册回滚失败', cleanupError); }
			}
			await c.env.kv.put(nonceKey, payload.oauthUserId, { expirationTtl: 120 }).catch(() => {});
			throw error;
		}
	},

	async oauthLogin(c, provider, params = {}) {
		provider = normalizeProvider(provider);
		const config = await providerConfig(c, provider);
		await rateLimitService.check(c, 'oauth-callback', { limit: 20, windowSeconds: 900 });
		const code = toTrimmedString(params.code, { name: 'OAuth code', required: true, max: 2048 });
		const redirectUri = resolveRedirectUri(c, provider, config, params.redirectUri);
		await this.verifyState(c, params.state, provider);

		const providerUser = cleanProviderUser(provider, await fetchProviderUser(provider, config, code, redirectUri));
		if (provider === 'linuxdo') {
			if (providerUser.active !== 0 || providerUser.silenced === 0) throw new BizError('Linux DO 账户当前不可用于登录', 403);
			const minTrustLevel = toInteger(c.env.linuxdo_min_trust_level, { defaultValue: 0, min: 0, max: 100 });
			if (providerUser.trustLevel < minTrustLevel) throw new BizError('Linux DO 信任等级不足', 403);
		}
		// 不同平台的用户 ID 可能重复，非 Linux DO 平台加前缀隔离(Linux DO 保持原值兼容已有绑定)
		if (provider !== 'linuxdo') providerUser.oauthUserId = `${provider}:${providerUser.oauthUserId}`;

		const oauthRow = await this.saveUser(c, providerUser);
		const userRow = Number(oauthRow.userId) > 0
			? await userService.selectByIdIncludeDel(c, oauthRow.userId)
			: null;

		if (!userRow) {
			const nonce = crypto.randomUUID();
			await c.env.kv.put(`oauth:bind:${nonce}`, oauthRow.oauthUserId, { expirationTtl: OAUTH_BIND_TTL });
			const bindToken = await jwtUtils.generateToken(c, {
				purpose: 'oauth-bind',
				oauthUserId: oauthRow.oauthUserId,
				provider,
				nonce
			}, OAUTH_BIND_TTL);
			return { userInfo: oauthRow, token: null, bindToken, bindExpiresIn: OAUTH_BIND_TTL };
		}

		const token = await loginService.login(c, { email: userRow.email }, true);
		return { userInfo: oauthRow, token, bindToken: null };
	},

	linuxDoLogin(c, params) {
		return this.oauthLogin(c, 'linuxdo', params);
	},

	githubLogin(c, params) {
		return this.oauthLogin(c, 'github', params);
	},

	googleLogin(c, params) {
		return this.oauthLogin(c, 'google', params);
	},

	async saveUser(c, userInfo) {
		const existing = await this.getById(c, userInfo.oauthUserId);
		if (!existing) return orm(c).insert(oauth).values(userInfo).returning().get();
		return orm(c).update(oauth)
			.set({
				username: userInfo.username,
				name: userInfo.name,
				avatar: userInfo.avatar,
				active: userInfo.active,
				trustLevel: userInfo.trustLevel,
				silenced: userInfo.silenced,
				platform: userInfo.platform
			})
			.where(eq(oauth.oauthUserId, userInfo.oauthUserId))
			.returning()
			.get();
	},

	getById(c, oauthUserId) {
		return orm(c).select().from(oauth).where(eq(oauth.oauthUserId, oauthUserId)).get();
	},

	async deleteByUserId(c, userId) {
		await this.deleteByUserIds(c, [userId]);
	},

	async deleteByUserIds(c, userIds) {
		if (!Array.isArray(userIds) || userIds.length === 0) return;
		await orm(c).delete(oauth).where(inArray(oauth.userId, userIds)).run();
	},

	async clearNoBindOathUser(c) {
		// cron 改为每小时执行：只清理超过 1 天仍未绑定的记录，避免删掉正在绑定中的 OAuth 用户
		await orm(c).delete(oauth).where(and(
			eq(oauth.userId, 0),
			lt(oauth.createTime, sql`datetime('now', '-1 day')`)
		)).run();
	}
};

export default oauthService;
