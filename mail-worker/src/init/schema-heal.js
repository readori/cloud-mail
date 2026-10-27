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
