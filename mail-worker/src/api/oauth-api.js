import app from '../hono/hono';
import result from '../model/result';
import oauthService from '../service/oauth-service';
import { isWebClient, setWebSession } from '../security/auth-session';

function loginResponse(c, data) {
	if (isWebClient(c) && data?.token) {
		setWebSession(c, data.token);
		return c.json(result.ok({ ...data, token: undefined, authenticated: true }));
	}
	return c.json(result.ok(data));
}

app.get('/oauth/state', async (c) => {
	return c.json(result.ok(await oauthService.createState(c, c.req.query('provider'))));
});

app.get('/oauth/linuxDo/state', async (c) => {
	return c.json(result.ok(await oauthService.createState(c, 'linuxdo')));
});

app.post('/oauth/linuxDo/login', async (c) => {
	return loginResponse(c, await oauthService.linuxDoLogin(c, await c.req.json()));
});

app.post('/oauth/github/login', async (c) => {
	return loginResponse(c, await oauthService.githubLogin(c, await c.req.json()));
});

app.post('/oauth/google/login', async (c) => {
	return loginResponse(c, await oauthService.googleLogin(c, await c.req.json()));
});

app.put('/oauth/bindUser', async (c) => {
	return loginResponse(c, await oauthService.bindUser(c, await c.req.json()));
});
