import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import r2Service from './service/r2-service';
import oauthService from './service/oauth-service';
import analysisService from './service/analysis-service';
import rateLimitService from './service/rate-limit-service';
import openAPIDocument from './openapi/openapi-document.js';
import { ensureEmailSenderColumn, ensureSendProviderColumn } from './init/schema-heal';
import { handleWsUpgrade } from './websocket/connect';
import proxyService from './service/proxy-service';
// 上游 v3.6 实时推送：Durable Object 类必须从 Worker 入口导出。
export { MailHub } from './websocket/hub';

const STATIC_CSP = [
	"default-src 'self'",
	"script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com 'sha256-RKMhCLDgTYD4/HYfFHKXddSqp4T+xAfDlTF0H0usmRc=' 'sha256-YKCI7TEVF8Jc7uPKAQygTs29yN4Wr+08KdjLSsshMmE='",
	"style-src 'self' 'unsafe-inline'",
	"font-src 'self' data:",
	"img-src 'self' data: blob: https:",
	"connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com https://api.iconify.design https://api.unisvg.com https://api.simplesvg.com",
	"frame-src https://challenges.cloudflare.com",
	"object-src 'none'",
	"base-uri 'none'",
	"frame-ancestors 'none'",
	"form-action 'self'"
].join('; ');

function secureStaticResponse(response, url) {
	const headers = new Headers(response.headers);
	// 网页端实时推送连接同源 /realtime；旧版 Safari 的 connect-src 'self' 不包含 wss，显式放行本站。
	const wsOrigin = url ? `${url.protocol === 'http:' ? 'ws' : 'wss'}://${url.host}` : '';
	headers.set('Content-Security-Policy', wsOrigin ? STATIC_CSP.replace("connect-src 'self'", `connect-src 'self' ${wsOrigin}`) : STATIC_CSP);
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Referrer-Policy', 'no-referrer');
	headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function runScheduledTasks(tasks) {
	const results = await Promise.allSettled(tasks.map(task => task()));
	for (const result of results) {
		if (result.status === 'rejected') console.error('定时任务执行失败', result.reason?.stack || result.reason?.message || result.reason);
	}
}

export default {
	async fetch(req, env, ctx) {
		const url = new URL(req.url);
		const requestPath = url.pathname;
		// 上游 v3.6：网页端实时新邮件推送(WebSocket → MailHub Durable Object)
		if (requestPath === '/realtime') {
			return handleWsUpgrade(req, env);
		}
		// 上游 v3.6：邮件外链图片经本站代理(校验签名后由 Worker 代拉)，不暴露阅读者 IP
		if (requestPath === '/proxy') {
			return proxyService.fetchImage(env, url.searchParams);
		}
		if (requestPath === '/api/openapi.json' || requestPath === '/api/v1/openapi.json') {
			return Response.json(openAPIDocument, { headers: { 'Cache-Control': 'public, max-age=300', 'X-CloudMail-API-Version': '1' } });
		}
		const isAPIRequest = requestPath === '/api' || requestPath.startsWith('/api/');
		if (requestPath === '/api/v1') url.pathname = '/';
		else if (requestPath.startsWith('/api/v1/')) url.pathname = requestPath.slice('/api/v1'.length);
		else if (requestPath === '/api') url.pathname = '/';
		else if (requestPath.startsWith('/api/')) url.pathname = requestPath.slice('/api'.length);
		if (isAPIRequest) {
			await ensureEmailSenderColumn(env);
			await ensureSendProviderColumn(env);
			req = new Request(url.toString(), req);
			const response = await app.fetch(req, env, ctx);
			const headers = new Headers(response.headers);
			headers.set('X-CloudMail-API-Version', '1');
			return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
		}
		// 上游 v3.4：移除对象存储访问域名后，附件统一经本站代理(KV/R2/S3)，兼容 /oss/ 前缀
		if (url.pathname.startsWith('/oss/')) {
			return r2Service.response({ env }, url.pathname.slice('/oss/'.length));
		}
		if (['/static/', '/attachments/'].some(prefix => url.pathname.startsWith(prefix))) {
			return r2Service.response({ env }, url.pathname.substring(1));
		}
		return secureStaticResponse(await env.assets.fetch(req), url);
	},

	email,

	async scheduled(controller, env, ctx) {
		await ensureEmailSenderColumn(env);
		await ensureSendProviderColumn(env);
		if (controller.cron === '*/30 * * * *') {
			ctx.waitUntil(runScheduledTasks([() => analysisService.refreshEchartsCache({ env })]));
			return;
		}
		ctx.waitUntil(runScheduledTasks([
			() => verifyRecordService.clearRecord({ env }),
			() => userService.resetDaySendCount({ env }),
			() => emailService.completeReceiveAll({ env }),
			() => oauthService.clearNoBindOathUser({ env }),
			() => analysisService.refreshEchartsCache({ env }),
			() => rateLimitService.cleanup({ env }),
			() => emailService.cleanupRetention({ env }),
			() => emailService.autoClean({ env })
		]));
	}
};
