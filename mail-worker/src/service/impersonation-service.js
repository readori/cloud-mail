import BizError from '../error/biz-error';
import { isDel, userConst } from '../const/entity-const';
import constant from '../const/constant';
import KvConst from '../const/kv-const';
import { v4 as uuidv4 } from 'uuid';
import JwtUtils from '../utils/jwt-utils';
import dayjs from 'dayjs';
import userService from './user-service';
import reqUtils from '../utils/req-utils';
import { toId, toPageNumber, toPageSize } from '../utils/input-utils';
import { t } from '../i18n/i18n.js';

// 代登录会话有效期：短于普通会话，到点自动失效，必须由超级管理员重新发起。
const IMPERSONATE_EXPIRE = 60 * 60 * 2;

// 未重新执行 /init 的旧部署：首次用到审计表时自动建表。
async function withTable(c, run) {
	try {
		return await run();
	} catch (error) {
		if (!/no such table/i.test(String(error?.message) + String(error?.cause?.message || ''))) throw error;
		await impersonationService.ensureTable(c);
		return run();
	}
}

function isSuperAdminEmail(c, email) {
	return typeof c.env?.admin === 'string'
		&& typeof email === 'string'
		&& email.toLowerCase() === c.env.admin.toLowerCase();
}

function sessionUserOf(userRow) {
	return {
		userId: userRow.userId,
		email: userRow.email,
		type: userRow.type,
		status: userRow.status,
		isDel: userRow.isDel
	};
}

const impersonationService = {

	async ensureTable(c) {
		await c.env.db.batch([
			c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS impersonation_log (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					admin_user_id INTEGER NOT NULL,
					admin_email TEXT NOT NULL DEFAULT '',
					target_user_id INTEGER NOT NULL,
					target_email TEXT NOT NULL DEFAULT '',
					ip TEXT NOT NULL DEFAULT '',
					start_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
					end_time DATETIME
				)`),
			c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_impersonation_admin ON impersonation_log(admin_user_id, id)`)
		]);
	},

	/** 当前请求是否来自代登录会话（由鉴权中间件写入 c）。 */
	context(c) {
		return c.get('impersonation') || null;
	},

	assertSuperAdmin(c) {
		const user = c.get('user');
		if (!isSuperAdminEmail(c, user?.email)) throw new BizError(t('unauthorized'), 403);
		return user;
	},

	/**
	 * 超级管理员代登录到目标账号。返回面向目标账号的会话 JWT，并写一条审计记录。
	 * 代登录会话独立存放（不写入目标账号的正常会话），因此不会延长或登出目标账号的真实登录，
	 * 日常收发也不额外产生登录/操作记录——只保留这一条“谁在何时代登录了谁、何时结束”的审计。
	 */
	async start(c, params = {}) {
		const admin = this.assertSuperAdmin(c);
		if (this.context(c)) throw new BizError(t('impersonationNested'), 403);

		const targetUserId = toId(params.userId, 'userId');
		if (Number(targetUserId) === Number(admin.userId)) throw new BizError(t('impersonationSelf'), 400);

		const targetRow = await userService.selectById(c, targetUserId);
		if (!targetRow || targetRow.isDel === isDel.DELETE) throw new BizError(t('notExistUser'), 404);
		if (isSuperAdminEmail(c, targetRow.email)) throw new BizError(t('impersonationSelf'), 400);
		if (targetRow.status === userConst.status.BAN) throw new BizError(t('isBanUser'), 403);

		const ip = reqUtils.getIp(c);
		const insert = await c.env.db.prepare(`
			INSERT INTO impersonation_log (admin_user_id, admin_email, target_user_id, target_email, ip)
			VALUES (?, ?, ?, ?, ?)
		`).bind(admin.userId, String(admin.email || '').slice(0, 254), targetUserId, String(targetRow.email || '').slice(0, 254), ip);

		let auditId;
		try {
			auditId = (await withTable(c, () => insert.run()))?.meta?.last_row_id;
		} catch (error) {
			console.warn(`[${c.get?.('requestId') || 'impersonate'}] 代登录审计写入失败`, error?.message || error);
			throw new BizError(t('impersonationAuditFail'), 500);
		}
		// 审计只增不删：代登录是敏感操作，历史不因条数上限被覆盖。

		const sessionToken = uuidv4();
		const record = {
			targetUserId: Number(targetUserId),
			targetUser: sessionUserOf(targetRow),
			adminUserId: Number(admin.userId),
			adminEmail: admin.email,
			auditId: Number(auditId) || null,
			startedAt: dayjs().toISOString()
		};
		await c.env.kv.put(KvConst.IMPERSONATE + sessionToken, JSON.stringify(record), { expirationTtl: IMPERSONATE_EXPIRE });

		const jwt = await JwtUtils.generateToken(
			c,
			{ userId: Number(targetUserId), token: sessionToken, gen: constant.AUTH_GEN, imp: 1 },
			IMPERSONATE_EXPIRE
		);
		return { jwt, target: { userId: Number(targetUserId), email: targetRow.email } };
	},

	/** 读取并校验代登录会话（供鉴权中间件使用）。 */
	async resolveSession(c, sessionToken, targetUserId) {
		const record = await c.env.kv.get(KvConst.IMPERSONATE + sessionToken, { type: 'json' });
		if (!record || Number(record.targetUserId) !== Number(targetUserId) || !record.targetUser) return null;
		return record;
	},

	/**
	 * 结束代登录，切回发起的超级管理员。只凭服务器存储的代登录记录确定要切回的管理员身份，
	 * 不接受客户端传入，普通会话无法借此提权。返回管理员会话 JWT。
	 */
	async stop(c) {
		const imp = this.context(c);
		if (!imp) throw new BizError(t('impersonationNotActive'), 400);

		const token = c.get('authToken');
		const payload = await JwtUtils.verifyToken(c, token);
		if (payload?.token) {
			await this.closeAudit(c, imp.auditId);
			await c.env.kv.delete(KvConst.IMPERSONATE + payload.token);
		}

		const adminRow = await userService.selectById(c, imp.adminUserId);
		if (!adminRow || adminRow.isDel === isDel.DELETE || !isSuperAdminEmail(c, adminRow.email)) {
			throw new BizError(t('authExpired'), 401);
		}

		// 为管理员另开一个干净会话（不依赖其原会话是否仍有效）。
		const sessionToken = uuidv4();
		const jwt = await JwtUtils.generateToken(
			c,
			{ userId: adminRow.userId, token: sessionToken, gen: constant.AUTH_GEN },
			constant.TOKEN_EXPIRE
		);
		const sessionUser = sessionUserOf(adminRow);
		let authInfo = await c.env.kv.get(KvConst.AUTH_INFO + adminRow.userId, { type: 'json' });
		if (authInfo?.user?.email?.toLowerCase() === adminRow.email.toLowerCase() && Array.isArray(authInfo.tokens)) {
			authInfo.tokens = authInfo.tokens.filter(item => typeof item === 'string').slice(-9);
			authInfo.tokens.push(sessionToken);
			authInfo.user = sessionUser;
			authInfo.refreshTime = dayjs().toISOString();
		} else {
			authInfo = { tokens: [sessionToken], user: sessionUser, refreshTime: dayjs().toISOString() };
		}
		await c.env.kv.put(KvConst.AUTH_INFO + adminRow.userId, JSON.stringify(authInfo), { expirationTtl: constant.TOKEN_EXPIRE });
		return { jwt, admin: { userId: adminRow.userId, email: adminRow.email } };
	},

	/** 代登录会话主动登出（关闭标签/退出）：关闭审计并删除会话，但不切回管理员。 */
	async endOnLogout(c) {
		const imp = this.context(c);
		if (!imp) return;
		const token = c.get('authToken');
		const payload = await JwtUtils.verifyToken(c, token).catch(() => null);
		await this.closeAudit(c, imp.auditId);
		if (payload?.token) await c.env.kv.delete(KvConst.IMPERSONATE + payload.token);
	},

	async closeAudit(c, auditId) {
		if (!auditId) return;
		await withTable(c, () => c.env.db.prepare(
			`UPDATE impersonation_log SET end_time = CURRENT_TIMESTAMP WHERE id = ? AND end_time IS NULL`
		).bind(auditId).run()).catch(error => {
			console.warn(`[${c.get?.('requestId') || 'impersonate'}] 代登录审计关闭失败`, error?.message || error);
		});
	},

	/** 当前会话的代登录状态，供前端显示横幅。 */
	status(c) {
		const imp = this.context(c);
		if (!imp) return { impersonating: false };
		const user = c.get('user');
		return {
			impersonating: true,
			adminEmail: imp.adminEmail,
			target: { userId: user?.userId, email: user?.email }
		};
	},

	/** 代登录审计列表（仅超级管理员）。 */
	async list(c, params = {}) {
		this.assertSuperAdmin(c);
		const size = toPageSize(params.size, { defaultValue: 20, max: 50 });
		const page = toPageNumber(params.num);
		const email = typeof params.email === 'string' ? params.email.trim().slice(0, 254) : '';
		const conditions = [];
		const binds = [];
		if (email) {
			conditions.push('(admin_email COLLATE NOCASE LIKE ? OR target_email COLLATE NOCASE LIKE ?)');
			const like = email.replace(/[%_]/g, '') + '%';
			binds.push(like, like);
		}
		const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
		const [rows, count] = await withTable(c, () => c.env.db.batch([
			c.env.db.prepare(`
				SELECT id, admin_user_id AS adminUserId, admin_email AS adminEmail, target_user_id AS targetUserId,
					target_email AS targetEmail, ip, start_time AS startTime, end_time AS endTime
				FROM impersonation_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?
			`).bind(...binds, size, (page - 1) * size),
			c.env.db.prepare(`SELECT COUNT(*) AS total FROM impersonation_log ${where}`).bind(...binds)
		]));
		return { list: rows.results || [], total: count.results?.[0]?.total || 0 };
	}
};

export default impersonationService;
