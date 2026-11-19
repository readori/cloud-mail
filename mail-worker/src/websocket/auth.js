import jwtUtils from '../utils/jwt-utils';
import constant from '../const/constant';
import KvConst from '../const/kv-const';
import permService from '../service/perm-service';

const SESSION_COOKIES = ['__Host-cfmail_session', 'cfmail_session_dev'];

// 上游 v3.6 实时推送：握手时从 query / Authorization / 网页会话 Cookie 取令牌。
// 本分支网页端用 HttpOnly Cookie 登录，浏览器同源发起 WebSocket 时会自动带上 Cookie。
export function readWsToken(request) {
	const url = new URL(request.url);
	const header = String(request.headers.get(constant.TOKEN_HEADER) || '').replace(/^Bearer\s+/i, '').trim();
	const query = String(url.searchParams.get('token') || '').trim();
	if (header) return { token: header, source: 'authorization' };
	if (query) return { token: query, source: 'query' };
	const cookieHeader = request.headers.get('Cookie') || '';
	for (const name of SESSION_COOKIES) {
		const value = readCookie(cookieHeader, name);
		if (value) return { token: value, source: 'cookie' };
	}
	return { token: '', source: 'none' };
}

function readCookie(cookieHeader, name) {
	for (const part of String(cookieHeader).split(';')) {
		const [key, ...rest] = part.trim().split('=');
		if (key === name) {
			try { return decodeURIComponent(rest.join('=')); } catch { return ''; }
		}
	}
	return '';
}

// 校验握手令牌，确认会话仍在 KV 中。
export async function getWsUser(env, token) {
	if (!token) return null;
	const result = await jwtUtils.verifyToken({ env }, token);
	if (!result || (result.gen ?? constant.AUTH_GEN) !== constant.AUTH_GEN) return null;
	const userId = Number(result.userId);
	const sessionToken = result.token;
	if (!Number.isSafeInteger(userId) || userId <= 0 || typeof sessionToken !== 'string') return null;
	const authInfo = await env.kv.get(KvConst.AUTH_INFO + userId, { type: 'json' });
	if (!authInfo?.user || !Array.isArray(authInfo.tokens) || !authInfo.tokens.includes(sessionToken)) return null;
	return authInfo.user;
}

// 全部邮件通道：管理员或具备 all-email:query 的用户才能订阅。
export async function canWatchAllEmail(env, user) {
	if (!user?.userId) return false;
	if (user.email && env.admin && String(user.email).toLowerCase() === String(env.admin).toLowerCase()) return true;
	const keys = await permService.userPermKeys({ env }, user.userId);
	return Array.isArray(keys) && keys.includes('all-email:query');
}

// 校验 Origin，防止其它站点借用户的 Cookie 连上(跨站 WebSocket 劫持)。
// 原生客户端不带 Origin，只允许用 Authorization / query 令牌连接；Cookie 会话必须同源。
export function hasValidWsOrigin(request, source, env) {
	const origin = request.headers.get('Origin');
	if (!origin) return source !== 'cookie';
	try {
		const originUrl = new URL(origin);
		const reqUrl = new URL(request.url);
		if (originUrl.host === reqUrl.host) return true;
		const configured = String(env?.cors_origins || '').split(',').map(item => item.trim()).filter(Boolean);
		if (configured.includes(originUrl.origin)) return true;
		return isLocalHostname(originUrl.hostname) && isLocalHostname(reqUrl.hostname);
	} catch {
		return false;
	}
}

function isLocalHostname(host) {
	return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}
