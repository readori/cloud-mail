const base = String(process.env.CLOUDMAIL_HEALTH_URL || '').replace(/\/$/, '');
if (!base) throw new Error('CLOUDMAIL_HEALTH_URL is required');
const response = await fetch(`${base}/api/health`, { headers: { Accept: 'application/json' } });
if (!response.ok) throw new Error(`health HTTP ${response.status}`);
const body = await response.json();
if (body?.status !== 'ok' || body?.ready !== true) throw new Error(`service not ready: ${JSON.stringify(body?.checks || {})}`);
console.log('CloudMail health ready:', body.checks);
