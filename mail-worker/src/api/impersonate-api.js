import app from '../hono/hono';
import impersonationService from '../service/impersonation-service';
import result from '../model/result';
import { isWebClient, setWebSession } from '../security/auth-session';

// 超级管理员代登录到目标账号（可随时切回）。start/stop 会切换本会话身份：
// 网页端直接改写会话 Cookie，App 端返回新 token 由客户端替换。
app.post('/impersonate/start', async (c) => {
	const { jwt, target } = await impersonationService.start(c, await c.req.json());
	if (isWebClient(c)) {
		setWebSession(c, jwt);
		return c.json(result.ok({ impersonating: true, target }));
	}
	return c.json(result.ok({ token: jwt, target }));
});

app.post('/impersonate/stop', async (c) => {
	const { jwt, admin } = await impersonationService.stop(c);
	if (isWebClient(c)) {
		setWebSession(c, jwt);
		return c.json(result.ok({ impersonating: false, admin }));
	}
	return c.json(result.ok({ token: jwt, admin }));
});

app.get('/impersonate/status', async (c) => {
	return c.json(result.ok(impersonationService.status(c)));
});

app.get('/impersonate/logs', async (c) => {
	const data = await impersonationService.list(c, c.req.query());
	return c.json(result.ok(data));
});
