// Web 诊断日志：在内存环形缓冲中记录关键事件（API 调用、JS 错误、路由跳转、WebSocket、
// 登录/代登录/切账号等），并持久化到 localStorage，便于白屏/重载后仍能导出排查。
//
// 脱敏原则：只记元数据（方法/路径/状态/错误码/消息/耗时/错误栈），绝不记录密码、令牌、
// Cookie、邮件正文或任何接口返回的业务数据。

const MAX_ENTRIES = 500;
const STORAGE_KEY = 'cfmail_diag_v1';
const PERSIST_DEBOUNCE_MS = 500;

const LEVELS = ['debug', 'info', 'warn', 'error'];

let entries = [];
let seq = 0;
let persistTimer = null;
const listeners = new Set();

function nowIso() {
	try { return new Date().toISOString(); } catch { return ''; }
}

function safeString(value, max = 500) {
	if (value == null) return '';
	let str;
	if (typeof value === 'string') str = value;
	else {
		try { str = JSON.stringify(value); } catch { str = String(value); }
	}
	return str.length > max ? str.slice(0, max) + '…' : str;
}

// 仅保留路径与查询串，去掉源站，并截断，避免把完整 URL 或潜在的长参数写进日志。
function safePath(url) {
	if (typeof url !== 'string') return '';
	try {
		const u = new URL(url, window.location.origin);
		return (u.pathname + u.search).slice(0, 300);
	} catch {
		return url.split('#')[0].slice(0, 300);
	}
}

function loadPersisted() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed?.entries)) {
			entries = parsed.entries.slice(-MAX_ENTRIES);
			seq = entries.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
		}
	} catch {
		// 读取失败不影响运行。
	}
}

function schedulePersist() {
	if (persistTimer) return;
	persistTimer = setTimeout(() => {
		persistTimer = null;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries }));
		} catch {
			// 配额满或隐私模式：丢弃持久化，内存日志仍可用。
		}
	}, PERSIST_DEBOUNCE_MS);
}

function notify() {
	for (const fn of listeners) {
		try { fn(); } catch { /* ignore */ }
	}
}

export const diag = {
	log(category, level, message, data) {
		const lvl = LEVELS.includes(level) ? level : 'info';
		const entry = {
			id: ++seq,
			t: nowIso(),
			level: lvl,
			category: String(category || 'app').slice(0, 32),
			message: safeString(message, 500),
		};
		if (data && typeof data === 'object') {
			for (const [k, v] of Object.entries(data)) {
				if (v === undefined) continue;
				entry[k] = typeof v === 'number' || typeof v === 'boolean' ? v : safeString(v, 1000);
			}
		}
		entries.push(entry);
		if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
		schedulePersist();
		notify();
		return entry;
	},
	debug(category, message, data) { return this.log(category, 'debug', message, data); },
	info(category, message, data) { return this.log(category, 'info', message, data); },
	warn(category, message, data) { return this.log(category, 'warn', message, data); },
	error(category, message, data) { return this.log(category, 'error', message, data); },

	entries() { return entries.slice(); },

	clear() {
		entries = [];
		seq = 0;
		try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
		notify();
	},

	subscribe(fn) {
		listeners.add(fn);
		return () => listeners.delete(fn);
	},

	environment() {
		const nav = typeof navigator !== 'undefined' ? navigator : {};
		const scr = typeof screen !== 'undefined' ? screen : {};
		return {
			userAgent: safeString(nav.userAgent, 400),
			language: safeString(nav.language, 32),
			platform: safeString(nav.platform, 64),
			appVersion: safeString(import.meta.env?.VITE_APP_VERSION || '', 32),
			buildMode: safeString(import.meta.env?.MODE || '', 32),
			screen: `${scr.width || 0}x${scr.height || 0}`,
			viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
			devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
			online: typeof nav.onLine === 'boolean' ? nav.onLine : null,
			url: safePath(typeof window !== 'undefined' ? window.location.href : ''),
			exportedAt: nowIso(),
		};
	},

	export() {
		return { app: this.environment(), entryCount: entries.length, entries: entries.slice() };
	},

	exportText() {
		return JSON.stringify(this.export(), null, 2);
	},
};

export { safePath };

loadPersisted();
diag.info('app', 'diagnostics logger initialized', { count: entries.length });
