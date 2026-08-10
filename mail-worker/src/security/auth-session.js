import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import constant from '../const/constant';

const PROD_SESSION_COOKIE = '__Host-cfmail_session';
const DEV_SESSION_COOKIE = 'cfmail_session_dev';
const CSRF_COOKIE = 'cfmail_csrf';
const WEB_HEADER = 'X-CFMail-Web';
const CSRF_HEADER = 'X-CSRF-Token';

function requestIsHttps(c) {
	try { return new URL(c.req.url).protocol === 'https:'; }
	catch { return true; }
}

function sessionCookieName(c) {
	return requestIsHttps(c) ? PROD_SESSION_COOKIE : DEV_SESSION_COOKIE;
}

function normalizeAuthorization(value) {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	if (/^Bearer\s+/i.test(trimmed)) return trimmed.replace(/^Bearer\s+/i, '').trim();
	return trimmed;
}

export function getAuthToken(c) {
	const header = normalizeAuthorization(c.req.header(constant.TOKEN_HEADER));
	if (header) return { token: header, source: 'authorization' };
	const cookieToken = getCookie(c, PROD_SESSION_COOKIE) || getCookie(c, DEV_SESSION_COOKIE) || '';
	return cookieToken ? { token: cookieToken, source: 'cookie' } : { token: '', source: 'none' };
}

export function isWebClient(c) {
	return c.req.header(WEB_HEADER) === '1' || getAuthToken(c).source === 'cookie';
}

export function setWebSession(c, jwt) {
	const secure = requestIsHttps(c);
	const name = sessionCookieName(c);
	const options = {
		httpOnly: true,
		secure,
		sameSite: 'Strict',
		path: '/',
		maxAge: constant.TOKEN_EXPIRE
	};
	setCookie(c, name, jwt, options);
	// Clear the alternate development/production name when switching environments.
	deleteCookie(c, name === PROD_SESSION_COOKIE ? DEV_SESSION_COOKIE : PROD_SESSION_COOKIE, { path: '/' });
	const csrfToken = crypto.randomUUID();
	setCookie(c, CSRF_COOKIE, csrfToken, {
		httpOnly: false,
		secure,
		sameSite: 'Strict',
		path: '/',
		maxAge: constant.TOKEN_EXPIRE
	});
	c.header('X-CSRF-Token', csrfToken);
	return csrfToken;
}

export function clearWebSession(c) {
	for (const name of [PROD_SESSION_COOKIE, DEV_SESSION_COOKIE, CSRF_COOKIE]) {
		deleteCookie(c, name, { path: '/', secure: name === PROD_SESSION_COOKIE });
	}
	c.header('Clear-Site-Data', '"cache"');
}

export function isCookieAuthenticated(c) {
	return getAuthToken(c).source === 'cookie';
}

export function assertCookieCsrf(c, isTrustedOrigin) {
	if (!isCookieAuthenticated(c)) return true;
	const method = c.req.method.toUpperCase();
	if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return true;
	if (!isTrustedOrigin(c)) return false;
	const supplied = String(c.req.header(CSRF_HEADER) || '');
	const expected = String(getCookie(c, CSRF_COOKIE) || '');
	return expected.length >= 16 && supplied.length === expected.length && supplied === expected;
}

export const authSessionHeaders = {
	web: WEB_HEADER,
	csrf: CSRF_HEADER
};
