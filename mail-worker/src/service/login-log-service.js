import reqUtils from '../utils/req-utils';
import { toId, toPageNumber, toPageSize } from '../utils/input-utils';

// 每个用户最多保留的登录记录条数，超出时删除最旧的记录，避免表无限增长。
const MAX_LOGS_PER_USER = 200;

// 未重新执行 /init 的旧部署：首次用到时自动建表。
async function withTable(c, run) {
	try {
		return await run();
	} catch (error) {
		if (!/no such table/i.test(String(error?.message) + String(error?.cause?.message || ''))) throw error;
		await loginLogService.ensureTable(c);
		return run();
	}
}

function clip(value, max) {
	return typeof value === 'string' && value ? value.slice(0, max) : '';
}

const loginLogService = {

	async ensureTable(c) {
		await c.env.db.batch([
			c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS login_log (
					log_id INTEGER PRIMARY KEY AUTOINCREMENT,
					user_id INTEGER NOT NULL,
					ip TEXT NOT NULL DEFAULT '',
					country TEXT NOT NULL DEFAULT '',
					city TEXT NOT NULL DEFAULT '',
					os TEXT NOT NULL DEFAULT '',
					browser TEXT NOT NULL DEFAULT '',
					device TEXT NOT NULL DEFAULT '',
					method TEXT NOT NULL DEFAULT 'password',
					create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
				)`),
			c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_login_log_user ON login_log(user_id, log_id)`)
		]);
	},

	/**
	 * 「登录日志」权限(用户信息 → 登录日志)。超级管理员默认拥有，可在「权限」中分配给其他身份。
	 * 由 /init 和权限树加载时调用，未重新执行 /init 的部署也能在权限设置里看到它。
	 */
	async ensurePerm(c) {
		try {
			await c.env.db.prepare(`
				INSERT INTO perm (name, perm_key, pid, type, sort)
				SELECT '登录日志', 'login-log:query', 6, 2, 8
				WHERE NOT EXISTS (SELECT 1 FROM perm WHERE perm_key = 'login-log:query')
					AND EXISTS (SELECT 1 FROM perm WHERE perm_id = 6)
			`).run();
		} catch (error) {
			console.warn(`跳过登录日志权限：${error.message}`);
		}
	},

	/** 登录成功后调用；记录失败不影响登录。 */
	async record(c, userId, method = 'password') {
		try {
			const ip = reqUtils.getIp(c);
			const { os, browser, device } = reqUtils.getUserAgent(c);
			const cf = c.req.raw?.cf || {};
			await withTable(c, () => c.env.db.batch([
				c.env.db.prepare(`
					INSERT INTO login_log (user_id, ip, country, city, os, browser, device, method)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				`).bind(userId, ip, clip(cf.country, 8), clip(cf.city, 64), clip(os, 64), clip(browser, 64), clip(device, 128), clip(method, 16)),
				c.env.db.prepare(`
					DELETE FROM login_log WHERE user_id = ? AND log_id NOT IN (
						SELECT log_id FROM login_log WHERE user_id = ? ORDER BY log_id DESC LIMIT ${MAX_LOGS_PER_USER}
					)
				`).bind(userId, userId)
			]));
		} catch (error) {
			console.warn(`[${c.get?.('requestId') || 'login'}] 登录记录写入失败`, error?.message || error);
		}
	},

	async list(c, params = {}) {
		const userId = toId(params.userId, 'userId');
		const size = toPageSize(params.size, { defaultValue: 20, max: 50 });
		const page = toPageNumber(params.num);
		const [rows, count] = await withTable(c, () => c.env.db.batch([
			c.env.db.prepare(`
				SELECT log_id AS logId, user_id AS userId, ip, country, city, os, browser, device, method, create_time AS createTime
				FROM login_log WHERE user_id = ? ORDER BY log_id DESC LIMIT ? OFFSET ?
			`).bind(userId, size, (page - 1) * size),
			c.env.db.prepare(`SELECT COUNT(*) AS total FROM login_log WHERE user_id = ?`).bind(userId)
		]));
		return { list: rows.results || [], total: count.results?.[0]?.total || 0 };
	},

	/** 所有用户的登录日志(仅超级管理员)，可按邮箱前缀或 IP 前缀筛选。 */
	async listAll(c, params = {}) {
		const size = toPageSize(params.size, { defaultValue: 20, max: 50 });
		const page = toPageNumber(params.num);
		const email = typeof params.email === 'string' ? params.email.trim().slice(0, 254) : '';
		const ip = typeof params.ip === 'string' ? params.ip.trim().slice(0, 64) : '';
		const conditions = [];
		const binds = [];
		if (email) {
			conditions.push('u.email COLLATE NOCASE LIKE ?');
			binds.push(email.replace(/[%_]/g, '') + '%');
		}
		if (ip) {
			conditions.push('l.ip LIKE ?');
			binds.push(ip.replace(/[%_]/g, '') + '%');
		}
		// 关键词：在邮箱、IP、国家、城市、设备、系统、浏览器、登录方式中模糊匹配(多个词用空格分隔，需全部命中)
		const keywords = (typeof params.keyword === 'string' ? params.keyword : '')
			.trim().slice(0, 100).split(/\s+/).filter(Boolean).slice(0, 5);
		const methodAlias = { '密码': 'password', '第三方': 'oauth', 'oauth': 'oauth', 'password': 'password' };
		for (const word of keywords) {
			const pattern = '%' + word.replace(/[\\%_]/g, char => '\\' + char) + '%';
			const fields = ['u.email', 'l.ip', 'l.country', 'l.city', 'l.device', 'l.os', 'l.browser', 'l.method'];
			const parts = fields.map(field => `${field} LIKE ? ESCAPE '\\'`);
			binds.push(...fields.map(() => pattern));
			const method = methodAlias[word.toLowerCase()];
			if (method) {
				parts.push('l.method = ?');
				binds.push(method);
			}
			conditions.push(`(${parts.join(' OR ')})`);
		}
		const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
		const [rows, count] = await withTable(c, () => c.env.db.batch([
			c.env.db.prepare(`
				SELECT l.log_id AS logId, l.user_id AS userId, u.email AS email, l.ip, l.country, l.city,
					l.os, l.browser, l.device, l.method, l.create_time AS createTime
				FROM login_log l LEFT JOIN user u ON u.user_id = l.user_id
				${where} ORDER BY l.log_id DESC LIMIT ? OFFSET ?
			`).bind(...binds, size, (page - 1) * size),
			c.env.db.prepare(`SELECT COUNT(*) AS total FROM login_log l LEFT JOIN user u ON u.user_id = l.user_id ${where}`).bind(...binds)
		]));
		return { list: rows.results || [], total: count.results?.[0]?.total || 0 };
	},

	async deleteByUserIds(c, userIds) {
		if (!userIds?.length) return;
		const placeholders = userIds.map(() => '?').join(',');
		await withTable(c, () => c.env.db.prepare(`DELETE FROM login_log WHERE user_id IN (${placeholders})`).bind(...userIds).run());
	}
};

export default loginLogService;
