import app from '../hono/hono';
import loginService from '../service/login-service';
import result from '../model/result';
import userContext from '../security/user-context';
import { clearWebSession, isWebClient, setWebSession } from '../security/auth-session';
import impersonationService from '../service/impersonation-service';

app.post('/login', async (c) => {
	const token = await loginService.login(c, await c.req.json());
	if (isWebClient(c)) {
		setWebSession(c, token);
		return c.json(result.ok({ authenticated: true }));
	}
	return c.json(result.ok({ token }));
});

app.post('/register', async (c) => {
	const jwt = await loginService.register(c, await c.req.json());
	return c.json(result.ok(jwt));
});

app.delete('/logout', async (c) => {
	// 代登录会话登出：只关闭审计并丢弃代登录会话，不动目标账号的真实登录。
	if (impersonationService.context(c)) {
		await impersonationService.endOnLogout(c);
	} else {
		await loginService.logout(c, userContext.getUserId(c));
	}
	clearWebSession(c);
	return c.json(result.ok());
});

