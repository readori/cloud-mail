import BizError from '../error/biz-error';
import { isDel, userConst } from '../const/entity-const';
import constant from '../const/constant';
import jwtUtils from '../utils/jwt-utils';
import KvConst from '../const/kv-const';
import dayjs from 'dayjs';
import userService from '../service/user-service';
import permService from '../service/perm-service';
import { t } from '../i18n/i18n';
import app from '../hono/hono';
import { assertCookieCsrf, clearWebSession, getAuthToken, refreshWebSessionCookie } from './auth-session';
import impersonationService from '../service/impersonation-service';

const TOKEN_RENEW_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const REFRESHED_TOKEN_HEADER = 'X-Refreshed-Token';

const publicRoutes = [
	['GET', '/health'],
	['POST', '/login'],
	['POST', '/register'],
	['GET', '/setting/websiteConfig'],
	['POST', '/webhooks'],
	['POST', '/init'],
	// Public only as a 410 Gone tombstone. The route handler never reads the legacy path secret.
	['GET', /^\/init\/[^/]+$/],
	['POST', '/public/genToken'],
	['GET', /^\/telegram\/getEmail\/[^/]+$/],
	['GET', '/oauth/state'],
	['GET', '/oauth/linuxDo/state'],
	['POST', '/oauth/linuxDo/login'],
	['POST', '/oauth/github/login'],
	['POST', '/oauth/google/login'],
	['PUT', '/oauth/bindUser'],
	['GET', /^\/oss(?:\/.*)?$/]
];

const permissionPaths = {
	'email:delete': [['DELETE', '/email/delete']],
	'email:send': [['POST', '/email/send']],
	'account:add': [['POST', '/account/add']],
	'account:query': [
		['GET', '/account/list'],
		['PUT', '/account/setName'],
		['PUT', '/account/setAllReceive'],
		['PUT', '/account/setAsTop']
	],
	'account:delete': [['DELETE', '/account/delete']],
	'my:delete': [['DELETE', '/my/delete']],
	'role:add': [['POST', '/role/add'], ['GET', '/role/tree']],
	'role:set': [['PUT', '/role/set'], ['PUT', '/role/setDefault'], ['GET', '/role/tree']],
	'role:query': [['GET', '/role/list'], ['GET', '/role/tree'], ['GET', '/role/selectUse']],
	'role:delete': [['DELETE', '/role/delete']],
	'user:query': [['GET', '/user/list'], ['GET', '/user/allAccount'], ['GET', '/role/selectUse']],
	'user:add': [['POST', '/user/add'], ['GET', '/role/selectUse']],
	'user:reset-send': [['PUT', '/user/resetSendCount']],
	'user:set-pwd': [['PUT', '/user/setPwd']],
	'user:set-status': [['PUT', '/user/setStatus'], ['PUT', '/user/restore']],
	'user:set-type': [['PUT', '/user/setType'], ['GET', '/role/selectUse']],
	'login-log:query': [['GET', '/loginLog/list'], ['GET', '/user/loginLog']],
	'user:delete': [['DELETE', '/user/delete'], ['DELETE', '/user/deleteAccount']],
	'all-email:query': [['GET', '/allEmail/list'], ['GET', '/allEmail/latest']],
	'all-email:delete': [['DELETE', '/allEmail/delete'], ['DELETE', '/allEmail/batchDelete']],
	'setting:query': [['GET', '/setting/query']],
	'setting:set': [
		['PUT', '/setting/set'],
		['PUT', '/setting/setBackground'],
		['DELETE', '/setting/deleteBackground'],
		['PUT', '/setting/setBlacklist'],
		['POST', '/setting/testTelegram'],
		['POST', '/setting/testEmailSend']
	],
	'analysis:query': [['GET', '/analysis/echarts']],
	'reg-key:add': [['POST', '/regKey/add'], ['GET', '/role/selectUse']],
	'reg-key:query': [['GET', '/regKey/list'], ['GET', '/regKey/history'], ['GET', '/role/selectUse']],
	'reg-key:delete': [['DELETE', '/regKey/delete'], ['DELETE', '/regKey/clearNotUse']]
};

const protectedPermissionRoutes = Object.values(permissionPaths).flat();

// 代登录＝完整以目标账号身份登录：按目标账号自己的权限放行（目标是管理员就拥有管理页，
// 看全部邮件、用户列表、登录日志等都可用）。仅保留少数安全闸：
// - 不能在代登录里再发起代登录（禁止嵌套）；
// - 不能修改这个账号自己的登录密码或自删(凭据接管向量，超级管理员需要时用管理端 /user/* 操作)；
// - 不注册/注销推送订阅(代登录结束后仍存在的持久化通道，发起方是管理员的浏览器)。
// 超级管理员账号(env.admin)始终受 assertMutableUser 保护，代登录也改不了它的密码/状态。
const impersonationForbiddenRoutes = [
	['PUT', '/my/resetPassword'],
	['DELETE', '/my/delete'],
	['POST', '/impersonate/start'],
	['POST', '/device/register'],
	['DELETE', '/device/unregister']
];

function routeMatches(route, method, path) {
	const [routeMethod, routePath] = route;
	if (routeMethod !== method) return false;
	return routePath instanceof RegExp ? routePath.test(path) : routePath === path;
}

function isAdmin(c, user) {
	return typeof c.env?.admin === 'string'
		&& typeof user?.email === 'string'
		&& user.email.toLowerCase() === c.env.admin.toLowerCase();
}

app.use('*', async (c, next) => {
	const method = c.req.method.toUpperCase();
	const path = c.req.path;

	if (publicRoutes.some(route => routeMatches(route, method, path))) return next();

	if (path.startsWith('/public/')) {
		const expectedToken = await c.env.kv.get(KvConst.PUBLIC_KEY);
		const suppliedToken = c.req.header(constant.TOKEN_HEADER);
		if (!expectedToken || typeof suppliedToken !== 'string' || suppliedToken !== expectedToken) {
			throw new BizError(t('publicTokenFail'), 401);
		}
		return next();
	}

	const auth = getAuthToken(c);
	if (!assertCookieCsrf(c, request => {
		const origin = request.req.header('Origin');
		if (origin) {
			try {
				const ownOrigin = new URL(request.req.url).origin;
				if (origin === ownOrigin) return true;
				const configured = String(request.env?.cors_origins || '').split(',').map(v => v.trim()).filter(Boolean);
				return configured.includes(origin);
			} catch { return false; }
		}
		return request.req.header('Sec-Fetch-Site') !== 'cross-site';
	})) throw new BizError('CSRF validation failed', 403);

	const tokenPayload = await jwtUtils.verifyToken(c, auth.token);
	if (!tokenPayload || !Number.isSafeInteger(Number(tokenPayload.userId)) || typeof tokenPayload.token !== 'string'
		|| (tokenPayload.gen ?? constant.AUTH_GEN) !== constant.AUTH_GEN) {
		if (auth.source === 'cookie') clearWebSession(c);
		throw new BizError(t('authExpired'), 401);
	}

	const userId = Number(tokenPayload.userId);

	// 代登录会话：独立存放，不走目标账号的正常会话；完整以目标身份放行(按目标自己的权限)，
	// 仅拦截少数安全闸(禁止嵌套、改本账号登录密码/自删、推送注册)，并每次重新核验目标状态。
	if (tokenPayload.imp === 1) {
		const impRecord = await impersonationService.resolveSession(c, tokenPayload.token, userId);
		if (!impRecord) {
			if (auth.source === 'cookie') clearWebSession(c);
			throw new BizError(t('authExpired'), 401);
		}
		// 实时核验目标：被禁用/删除后代登录会话立即失效，不再用 start 时的快照放行。
		const targetRow = await userService.selectById(c, userId);
		if (!targetRow || targetRow.isDel === isDel.DELETE || targetRow.status === userConst.status.BAN) {
			if (auth.source === 'cookie') clearWebSession(c);
			throw new BizError(t('authExpired'), 401);
		}
		if (impersonationForbiddenRoutes.some(route => routeMatches(route, method, path))) {
			throw new BizError(t('impersonationForbidden'), 403);
		}
		const targetUser = {
			userId: targetRow.userId,
			email: targetRow.email,
			type: targetRow.type,
			status: targetRow.status,
			isDel: targetRow.isDel
		};
		// 代登录从不被视为超级管理员(目标不是 env.admin)：受权限保护的路由按目标自己的权限校验。
		if (protectedPermissionRoutes.some(route => routeMatches(route, method, path)) && !isAdmin(c, targetUser)) {
			const permKeys = await permService.userPermKeys(c, userId);
			const allowedRoutes = (Array.isArray(permKeys) ? permKeys : [])
				.flatMap(key => permissionPaths[key] || []);
			if (!allowedRoutes.some(route => routeMatches(route, method, path))) {
				throw new BizError(t('unauthorized'), 403);
			}
		}
		c.set('user', targetUser);
		c.set('authToken', auth.token);
		c.set('authSource', auth.source);
		c.set('impersonation', {
			adminUserId: impRecord.adminUserId,
			adminEmail: impRecord.adminEmail,
			targetUserId: impRecord.targetUserId,
			auditId: impRecord.auditId
		});
		return next();
	}

	const authInfo = await c.env.kv.get(KvConst.AUTH_INFO + userId, { type: 'json' });
	if (!authInfo || !authInfo.user || !Array.isArray(authInfo.tokens) || !authInfo.tokens.includes(tokenPayload.token)) {
		if (auth.source === 'cookie') clearWebSession(c);
		throw new BizError(t('authExpired'), 401);
	}

	if (protectedPermissionRoutes.some(route => routeMatches(route, method, path)) && !isAdmin(c, authInfo.user)) {
		const permKeys = await permService.userPermKeys(c, userId);
		const allowedRoutes = (Array.isArray(permKeys) ? permKeys : [])
			.flatMap(key => permissionPaths[key] || []);
		if (!allowedRoutes.some(route => routeMatches(route, method, path))) {
			throw new BizError(t('unauthorized'), 403);
		}
	}

	const refreshTime = dayjs(authInfo.refreshTime);
	if (!refreshTime.isValid() || !dayjs().startOf('day').isSame(refreshTime.startOf('day'))) {
		authInfo.refreshTime = dayjs().toISOString();
		await userService.updateUserInfo(c, userId);
		await c.env.kv.put(
			KvConst.AUTH_INFO + userId,
			JSON.stringify(authInfo),
			{ expirationTtl: constant.TOKEN_EXPIRE }
		);
	}

	// 滑动续期：JWT 剩余有效期不足 7 天时签发新 JWT(同一会话)，活跃用户不会因 30 天硬过期被登出。
	// App 通过 X-Refreshed-Token 响应头获取，网页端直接更新会话 Cookie。
	const nowSeconds = Math.floor(Date.now() / 1000);
	if (Number.isFinite(tokenPayload.exp) && tokenPayload.exp - nowSeconds < TOKEN_RENEW_WINDOW_SECONDS) {
		const renewed = await jwtUtils.generateToken(c, { userId, token: tokenPayload.token, gen: constant.AUTH_GEN }, constant.TOKEN_EXPIRE);
		if (auth.source === 'cookie') refreshWebSessionCookie(c, renewed);
		else c.header(REFRESHED_TOKEN_HEADER, renewed);
	}

	c.set('user', authInfo.user);
	c.set('authToken', auth.token);
	c.set('authSource', auth.source);
	return next();
});
