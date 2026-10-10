const FETCH_TIMEOUT = 10_000;
const MAX_RETRY = 10;

// 只允许推送到公网 HTTP(S) 地址，避免把邮件内容投递到内网服务
function resolveWebhookUrl(value) {
	const raw = String(value || '').trim();
	if (!raw) return null;
	let url;
	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
	} catch {
		return null;
	}
	if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
	const host = url.hostname.toLowerCase();
	if (!host || host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '[::1]' || host === '::1' ||
		/^127\./.test(host) || /^169\.254\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
		return null;
	}
	return url.toString();
}

const webhookService = {

	async sendEmail(c, emailRow, webhookUrl, retry = 0, webhookSecret) {

		const url = resolveWebhookUrl(webhookUrl);

		if (!url) {
			console.warn('Webhook 地址无效，已跳过推送');
			return;
		}

		retry = Math.min(Math.max(Number(retry) || 0, 0), MAX_RETRY);

		const headers = {
			'Content-Type': 'application/json'
		};

		if (webhookSecret) {
			headers['Authorization'] = webhookSecret;
		}

		const body = JSON.stringify({
			emailId: emailRow.emailId,
			sendEmail: emailRow.sendEmail,
			sendName: emailRow.name,
			toEmail: emailRow.toEmail,
			toName: emailRow.toName,
			subject: emailRow.subject,
			text: emailRow.text,
			content: emailRow.content,
			code: emailRow.code,
			createTime: emailRow.createTime
		});

		let lastError = '';

		for (let i = 0; i <= retry; i++) {
			try {
				const res = await fetch(url, {
					method: 'POST',
					headers,
					body,
					redirect: 'manual',
					signal: AbortSignal.timeout(FETCH_TIMEOUT)
				});

				if (res.ok) {
					return;
				}

				lastError = `status: ${res.status} response: ${(await res.text()).slice(0, 500)}`;
			} catch (e) {
				lastError = e.message;
			}
		}

		console.error(`Webhook 推送失败: ${lastError}`);
	}

};

export default webhookService;
