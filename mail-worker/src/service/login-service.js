import BizError from '../error/biz-error';
import userService from './user-service';
import emailUtils from '../utils/email-utils';
import { isDel, settingConst, userConst } from '../const/entity-const';
import JwtUtils from '../utils/jwt-utils';
import { v4 as uuidv4 } from 'uuid';
import KvConst from '../const/kv-const';
import constant from '../const/constant';
import userContext from '../security/user-context';
import accountService from './account-service';
import cryptoUtils from '../utils/crypto-utils';
import turnstileService from './turnstile-service';
import roleService from './role-service';
import regKeyService from './reg-key-service';
import dayjs from 'dayjs';
import { toUtc } from '../utils/date-uitil';
import { t } from '../i18n/i18n.js';
import verifyRecordService from './verify-record-service';
import settingService from './setting-service';
import rateLimitService from './rate-limit-service';
import { normalizeEmail, parseBooleanEnv, toTrimmedString } from '../utils/input-utils';

function validatePassword(password, { allowLegacy = false } = {}) {
	if (typeof password !== 'string' || password.length === 0) throw new BizError(t('emailAndPwdEmpty'), 400);
	// Existing CloudMail users may still have a 6–9 character password created by 3.0.0.
	// They must remain able to log in; the stronger minimum applies only to new/reset passwords.
	if (!allowLegacy && password.length < 10) throw new BizError(t('pwdMinLength'), 400);
	if (password.length > 128) throw new BizError(t('pwdLengthLimit'), 400);
	return password;
}


function assertLoginRuntime(c) {
	if (!c?.env?.db || typeof c.env.db.prepare !== 'function') {
		throw new BizError('D1 数据库未绑定，请检查 Worker 的 db binding', 503);
	}
	if (!c?.env?.kv || typeof c.env.kv.get !== 'function' || typeof c.env.kv.put !== 'function') {
		throw new BizError('KV 数据库未绑定，请检查 Worker 的 kv binding', 503);
	}
	if (typeof c.env.jwt_secret !== 'string' || c.env.jwt_secret.length < 32) {
		throw new BizError('JWT_SECRET 未配置或长度不足，请在 Cloudflare Worker Secrets 中设置 jwt_secret（至少32个字符）', 503);
	}
}

function isAllowedDomain(setting, email) {
	const domain = emailUtils.getDomain(email).toLowerCase();
	return Array.isArray(setting.domainList)
		&& setting.domainList.some(item => String(item).replace(/^@/, '').toLowerCase() === domain);
}

const refreshEncoder = new TextEncoder();

async function sha256Hex(value) {
	const digest = await crypto.subtle.digest('SHA-256', refreshEncoder.encode(String(value)));
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sessionUserFromRow(userRow) {
	return {
		userId: userRow.userId,
		email: userRow.email,
		type: userRow.type,
		status: userRow.status,
		isDel: userRow.isDel
	};
}

async function issueAccessSession(c, userRow, { revokeSessionToken = null } = {}) {
	const sessionToken = uuidv4();
	const jwt = await JwtUtils.generateToken(
		c,
		{ userId: userRow.userId, token: sessionToken },
		constant.TOKEN_EXPIRE
	);
	const sessionUser = sessionUserFromRow(userRow);
	let authInfo = await c.env.kv.get(KvConst.AUTH_INFO + userRow.userId, { type: 'json' });
	if (authInfo?.user?.email?.toLowerCase() === userRow.email.toLowerCase() && Array.isArray(authInfo.tokens)) {
		authInfo.tokens = authInfo.tokens.filter(item => typeof item === 'string' && item !== revokeSessionToken).slice(-9);
		authInfo.tokens.push(sessionToken);
		authInfo.user = sessionUser;
		authInfo.refreshTime = dayjs().toISOString();
	} else {
		authInfo = { tokens: [sessionToken], user: sessionUser, refreshTime: dayjs().toISOString() };
	}

	await userService.updateUserInfo(c, userRow.userId);
	await c.env.kv.put(
		KvConst.AUTH_INFO + userRow.userId,
		JSON.stringify(authInfo),
		{ expirationTtl: constant.TOKEN_EXPIRE }
	);
	return { token: jwt, sessionToken };
}

function randomRefreshToken() {
	// Two independent UUIDv4 values provide ample entropy while keeping the token URL/JSON safe.
	return `rt_${uuidv4().replaceAll('-', '')}${uuidv4().replaceAll('-', '')}`;
}

async function issueRefreshCredential(c, userId, sessionToken) {
	const refreshToken = randomRefreshToken();
	const refreshHash = await sha256Hex(refreshToken);
	const now = Math.floor(Date.now() / 1000);
	const expiresAt = now + constant.REFRESH_TOKEN_EXPIRE;
	await c.env.db.prepare('DELETE FROM refresh_session WHERE user_id = ? AND expires_at <= ?')
		.bind(userId, now).run();
	await c.env.db.prepare(`
		INSERT INTO refresh_session(refresh_hash, user_id, session_token, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?)
	`).bind(refreshHash, userId, sessionToken, expiresAt, now).run();
	return { refreshToken, refreshExpiresIn: constant.REFRESH_TOKEN_EXPIRE };
}

async function tryIssueRefreshCredential(c, userId, sessionToken) {
	try {
		return await issueRefreshCredential(c, userId, sessionToken);
	} catch (error) {
		// Older self-hosted servers may not have applied 0004 yet. Preserve login compatibility;
		// the native client will simply require a normal login when the access JWT expires.
		console.warn(`[${c.get('requestId') || 'login'}] refresh-session unavailable; access session remains valid`, error?.message || error);
		return null;
	}
}

async function revokeRefreshForSession(c, userId, sessionToken) {
	try {
		await c.env.db.prepare('DELETE FROM refresh_session WHERE user_id = ? AND session_token = ?')
			.bind(userId, sessionToken).run();
	} catch {
		// Backward-compatible with servers that have not applied the refresh-session migration yet.
	}
}

const loginService = {
	async register(c, params = {}, oauth = false) {
		await rateLimitService.check(c, oauth ? 'oauth-register' : 'register', {
			limit: Number(c.env.register_rate_limit) || 10,
			windowSeconds: 3600
		});

		const email = normalizeEmail(params.email);
		const password = validatePassword(params.password);
		const token = toTrimmedString(params.token, { name: '验证码', max: 4096 });
		const code = toTrimmedString(params.code, { name: '注册码', max: 128 });
		const setting = await settingService.query(c);
		let { regKey, register, registerVerify, regVerifyCount, minEmailPrefix, emailPrefixFilter } = setting;

		if (oauth) {
			registerVerify = settingConst.registerVerify.CLOSE;
			register = settingConst.register.OPEN;
		}
		if (register === settingConst.register.CLOSE) throw new BizError(t('regDisabled'), 403);

		const prefix = emailUtils.getName(email);
		const minPrefix = Math.max(1, Number(minEmailPrefix) || 1);
		if (prefix.length < minPrefix) throw new BizError(t('minEmailPrefix', { msg: minPrefix }));
		if (prefix.length > 64) throw new BizError(t('emailLengthLimit'));
		const blockedPrefixes = Array.isArray(emailPrefixFilter) ? emailPrefixFilter : [];
		if (blockedPrefixes.some(content => content && prefix.includes(String(content).toLowerCase()))) {
			throw new BizError(t('banEmailPrefix'));
		}
		if (!isAllowedDomain(setting, email)) {
			throw new BizError(t('notEmailDomain'));
		}

		let invitedRoleId = null;
		let regKeyId = 0;
		if (regKey === settingConst.regKey.OPEN) {
			const selected = await this.handleOpenRegKey(c, code);
			invitedRoleId = selected.roleId;
			regKeyId = selected.regKeyId;
		} else if (regKey === settingConst.regKey.OPTIONAL && code) {
			const selected = await this.handleOptionalRegKey(c, code);
			invitedRoleId = selected?.roleId || null;
			regKeyId = selected?.regKeyId || 0;
		}

		const accountRow = await accountService.selectByEmailIncludeDel(c, email);
		if (accountRow?.isDel === isDel.DELETE) throw new BizError(t('isDelUser'));
		if (accountRow) throw new BizError(t('isRegAccount'), 409);

		const defaultRole = invitedRoleId ? null : await roleService.selectDefaultRole(c);
		const roleId = invitedRoleId || defaultRole?.roleId;
		if (!roleId) throw new BizError(t('roleNotExist'));
		const roleRow = await roleService.selectById(c, roleId);
		if (!roleRow) throw new BizError(t('roleNotExist'));
		if (!roleService.hasAvailDomainPerm(roleRow.availDomain, email)) {
			throw new BizError(invitedRoleId ? t('noDomainPermRegKey') : t('noDomainPermReg'), 403);
		}

		let regVerifyOpen = false;
		if (registerVerify === settingConst.registerVerify.OPEN) {
			regVerifyOpen = true;
			await turnstileService.verify(c, token);
		} else if (registerVerify === settingConst.registerVerify.COUNT) {
			regVerifyOpen = await verifyRecordService.isOpenRegVerify(c, Number(regVerifyCount) || 0);
			if (regVerifyOpen) await turnstileService.verify(c, token);
		}

		let consumedKey = false;
		let userId = null;
		try {
			if (regKeyId) {
				await regKeyService.consume(c, regKeyId);
				consumedKey = true;
			}

			const { salt, hash } = await cryptoUtils.hashPassword(password, cryptoUtils.iterationsFromEnv(c.env));
			userId = await userService.insert(c, { email, regKeyId, password: hash, salt, type: roleId });
			try {
				await accountService.insert(c, { userId, email, name: prefix });
			} catch (error) {
				await userService.rollbackCreate(c, userId);
				userId = null;
				throw error;
			}
			await userService.updateUserInfo(c, userId, true);
		} catch (error) {
			if (consumedKey) await regKeyService.restoreCount(c, regKeyId).catch(() => {});
			throw error;
		}

		if (registerVerify === settingConst.registerVerify.COUNT && !regVerifyOpen) {
			const row = await verifyRecordService.increaseRegCount(c);
			return { regVerifyOpen: row.count >= Number(regVerifyCount || 0) };
		}
		return { regVerifyOpen };
	},

	async handleOpenRegKey(c, code) {
		if (!code) throw new BizError(t('emptyRegKey'));
		const row = await regKeyService.selectByCode(c, code);
		if (!row) throw new BizError(t('notExistRegKey'));
		this.assertUsableRegKey(row);
		return { roleId: row.roleId, regKeyId: row.regKeyId };
	},

	async handleOptionalRegKey(c, code) {
		if (!code) return null;
		const row = await regKeyService.selectByCode(c, code);
		if (!row) return null;
		try {
			this.assertUsableRegKey(row);
			return { roleId: row.roleId, regKeyId: row.regKeyId };
		} catch {
			return null;
		}
	},

	assertUsableRegKey(row) {
		if (Number(row.count) <= 0) throw new BizError(t('noRegKeyCount'));
		const today = toUtc().tz('Asia/Shanghai').startOf('day');
		const expireTime = toUtc(row.expireTime).tz('Asia/Shanghai').startOf('day');
		if (!expireTime.isValid() || expireTime.isBefore(today)) throw new BizError(t('regKeyExpire'));
	},

	async login(c, params = {}, noVerifyPwd = false, includeRefresh = false) {
		assertLoginRuntime(c);
		await rateLimitService.check(c, noVerifyPwd ? 'oauth-login' : 'login', {
			limit: Number(c.env.login_rate_limit) || 20,
			windowSeconds: 900
		});

		const email = normalizeEmail(params.email);
		const password = noVerifyPwd ? null : validatePassword(params.password, { allowLegacy: true });
		const userRow = await userService.selectByEmailIncludeDel(c, email);
		if (!userRow) throw new BizError(t('notExistUser'));
		if (userRow.isDel === isDel.DELETE) throw new BizError(t('isDelUser'));
		if (userRow.status === userConst.status.BAN) throw new BizError(t('isBanUser'), 403);

		if (!noVerifyPwd) {
			const valid = await cryptoUtils.verifyPassword(password, userRow.salt, userRow.password);
			if (!valid) throw new BizError(t('IncorrectPwd'), 401);
			const targetIterations = cryptoUtils.iterationsFromEnv(c.env);
			if (parseBooleanEnv(c.env.password_rehash_on_login, false)
				&& cryptoUtils.needsRehash(userRow.password, targetIterations)) {
				try {
					const { salt, hash } = await cryptoUtils.hashPassword(password, targetIterations);
					await userService.updatePasswordHash(c, userRow.userId, hash, salt);
					userRow.password = hash;
					userRow.salt = salt;
				} catch (error) {
					console.warn(`[${c.get('requestId') || 'login'}] 密码哈希升级失败，保留旧哈希继续登录`, error?.message || error);
				}
			}
		}

		const access = await issueAccessSession(c, userRow);
		if (!includeRefresh) return access.token;
		const refresh = await tryIssueRefreshCredential(c, userRow.userId, access.sessionToken);
		return {
			token: access.token,
			expiresIn: constant.TOKEN_EXPIRE,
			...(refresh || {})
		};
	},

	async refresh(c, params = {}) {
		assertLoginRuntime(c);
		await rateLimitService.check(c, 'session-refresh', {
			limit: Number(c.env.refresh_rate_limit) || 60,
			windowSeconds: 3600
		});
		const refreshToken = toTrimmedString(params.refreshToken, { name: 'refreshToken', max: 512 });
		if (!refreshToken || !refreshToken.startsWith('rt_')) throw new BizError(t('authExpired'), 401);
		const refreshHash = await sha256Hex(refreshToken);
		const now = Math.floor(Date.now() / 1000);

		let row;
		try {
			row = await c.env.db.prepare(`
				SELECT refresh_hash AS refreshHash, user_id AS userId, session_token AS sessionToken, expires_at AS expiresAt
				FROM refresh_session WHERE refresh_hash = ? LIMIT 1
			`).bind(refreshHash).first();
		} catch {
			throw new BizError(t('authExpired'), 401);
		}
		if (!row || Number(row.expiresAt) <= now) {
			if (row) await c.env.db.prepare('DELETE FROM refresh_session WHERE refresh_hash = ?').bind(refreshHash).run().catch(() => {});
			throw new BizError(t('authExpired'), 401);
		}

		// Consume first. Exactly one concurrent/replayed refresh request can rotate this credential.
		const consumed = await c.env.db.prepare('DELETE FROM refresh_session WHERE refresh_hash = ? AND expires_at > ?')
			.bind(refreshHash, now).run();
		if (Number(consumed?.meta?.changes || 0) !== 1) throw new BizError(t('authExpired'), 401);

		const userRow = await userService.selectByIdIncludeDel(c, Number(row.userId));
		if (!userRow || userRow.isDel === isDel.DELETE || userRow.status === userConst.status.BAN) {
			throw new BizError(t('authExpired'), 401);
		}

		const access = await issueAccessSession(c, userRow, { revokeSessionToken: String(row.sessionToken || '') });
		const refresh = await issueRefreshCredential(c, userRow.userId, access.sessionToken);
		return {
			token: access.token,
			expiresIn: constant.TOKEN_EXPIRE,
			...refresh
		};
	},

	async cleanupRefreshSessions(c) {
		const now = Math.floor(Date.now() / 1000);
		try {
			await c.env.db.prepare('DELETE FROM refresh_session WHERE expires_at <= ?').bind(now).run();
		} catch {
			// Pre-0004 installations remain compatible until migrations are applied.
		}
	},

	async logout(c, userId) {
		const token = await userContext.getToken(c);
		if (token) await revokeRefreshForSession(c, userId, token);
		const key = KvConst.AUTH_INFO + userId;
		const authInfo = await c.env.kv.get(key, { type: 'json' });
		if (!authInfo || !Array.isArray(authInfo.tokens) || !token) return;
		authInfo.tokens = authInfo.tokens.filter(item => item !== token);
		if (authInfo.tokens.length === 0) {
			await c.env.kv.delete(key);
			return;
		}
		await c.env.kv.put(key, JSON.stringify(authInfo), { expirationTtl: constant.TOKEN_EXPIRE });
	}
};

export default loginService;
