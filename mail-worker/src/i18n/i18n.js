import i18next from 'i18next';
import zh from './zh.js';
import en from './en.js';

const resources = {
	en: { translation: en },
	zh: { translation: zh },
};

// Keep service-layer messages deterministic. User-facing HTTP localization is
// request-scoped in Hono/error-message.js, so concurrent Worker requests cannot
// race on one process-global i18next language setting.
i18next.init({
	lng: 'zh',
	fallbackLng: 'zh',
	resources,
	initImmediate: false,
});

function requestLanguage(c) {
	const raw = String(c?.req?.header?.('accept-language') || '').toLowerCase();
	return raw.startsWith('en') ? 'en' : 'zh';
}

export const t = (key, values) => i18next.getFixedT('zh')(key, values);
export const tForRequest = (c, key, values) => i18next.getFixedT(requestLanguage(c))(key, values);

export default i18next;
