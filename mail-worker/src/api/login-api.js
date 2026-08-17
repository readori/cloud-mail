import app from '../hono/hono';
import loginService from '../service/login-service';
import result from '../model/result';
import userContext from '../security/user-context';
import { clearWebSession, isWebClient, setWebSession } from '../security/auth-session';

app.post('/login', async (c) => {
	const body = await c.req.json();
	if (isWebClient(c)) {
		const token = await loginService.login(c, body);
		setWebSession(c, token);
		return c.json(result.ok({ authenticated: true }));
	}
	const session = await loginService.login(c, body, false, true);
	return c.json(result.ok(session));
});

app.post('/refresh', async (c) => {
	const session = await loginService.refresh(c, await c.req.json());
	return c.json(result.ok(session));
});

app.post('/register', async (c) => {
	const jwt = await loginService.register(c, await c.req.json());
	return c.json(result.ok(jwt));
});

app.delete('/logout', async (c) => {
	await loginService.logout(c, userContext.getUserId(c));
	clearWebSession(c);
	return c.json(result.ok());
});

