import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

// 发信通道选择与 Cloudflare Email Service 错误处理(纯逻辑，便于单元测试)。
export const SEND_PROVIDERS = ['auto', 'cloudflare', 'resend'];
export const DEFAULT_SEND_PROVIDER = 'auto';

export function normalizeSendProvider(value) {
	return SEND_PROVIDERS.includes(value) ? value : DEFAULT_SEND_PROVIDER;
}

// Cloudflare 错误码 → i18n key 与 HTTP 状态：配置/校验/收件人类 400，限流/额度 429，其余 502。
export const CF_EMAIL_ERRORS = {
	E_SENDER_NOT_VERIFIED: { key: 'cfSenderNotVerified', status: 400 },
	E_SENDER_DOMAIN_NOT_AVAILABLE: { key: 'cfSenderDomainNotAvailable', status: 400 },
	E_RECIPIENT_NOT_ALLOWED: { key: 'cfRecipientNotAllowed', status: 400 },
	E_RECIPIENT_PLAN_RESTRICTED: { key: 'cfRecipientPlanRestricted', status: 400 },
	E_RECIPIENT_SUPPRESSED: { key: 'cfRecipientSuppressed', status: 400 },
	E_RATE_LIMIT_EXCEEDED: { key: 'cfRateLimitExceeded', status: 429 },
	E_DAILY_LIMIT_EXCEEDED: { key: 'cfDailyLimitExceeded', status: 429 },
	E_CONTENT_TOO_LARGE: { key: 'cfContentTooLarge', status: 400 },
	E_VALIDATION_ERROR: { key: 'cfValidationError', status: 400 },
	E_INTERNAL_SERVER_ERROR: { key: 'cfInternalError', status: 502 }
};

// auto 模式回退规则：binding 的 send() 抛错表示邮件未被接受(成功会返回 messageId)，重试不会重复投递。
// 带结构化 E_ 错误码的错误一律允许回退到 Resend，唯独 E_INTERNAL_SERVER_ERROR(服务端状态不确定)除外；
// 没有错误码的错误(网络/超时，结果不明确)与 BizError 都不回退。
export const CF_NO_FALLBACK_CODES = new Set(['E_INTERNAL_SERVER_ERROR']);

const CODE_REGEX = /\bE_[A-Z0-9_]+\b/;

export function extractCfEmailErrorCode(error) {
	const direct = error?.code;
	if (typeof direct === 'string' && /^E_[A-Z0-9_]+$/.test(direct)) return direct;
	const match = CODE_REGEX.exec(String(error?.message || ''));
	return match ? match[0] : '';
}

export function shouldFallbackToResend(error) {
	if (error instanceof BizError) return false;
	const code = extractCfEmailErrorCode(error);
	return !!code && !CF_NO_FALLBACK_CODES.has(code);
}

// 把 Cloudflare 抛出的错误转换为面向用户的 BizError(保留原始错误码)。已经是 BizError 的原样返回。
export function mapCfEmailError(error) {
	if (error instanceof BizError) return error;
	const code = extractCfEmailErrorCode(error);
	const known = CF_EMAIL_ERRORS[code];
	if (known) return new BizError(`${t(known.key)} (${code})`, known.status);
	console.error(`Cloudflare Email 发信失败(未识别错误)：${error?.message || error}`);
	const raw = String(error?.message || '').replace(/\s+/g, ' ').trim().slice(0, 120);
	const head = code ? `${t('cfEmailSendFailed')} (${code})` : t('cfEmailSendFailed');
	return new BizError(raw ? `${head}: ${raw}` : head, 502);
}

// 解析发信通道。返回 { provider: 'cloudflare'|'resend', fallbackToken, error }，error 为 i18n key。
// allInternal(全部站内收件人)不需要外部通道，由调用方保持站内投递路径。
export function resolveSendPlan({ mode, hasBinding, resendToken, allInternal = false }) {
	const selected = normalizeSendProvider(mode);
	if (selected === 'cloudflare') {
		if (!hasBinding && !allInternal) return { provider: 'cloudflare', fallbackToken: '', error: 'cfEmailNotBound' };
		return { provider: 'cloudflare', fallbackToken: '', error: '' };
	}
	if (selected === 'resend') {
		if (!resendToken && !allInternal) return { provider: 'resend', fallbackToken: '', error: 'noSendProvider' };
		return { provider: 'resend', fallbackToken: '', error: '' };
	}
	if (hasBinding) return { provider: 'cloudflare', fallbackToken: resendToken || '', error: '' };
	if (resendToken || allInternal) return { provider: 'resend', fallbackToken: '', error: '' };
	return { provider: 'resend', fallbackToken: '', error: 'noSendProvider' };
}
