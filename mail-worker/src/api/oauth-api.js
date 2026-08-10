import app from '../hono/hono';
import result from '../model/result';
import oauthService from '../service/oauth-service';
import { isWebClient, setWebSession } from '../security/auth-session';

app.get('/oauth/linuxDo/state', async (c) => {
	return c.json(result.ok(await oauthService.createState(c)));
});

app.post('/oauth/linuxDo/login', async (c) => {
	const data = await oauthService.linuxDoLogin(c, await c.req.json());
	if (isWebClient(c) && data?.token) {
		setWebSession(c, data.token);
		return c.json(result.ok({ ...data, token: undefined, authenticated: true }));
	}
	return c.json(result.ok(data));
});

app.put('/oauth/bindUser', async (c) => {
	const data = await oauthService.bindUser(c, await c.req.json());
	if (isWebClient(c) && data?.token) {
		setWebSession(c, data.token);
		return c.json(result.ok({ ...data, token: undefined, authenticated: true }));
	}
	return c.json(result.ok(data));
});
