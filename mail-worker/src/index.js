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

const STATIC_CSP = [
	"default-src 'self'",
	"script-src 'self' https://challenges.cloudflare.com 'sha256-9akFwN7T458ofhT9Ict5/2wwvSE9wFPMwRoVnR27QDc='",
	"style-src 'self' 'unsafe-inline'",
	"font-src 'self' data:",
	"img-src 'self' data: blob: https:",
	"connect-src 'self' https://challenges.cloudflare.com https://api.iconify.design https://api.unisvg.com https://api.simplesvg.com",
	"frame-src https://challenges.cloudflare.com",
	"object-src 'none'",
	"base-uri 'none'",
	"frame-ancestors 'none'",
	"form-action 'self'"
].join('; ');

function secureStaticResponse(response) {
	const headers = new Headers(response.headers);
	headers.set('Content-Security-Policy', STATIC_CSP);
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
		if (requestPath === '/api/openapi.json' || requestPath === '/api/v1/openapi.json') {
			return Response.json(openAPIDocument, { headers: { 'Cache-Control': 'public, max-age=300', 'X-CloudMail-API-Version': '1' } });
		}
		const isAPIRequest = requestPath === '/api' || requestPath.startsWith('/api/');
		if (requestPath === '/api/v1') url.pathname = '/';
		else if (requestPath.startsWith('/api/v1/')) url.pathname = requestPath.slice('/api/v1'.length);
		else if (requestPath === '/api') url.pathname = '/';
		else if (requestPath.startsWith('/api/')) url.pathname = requestPath.slice('/api'.length);
		if (isAPIRequest) {
			req = new Request(url.toString(), req);
			const response = await app.fetch(req, env, ctx);
			const headers = new Headers(response.headers);
			headers.set('X-CloudMail-API-Version', '1');
			return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
		}
		if (['/static/', '/attachments/'].some(prefix => url.pathname.startsWith(prefix))) {
			return r2Service.response({ env }, url.pathname.substring(1));
		}
		return secureStaticResponse(await env.assets.fetch(req));
	},

	email,

	async scheduled(controller, env, ctx) {
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
			() => emailService.cleanupRetention({ env })
		]));
	}
};
