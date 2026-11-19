import { canWatchAllEmail, getWsUser, hasValidWsOrigin, readWsToken } from './auth';
import { ALL_EMAIL_HUB } from './notify';

// 鉴权失败用 WebSocket 关闭码 4401，前端据此停止重连（浏览器读不到握手阶段的 HTTP 401）。
const CLOSE_UNAUTHORIZED = 4401;

// Worker 入口 /realtime：先校验 Origin / 登录态 / 全部邮件权限，再转到对应 Durable Object。
// scope=inbox（默认）→ 用户自己的 hub；scope=all-email → 全部邮件共享 hub。
export async function handleWsUpgrade(request, env) {
	if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
		return new Response('Expected WebSocket upgrade', { status: 426 });
	}
	if (!env.ws) {
		return new Response('WebSocket unavailable', { status: 503 });
	}

	const url = new URL(request.url);
	const { token, source } = readWsToken(request);
	const scope = url.searchParams.get('scope') === 'all-email' ? 'all-email' : 'inbox';
	let user = null;
	try {
		user = hasValidWsOrigin(request, source, env) ? await getWsUser(env, token) : null;
		if (user?.userId && scope === 'all-email' && !await canWatchAllEmail(env, user)) user = null;
	} catch (error) {
		console.warn('WebSocket 鉴权失败', error?.message || error);
		user = null;
	}
	if (!user?.userId) return rejectUnauthorized();

	const hubName = scope === 'all-email' ? ALL_EMAIL_HUB : String(user.userId);
	const stub = env.ws.getByName(hubName);
	return stub.fetch(new Request('https://mail-ws/connect', request));
}

// 先 Upgrade 再告诉客户端失败，关闭码 4401。
function rejectUnauthorized() {
	const pair = new WebSocketPair();
	const client = pair[0];
	const server = pair[1];
	server.accept();
	try {
		server.send(JSON.stringify({ type: 'error', code: 401 }));
	} catch {
		// ignore
	}
	server.close(CLOSE_UNAUTHORIZED, 'Unauthorized');
	return new Response(null, { status: 101, webSocket: client });
}
