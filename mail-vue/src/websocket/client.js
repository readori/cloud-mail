import { diag } from '@/diagnostics/logger.js';
// 收件箱 / 全部邮件的 WebSocket 实时推送客户端（上游 cloud-mail v3.6）。
// 本分支网页端使用 HttpOnly Cookie 会话：同源 WebSocket 握手会自动带上 Cookie，URL 里不放 token。
// 连接期间靠推送刷新列表；断开后指数退避重连（1s、2s、4s… 最长 30s），
// 未连上（不支持、被拒绝、断线）时由页面按「自动刷新」间隔轮询兜底。
const HEARTBEAT_MS = 25_000;
const RECONNECT_MAX_MS = 30_000;
const PULL_DEBOUNCE_MS = 150;
// 与 Worker 约定：鉴权 / Origin / 全部邮件权限失败时用此关闭码，不再重连。
const CLOSE_UNAUTHORIZED = 4401;

// autoRefresh：0 关闭；其它值(3/5/10/15/20 秒)开启实时推送，并作为断线时的轮询间隔。
export function isAutoRefreshEnabled(value) {
	return Number(value) > 0;
}

export function createWsClient(scope) {
	let options = null;
	let socket = null;
	let heartbeatTimer = null;
	let reconnectTimer = null;
	let pullTimer = null;
	let connected = false;
	let listenersBound = false;
	let authRejected = false;
	let reconnectAttempt = 0;

	// 进入页面后开始连接；opts.isEnabled / onMessage / onReconnect。
	function start(opts) {
		options = opts;
		authRejected = false;
		reconnectAttempt = 0;
		if (!listenersBound) {
			document.addEventListener('visibilitychange', onVisibilityChange);
			listenersBound = true;
		}
		sync();
	}

	// 离开页面或登出时关闭连接。
	function stop() {
		options = null;
		clearPullTimer();
		disconnect();
	}

	// 按自动刷新开关决定连接或断开。
	function sync() {
		if (shouldConnect()) {
			connect();
			return;
		}
		disconnect();
	}

	function shouldConnect() {
		return Boolean(options && typeof WebSocket !== 'undefined' && options.isEnabled?.() && !authRejected);
	}

	function getWsUrl() {
		const base = import.meta.env.VITE_BASE_URL || '/api';
		let httpUrl;
		try {
			httpUrl = new URL(base, window.location.origin);
		} catch {
			return '';
		}
		const protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
		const wsUrl = new URL(`${protocol}//${httpUrl.host}/realtime`);
		if (scope && scope !== 'inbox') {
			wsUrl.searchParams.set('scope', scope);
		}
		return wsUrl.toString();
	}

	// 标签页回到前台且未连接时尝试重连；补拉只在 onopen 里做。
	function onVisibilityChange() {
		if (document.visibilityState !== 'visible' || !shouldConnect() || connected) {
			return;
		}
		connect();
	}

	function connect() {
		if (!shouldConnect() || (socket && socket.readyState !== WebSocket.CLOSED)) {
			return;
		}
		const url = getWsUrl();
		if (!url) {
			return;
		}
		clearReconnectTimer();
		try {
			socket = new WebSocket(url);
		} catch (e) {
			console.error(e);
			scheduleReconnect();
			return;
		}

		socket.onopen = () => {
			diag.info('ws', 'open', { scope });
			reconnectAttempt = 0;
			connected = true;
			sendHeartbeat();
			heartbeatTimer = window.setInterval(sendHeartbeat, HEARTBEAT_MS);
			schedulePull();
		};

		socket.onmessage = (event) => {
			if (event.data === 'pong' || typeof event.data !== 'string') {
				return;
			}
			let payload;
			try {
				payload = JSON.parse(event.data);
			} catch {
				return;
			}
			if (payload?.type === 'error') {
				diag.warn('ws', 'auth rejected (error payload)', { scope });
				authRejected = true;
				connected = false;
				clearHeartbeat();
				return;
			}
			if (payload?.type === 'new_message') {
				options?.onMessage?.(payload);
			}
		};

		socket.onerror = () => {
			socket?.close();
		};

		socket.onclose = (event) => {
			clearHeartbeat();
			socket = null;
			connected = false;
			if (event.code === CLOSE_UNAUTHORIZED || authRejected) {
				diag.warn('ws', 'closed unauthorized; stop reconnect', { scope, code: event.code });
				authRejected = true;
				return;
			}
			diag.info('ws', 'closed; will reconnect', { scope, code: event.code });
			scheduleReconnect();
		};
	}

	function disconnect() {
		clearHeartbeat();
		clearReconnectTimer();
		if (socket) {
			socket.onclose = null;
			socket.close(1000, 'client closed');
			socket = null;
		}
		connected = false;
	}

	// 断开后指数退避：1s、2s、4s… 封顶 30s。
	function scheduleReconnect() {
		if (!shouldConnect() || reconnectTimer) {
			return;
		}
		const delay = Math.min(1_000 * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
		reconnectAttempt += 1;
		reconnectTimer = window.setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, delay);
	}

	function sendHeartbeat() {
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ type: 'ping' }));
		}
	}

	// 连上后防抖补拉，避免漏掉断开窗口里的新信。
	function schedulePull() {
		if (!options?.onReconnect) {
			return;
		}
		clearPullTimer();
		pullTimer = window.setTimeout(() => {
			pullTimer = null;
			options?.onReconnect?.();
		}, PULL_DEBOUNCE_MS);
	}

	function clearHeartbeat() {
		if (heartbeatTimer) {
			window.clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
	}

	function clearReconnectTimer() {
		if (reconnectTimer) {
			window.clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	}

	function clearPullTimer() {
		if (pullTimer) {
			window.clearTimeout(pullTimer);
			pullTimer = null;
		}
	}

	// 手动刷新列表成功后：退避清零；还没连上就马上再连(登录失效被拒后也重新尝试一次)。
	function retryNow() {
		reconnectAttempt = 0;
		authRejected = false;
		if (!shouldConnect() || connected) {
			return;
		}
		if (socket && socket.readyState !== WebSocket.CLOSED) {
			return;
		}
		clearReconnectTimer();
		connect();
	}

	function isConnected() {
		return connected;
	}

	return { start, stop, sync, retryNow, isConnected };
}

export const inboxWs = createWsClient('inbox');
export const allEmailWs = createWsClient('all-email');
