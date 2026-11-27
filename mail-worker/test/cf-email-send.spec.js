import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import BizError from '../src/error/biz-error';
import { localizeErrorMessage } from '../src/i18n/error-message';
import settingService from '../src/service/setting-service';
import emailService from '../src/service/email-service';
import {
	CF_EMAIL_ERRORS,
	extractCfEmailErrorCode,
	mapCfEmailError,
	resolveSendPlan,
	shouldFallbackToResend
} from '../src/service/send-provider';
import en from '../src/i18n/en';
import zh from '../src/i18n/zh';

const cfError = (code, message) => Object.assign(new Error(message || `send failed ${code}`), { code });

describe('Cloudflare Email error extraction and mapping', () => {
	it('reads the code from err.code or from the message', () => {
		expect(extractCfEmailErrorCode({ code: 'E_RATE_LIMIT_EXCEEDED', message: 'x' })).toBe('E_RATE_LIMIT_EXCEEDED');
		expect(extractCfEmailErrorCode(new Error('email.send() failed: E_SENDER_NOT_VERIFIED: nope'))).toBe('E_SENDER_NOT_VERIFIED');
		// numeric / non E_ codes are ignored, message regex wins
		expect(extractCfEmailErrorCode({ code: 500, message: 'boom E_VALIDATION_ERROR' })).toBe('E_VALIDATION_ERROR');
		expect(extractCfEmailErrorCode(new Error('plain failure'))).toBe('');
		expect(extractCfEmailErrorCode(null)).toBe('');
	});

	it('maps every known code to a localized BizError with the right status', () => {
		for (const [code, { key, status }] of Object.entries(CF_EMAIL_ERRORS)) {
			expect(typeof zh[key]).toBe('string');
			expect(typeof en[key]).toBe('string');
			const mapped = mapCfEmailError(cfError(code));
			expect(mapped).toBeInstanceOf(BizError);
			expect(mapped.code).toBe(status);
			expect(mapped.message).toBe(`${zh[key]} (${code})`);
		}
		expect(mapCfEmailError(cfError('E_RATE_LIMIT_EXCEEDED')).code).toBe(429);
		expect(mapCfEmailError(cfError('E_DAILY_LIMIT_EXCEEDED')).code).toBe(429);
		expect(mapCfEmailError(cfError('E_INTERNAL_SERVER_ERROR')).code).toBe(502);
		expect(mapCfEmailError(cfError('E_RECIPIENT_SUPPRESSED')).code).toBe(400);
	});

	it('maps unknown errors to the generic failure with 502 and keeps code + short raw message', () => {
		const mapped = mapCfEmailError(cfError('E_SOMETHING_NEW', 'x'.repeat(500)));
		expect(mapped.code).toBe(502);
		expect(mapped.message.startsWith(`${zh.cfEmailSendFailed} (E_SOMETHING_NEW): `)).toBe(true);
		expect(mapped.message.length).toBeLessThan(200);
		expect(mapCfEmailError(new Error('network down')).message).toBe(`${zh.cfEmailSendFailed}: network down`);
		const biz = new BizError('already', 400);
		expect(mapCfEmailError(biz)).toBe(biz);
	});

	it('localizes mapped messages to English without leaking Chinese', () => {
		const c = { req: { header: () => 'en-US' } };
		const known = mapCfEmailError(cfError('E_SENDER_NOT_VERIFIED'));
		expect(localizeErrorMessage(c, known.message, known.code)).toBe(`${en.cfSenderNotVerified} (E_SENDER_NOT_VERIFIED)`);
		const unknown = mapCfEmailError(cfError('E_SOMETHING_NEW', 'raw detail'));
		expect(localizeErrorMessage(c, unknown.message, unknown.code)).toBe(`${en.cfEmailSendFailed} (E_SOMETHING_NEW): raw detail`);
		expect(localizeErrorMessage(c, zh.cfEmailNotBound, 400)).toBe(en.cfEmailNotBound);
	});
});

describe('fallback decision and provider resolution', () => {
	it('falls back for any structured E_ code except E_INTERNAL_SERVER_ERROR', () => {
		for (const code of ['E_SENDER_NOT_VERIFIED', 'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_RECIPIENT_PLAN_RESTRICTED', 'E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED', 'E_FOO']) {
			expect(shouldFallbackToResend(cfError(code))).toBe(true);
		}
		expect(shouldFallbackToResend(new Error('boom E_UNKNOWN_THING'))).toBe(true);
		expect(shouldFallbackToResend(cfError('E_INTERNAL_SERVER_ERROR'))).toBe(false);
		expect(shouldFallbackToResend(new Error('network timeout'))).toBe(false);
		expect(shouldFallbackToResend(new BizError('x', 400))).toBe(false);
	});

	it('resolves the provider per mode', () => {
		expect(resolveSendPlan({ mode: 'cloudflare', hasBinding: false, resendToken: 'rk' }).error).toBe('cfEmailNotBound');
		expect(resolveSendPlan({ mode: 'cloudflare', hasBinding: true, resendToken: 'rk' })).toMatchObject({ provider: 'cloudflare', fallbackToken: '', error: '' });
		// resend mode ignores the binding
		expect(resolveSendPlan({ mode: 'resend', hasBinding: true, resendToken: 'rk' })).toMatchObject({ provider: 'resend', error: '' });
		expect(resolveSendPlan({ mode: 'resend', hasBinding: true, resendToken: '' }).error).toBe('noSendProvider');
		expect(resolveSendPlan({ mode: 'auto', hasBinding: true, resendToken: 'rk' })).toMatchObject({ provider: 'cloudflare', fallbackToken: 'rk', error: '' });
		expect(resolveSendPlan({ mode: 'auto', hasBinding: true, resendToken: '' })).toMatchObject({ provider: 'cloudflare', fallbackToken: '' });
		expect(resolveSendPlan({ mode: 'auto', hasBinding: false, resendToken: 'rk' })).toMatchObject({ provider: 'resend', error: '' });
		expect(resolveSendPlan({ mode: 'auto', hasBinding: false, resendToken: '' }).error).toBe('noSendProvider');
		// unknown stored value behaves as auto; all-internal never needs an external provider
		expect(resolveSendPlan({ mode: 'bogus', hasBinding: false, resendToken: 'rk' }).provider).toBe('resend');
		expect(resolveSendPlan({ mode: 'cloudflare', hasBinding: false, allInternal: true }).error).toBe('');
	});
});

describe('emailService.dispatchByProvider', () => {
	afterEach(() => vi.restoreAllMocks());
	const params = { name: 'N', accountEmail: 'a@example.com', subject: 's', text: 't', html: '', attachments: [], receiveEmail: ['x@gmail.com'], cc: [], bcc: [], sendType: 'send' };
	const cloudflarePlan = { provider: 'cloudflare', fallbackToken: 'rk', error: '' };

	it('sends through the binding and reports the message id', async () => {
		const send = vi.fn(async () => ({ messageId: 'cf-1' }));
		const result = await emailService.dispatchByProvider({ env: { email: { send } } }, params, cloudflarePlan, 'rk');
		expect(result).toEqual({ id: 'cf-1', provider: 'cloudflare', fallback: false });
		expect(send.mock.calls[0][0]).toMatchObject({ from: { email: 'a@example.com', name: 'N' }, to: ['x@gmail.com'], subject: 's' });
	});

	it('auto mode retries via Resend for sender/domain errors', async () => {
		const resend = vi.spyOn(emailService, 'sendByResend').mockResolvedValue({ data: { id: 're-1' }, error: null });
		const send = vi.fn(async () => { throw cfError('E_SENDER_NOT_VERIFIED'); });
		const result = await emailService.dispatchByProvider({ env: { email: { send } } }, params, cloudflarePlan, 'rk');
		expect(result).toEqual({ id: 're-1', provider: 'resend', fallback: true });
		expect(resend).toHaveBeenCalledWith('rk', params);
	});

	it('auto mode also falls back on plan-restricted / rate-limit / unknown codes', async () => {
		const resend = vi.spyOn(emailService, 'sendByResend').mockResolvedValue({ data: { id: 're-9' }, error: null });
		for (const code of ['E_RECIPIENT_PLAN_RESTRICTED', 'E_RATE_LIMIT_EXCEEDED', 'E_FOO']) {
			const c = { env: { email: { send: async () => { throw cfError(code); } } } };
			expect(await emailService.dispatchByProvider(c, params, cloudflarePlan, 'rk')).toMatchObject({ provider: 'resend', fallback: true });
		}
		expect(resend).toHaveBeenCalledTimes(3);
	});

	it('reports both errors (502) when the Resend fallback also fails', async () => {
		const c = { env: { email: { send: async () => { throw cfError('E_SENDER_NOT_VERIFIED'); } } } };
		vi.spyOn(emailService, 'sendByResend').mockResolvedValueOnce({ data: null, error: { message: 'resend says no' } });
		await expect(emailService.dispatchByProvider(c, params, cloudflarePlan, 'rk')).rejects
			.toMatchObject({ code: 502, message: 'resend says no (Cloudflare: E_SENDER_NOT_VERIFIED)' });
		vi.spyOn(emailService, 'sendByResend').mockRejectedValueOnce(new Error('resend threw'));
		await expect(emailService.dispatchByProvider(c, params, cloudflarePlan, 'rk')).rejects
			.toMatchObject({ code: 502, message: 'resend threw (Cloudflare: E_SENDER_NOT_VERIFIED)' });
	});

	it('does not fall back on internal errors, uncoded errors, or without a Resend token', async () => {
		const resend = vi.spyOn(emailService, 'sendByResend').mockResolvedValue({ data: { id: 're-1' }, error: null });
		const limited = { env: { email: { send: async () => { throw cfError('E_INTERNAL_SERVER_ERROR'); } } } };
		await expect(emailService.dispatchByProvider(limited, params, cloudflarePlan, 'rk')).rejects.toMatchObject({ code: 502 });
		const noCode = { env: { email: { send: async () => { throw new Error('network timeout'); } } } };
		await expect(emailService.dispatchByProvider(noCode, params, cloudflarePlan, 'rk')).rejects.toMatchObject({ code: 502 });
		const unverified = { env: { email: { send: async () => { throw cfError('E_SENDER_NOT_VERIFIED'); } } } };
		await expect(emailService.dispatchByProvider(unverified, params, { ...cloudflarePlan, fallbackToken: '' }, '')).rejects.toMatchObject({ code: 400 });
		// explicit cloudflare mode never has a fallback token
		await expect(emailService.dispatchByProvider(unverified, params, { provider: 'cloudflare', fallbackToken: '', error: '' }, 'rk')).rejects.toBeInstanceOf(BizError);
		expect(resend).not.toHaveBeenCalled();
	});

	it('resend mode never touches the binding', async () => {
		const send = vi.fn();
		vi.spyOn(emailService, 'sendByResend').mockResolvedValue({ data: { id: 're-2' }, error: null });
		const result = await emailService.dispatchByProvider({ env: { email: { send } } }, params, { provider: 'resend', fallbackToken: '', error: '' }, 'rk');
		expect(result).toEqual({ id: 're-2', provider: 'resend', fallback: false });
		expect(send).not.toHaveBeenCalled();
	});
});

describe('sendProvider setting and testSend', () => {
	afterEach(() => vi.restoreAllMocks());

	async function initDb() {
		const init = await SELF.fetch('http://example.com/api/init', { method: 'POST', headers: { 'X-Init-Secret': env.init_secret } });
		expect(init.status).toBe(200);
		return { env, set() {}, get() {}, req: { header: () => '' } };
	}

	it('defaults to auto and validates the enum on set', async () => {
		const c = await initDb();
		expect((await settingService.query(c)).sendProvider).toBe('auto');
		await expect(settingService.set(c, { sendProvider: 'smtp' })).rejects.toMatchObject({ code: 400 });
		await expect(settingService.set(c, { sendProvider: 5 })).rejects.toMatchObject({ code: 400 });
		await settingService.set(c, { sendProvider: 'cloudflare' });
		expect((await settingService.query({ ...c, get: () => undefined })).sendProvider).toBe('cloudflare');
		const shown = await settingService.get({ ...c, get: () => undefined });
		expect(shown.sendProvider).toBe('cloudflare');
		expect(shown.hasCfEmail).toBe(false);
		await settingService.set(c, { sendProvider: 'resend' });
		expect((await settingService.query({ ...c, get: () => undefined })).sendProvider).toBe('resend');
	});

	it('testSend: cloudflare mode without binding -> cfEmailNotBound, resend mode ignores the binding', async () => {
		const base = await initDb();
		await settingService.set(base, { sendProvider: 'cloudflare' });
		const noBinding = { ...base, get: () => undefined, env: { ...env } };
		await expect(emailService.testSend(noBinding, { to: 'user@gmail.com' })).rejects.toMatchObject({ code: 400, message: zh.cfEmailNotBound });

		await settingService.set(base, { sendProvider: 'resend' });
		const send = vi.fn(async () => ({ messageId: 'cf-x' }));
		const withBinding = { ...base, get: () => undefined, env: { ...env, email: { send } } };
		// resend mode, no token configured -> noSendProvider, binding untouched
		await expect(emailService.testSend(withBinding, { to: 'user@gmail.com' })).rejects.toMatchObject({ message: zh.noSendProvider });
		expect(send).not.toHaveBeenCalled();
	});

	it('testSend: validates input, sends via binding, and falls back to Resend in auto mode', async () => {
		const base = await initDb();
		await settingService.set(base, { sendProvider: 'auto' });
		const send = vi.fn(async () => ({ messageId: 'cf-ok' }));
		const c = { ...base, get: () => undefined, env: { ...env, email: { send }, rate_limit_disabled: 'true' } };
		await expect(emailService.testSend(c, { to: 'not-an-email' })).rejects.toMatchObject({ code: 400 });
		await expect(emailService.testSend(c, { to: 'user@gmail.com', from: 'x@other.test' })).rejects.toMatchObject({ code: 400 });
		await expect(emailService.testSend(c, { to: 'user@gmail.com', provider: 'smtp' })).rejects.toMatchObject({ code: 400 });
		// on a configured domain but not an existing account -> rejected
		await expect(emailService.testSend(c, { to: 'user@gmail.com', from: 'someone@example.com' })).rejects.toMatchObject({ code: 400 });
		expect(send).not.toHaveBeenCalled();

		const ok = await emailService.testSend(c, { to: 'user@gmail.com' });
		expect(ok).toEqual({ provider: 'cloudflare', messageId: 'cf-ok', fallback: false });
		// default sender = env.admin (domain is configured)
		expect(send.mock.calls[0][0].from.email).toBe('admin@example.com');

		await settingService.set(base, { resendTokens: { 'example.com': 're_test_token_123456' } });
		const failing = vi.fn(async () => { throw cfError('E_SENDER_DOMAIN_NOT_AVAILABLE'); });
		vi.spyOn(emailService, 'sendByResend').mockResolvedValue({ data: { id: 're-fb' }, error: null });
		const fb = await emailService.testSend({ ...c, env: { ...c.env, email: { send: failing } } }, { to: 'user@gmail.com', from: 'noreply@example.com' });
		expect(fb).toEqual({ provider: 'resend', messageId: 're-fb', fallback: true });
		// forced cloudflare never falls back
		await expect(emailService.testSend({ ...c, env: { ...c.env, email: { send: failing } } }, { to: 'user@gmail.com', provider: 'cloudflare' }))
			.rejects.toMatchObject({ code: 400 });
	});
});
