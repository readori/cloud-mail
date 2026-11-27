// 上游 v3.4 新增 email.sender_email(信封发件人)。drizzle 查询邮件时会选择全部列，
// 未执行 /init 的旧库缺这一列会导致收件、邮件列表全部报错，因此每个 Worker 实例首次处理请求时
// 检查一次并自动补齐。
let emailSenderColumn = null;

export function ensureEmailSenderColumn(env) {
	if (!env?.db) return Promise.resolve();
	if (!emailSenderColumn) {
		emailSenderColumn = (async () => {
			const { results = [] } = await env.db.prepare('PRAGMA table_info(email)').all();
			if (!results.length || results.some(column => column.name === 'sender_email')) return;
			await env.db.prepare(`ALTER TABLE email ADD COLUMN sender_email TEXT NOT NULL DEFAULT ''`).run();
			console.warn('email 表缺少 sender_email 字段，已自动补齐');
		})().catch(error => {
			if (/duplicate column/i.test(String(error?.message))) return;
			emailSenderColumn = null;
			console.warn(`自动补齐 email.sender_email 失败：${error?.message || error}`);
		});
	}
	return emailSenderColumn;
}

// Cloudflare Email Service 发信：setting.send_provider(发信通道选择)。drizzle 查询设置时选择全部列，
// 未执行 /init 与迁移的旧库缺这一列会导致设置读取报错，处理方式与 sender_email 相同。
let sendProviderColumn = null;

export function ensureSendProviderColumn(env) {
	if (!env?.db) return Promise.resolve();
	if (!sendProviderColumn) {
		sendProviderColumn = (async () => {
			const { results = [] } = await env.db.prepare('PRAGMA table_info(setting)').all();
			if (!results.length || results.some(column => column.name === 'send_provider')) return;
			await env.db.prepare(`ALTER TABLE setting ADD COLUMN send_provider TEXT NOT NULL DEFAULT 'auto'`).run();
			console.warn('setting 表缺少 send_provider 字段，已自动补齐');
		})().catch(error => {
			if (/duplicate column/i.test(String(error?.message))) return;
			sendProviderColumn = null;
			console.warn(`自动补齐 setting.send_provider 失败：${error?.message || error}`);
		});
	}
	return sendProviderColumn;
}
