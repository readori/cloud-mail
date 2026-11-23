import { parseHTML } from 'linkedom';
import emailUtils from '../utils/email-utils';

// Telegram limits a message to 4096 characters *after* entity parsing: tags and link
// targets are free, only the visible text counts (UTF-16 code units). Keep headroom.
const TELEGRAM_VISIBLE_LIMIT = 4000;
// Telegram silently drops/refuses messages with too many entities; stay well below.
const MAX_LINKS_PER_MESSAGE = 50;
const MAX_HREF_LENGTH = 2048;
// With a "View" button the full mail is one tap away, so one compact message is enough.
// Without it, allow a few continuation messages instead of dropping most of the body.
const MAX_MESSAGES_WITH_VIEW = 1;
const MAX_MESSAGES_WITHOUT_VIEW = 3;
const CONTINUATION_HEADER = '<b>邮件正文（续）</b>\n\n';
const TRUNCATED_WITH_VIEW = '…\n\n<i>正文较长，已截断，点击下方「View」查看完整邮件</i>';
const TRUNCATED_WITHOUT_VIEW = '…\n\n<i>正文较长，已截断</i>';

const INVISIBLE_CHARS = /[​-‏⁠﻿͏­]/g;
const SKIP_TAGS = new Set([
	'HEAD', 'STYLE', 'SCRIPT', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE',
	'IMG', 'PICTURE', 'SVG', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'IFRAME', 'MAP', 'AREA'
]);
const BLOCK_TAGS = new Set([
	'P', 'DIV', 'TR', 'LI', 'UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'BLOCKQUOTE',
	'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN',
	'NAV', 'ASIDE', 'CENTER', 'PRE', 'HR', 'DL', 'DT', 'DD', 'ADDRESS', 'FIGURE', 'FIGCAPTION'
]);
const CELL_TAGS = new Set(['TD', 'TH']);

export function escapeTelegramHtml(text = '') {
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function escapeAttribute(text = '') {
	return escapeTelegramHtml(text).replace(/"/g, '&quot;');
}

function senderLine(email, tgMsgFrom) {
	if (tgMsgFrom === 'only-name') {
		return `From​：${escapeTelegramHtml(email.name || email.sendEmail || '')}`;
	}
	if (tgMsgFrom === 'show') {
		const name = escapeTelegramHtml(email.name || '');
		const address = escapeTelegramHtml(email.sendEmail || '');
		return `From​：${name}${name && address ? '  ' : ''}${address ? `&lt;${address}&gt;` : ''}`;
	}
	return '';
}

function recipientLine(email, tgMsgTo) {
	if (tgMsgTo !== 'show') return '';
	return `To：​${escapeTelegramHtml(email.toEmail || '')}`;
}

function buildHeader(email, tgMsgTo, tgMsgFrom) {
	const parts = [`<b>${escapeTelegramHtml(email.subject || '(无主题)')}</b>`];
	const from = senderLine(email, tgMsgFrom);
	const to = recipientLine(email, tgMsgTo);
	if (from) parts.push(from);
	if (to) parts.push(to);
	return parts.join('\n');
}

/** Visible length of a Telegram HTML string (what counts against the 4096 limit). */
function visibleLength(html) {
	return String(html || '')
		.replace(/<[^>]*>/g, '')
		.replace(/&(?:lt|gt|amp|quot|#39);/g, '_')
		.length;
}

// ---------------------------------------------------------------------------
// Body → tokens. A token is { t: 'text', v } | { t: 'link', v, href } | { t: 'nl' }.
// ---------------------------------------------------------------------------

function safeHref(value) {
	const href = String(value || '').trim();
	if (!/^https?:\/\//i.test(href) || href.length > MAX_HREF_LENGTH || /[\s<>"]/.test(href)) return '';
	return href;
}

function hostLabel(href) {
	try {
		return new URL(href).hostname.replace(/^www\./i, '') || '链接';
	} catch {
		return '链接';
	}
}

function looksLikeUrl(text) {
	return /^(?:https?:\/\/|www\.)\S+$/i.test(text);
}

function linkToken(href, label) {
	const target = safeHref(href);
	const text = String(label || '').replace(INVISIBLE_CHARS, '').replace(/\s+/g, ' ').trim();
	if (!target) return text ? { t: 'text', v: text } : null;
	return { t: 'link', href: target, v: !text || looksLikeUrl(text) ? hostLabel(target) : text };
}

function isHiddenElement(element) {
	if (element.hasAttribute?.('hidden')) return true;
	const style = String(element.getAttribute?.('style') || '').toLowerCase().replace(/\s+/g, '');
	if (!style) return false;
	if (/display:none|visibility:hidden|mso-hide:all/.test(style)) return true;
	// Preheader tricks: zero-size boxes with clipped overflow, or invisible 0-opacity text.
	if (/(?:max-height|height):0(?:px)?(?:;|$|!)/.test(style) && /overflow:hidden/.test(style)) return true;
	return /opacity:0(?:;|$|!)/.test(style) && /font-size:0|max-height:0|height:0/.test(style);
}

function htmlToTokens(html) {
	const tokens = [];
	let document;
	try {
		const source = /<body[\s>]/i.test(html) ? html : `<!DOCTYPE html><html><body>${html}</body></html>`;
		({ document } = parseHTML(source));
	} catch (error) {
		console.warn('Telegram 正文 HTML 解析失败', error?.message || error);
		return tokens;
	}

	const walk = (node) => {
		if (node.nodeType === 3) {
			tokens.push({ t: 'text', v: node.textContent || '' });
			return;
		}
		if (node.nodeType !== 1) return;
		const tag = String(node.tagName || '').toUpperCase();
		if (SKIP_TAGS.has(tag) || isHiddenElement(node)) return;
		if (tag === 'BR') {
			tokens.push({ t: 'nl' });
			return;
		}
		if (tag === 'A') {
			// Image-only links (logos, social icons, banners) have no text: drop them entirely
			// instead of printing their long tracking URLs.
			const label = String(node.textContent || '').replace(INVISIBLE_CHARS, '').trim();
			if (!label) return;
			const token = linkToken(node.getAttribute('href'), label);
			if (token) tokens.push(token);
			return;
		}
		const block = BLOCK_TAGS.has(tag);
		if (block) tokens.push({ t: 'nl' });
		for (const child of Array.from(node.childNodes || [])) walk(child);
		if (block) tokens.push({ t: 'nl' });
		else if (CELL_TAGS.has(tag)) tokens.push({ t: 'text', v: ' ' });
	};

	walk(document.body || document.documentElement);
	return tokens;
}

// Plain-text parts from newsletter tools render links as "Label (https://…)" or "<https://…>"
// and images as "[image: alt]". Turn URLs into short clickable links.
const PLAIN_URL = /[(<\[]\s*(https?:\/\/[^\s<>()\[\]]+)\s*[)>\]]|(https?:\/\/[^\s<>()\[\]]+)/gi;

function textToTokens(text) {
	const tokens = [];
	const cleaned = String(text || '').replace(/\[(?:image|cid):[^\]]*\]/gi, '');
	for (const [index, line] of cleaned.split(/\r?\n/).entries()) {
		if (index > 0) tokens.push({ t: 'nl' });
		let last = 0;
		for (const match of line.matchAll(PLAIN_URL)) {
			const before = line.slice(last, match.index);
			last = match.index + match[0].length;
			const href = (match[1] || match[2] || '').replace(/[.,;:!?'"]+$/, '');
			const trailing = (match[2] || '').slice(href.length);
			if (match[1] && before.trim()) {
				// "Label (url)": make a short arrow link right after the label.
				tokens.push({ t: 'text', v: before.replace(/\s+$/, '') + ' ' });
				const token = linkToken(href, '↗');
				if (token) tokens.push(token.t === 'link' ? { ...token, v: '↗' } : token);
			} else {
				if (before) tokens.push({ t: 'text', v: before });
				const token = linkToken(href, '');
				if (token) tokens.push(token);
			}
			if (trailing) tokens.push({ t: 'text', v: trailing });
		}
		if (last < line.length) tokens.push({ t: 'text', v: line.slice(last) });
	}
	return tokens;
}

/** Collapse whitespace, trim lines, keep at most one blank line between paragraphs. */
function normalizeTokens(tokens) {
	const lines = [[]];
	for (const token of tokens) {
		if (token.t === 'nl') {
			lines.push([]);
			continue;
		}
		const value = String(token.v || '').replace(INVISIBLE_CHARS, '').replace(/[\s 　]+/g, ' ');
		if (!value) continue;
		const line = lines[lines.length - 1];
		const previous = line[line.length - 1];
		if (token.t === 'text' && previous?.t === 'text') previous.v += value;
		else line.push({ ...token, v: value });
	}

	const result = [];
	let blankPending = false;
	for (const line of lines) {
		// Trim leading/trailing spaces of the line and collapse double spaces at joins.
		const cleaned = [];
		for (const token of line) {
			const previous = cleaned[cleaned.length - 1];
			let value = token.v;
			if (!previous || (previous.t === 'text' && previous.v.endsWith(' '))) value = value.replace(/^ +/, '');
			if (!value) continue;
			cleaned.push({ ...token, v: value });
		}
		while (cleaned.length && cleaned[cleaned.length - 1].t === 'text') {
			const lastToken = cleaned[cleaned.length - 1];
			lastToken.v = lastToken.v.replace(/ +$/, '');
			if (lastToken.v) break;
			cleaned.pop();
		}
		// Separator-only lines (" | ", "·", "—") left behind by removed images carry no content.
		const visible = cleaned.map(token => token.v).join('');
		if (!cleaned.length || (!cleaned.some(token => token.t === 'link') && /^[\s|·•\-–—_*=~]*$/.test(visible))) {
			if (result.length) blankPending = true;
			continue;
		}
		if (result.length) {
			result.push({ t: 'nl' });
			if (blankPending) result.push({ t: 'nl' });
		}
		blankPending = false;
		result.push(...cleaned);
	}
	return result;
}

function bodyTokens(email) {
	// HTML keeps real link labels ("Read more") where the plain-text part only has raw URLs.
	if (email.content) {
		const tokens = normalizeTokens(htmlToTokens(email.content));
		if (tokens.length) return tokens;
	}
	return normalizeTokens(textToTokens(emailUtils.formatText(email.text)));
}

// ---------------------------------------------------------------------------
// Tokens → size-limited Telegram HTML messages.
// ---------------------------------------------------------------------------

function renderToken(token, allowLink) {
	if (token.t === 'nl') return '\n';
	if (token.t === 'link' && allowLink) return `<a href="${escapeAttribute(token.href)}">${escapeTelegramHtml(token.v)}</a>`;
	return escapeTelegramHtml(token.v);
}

function splitText(value, budget) {
	if (value.length <= budget) return [value, ''];
	let cut = value.lastIndexOf(' ', budget);
	if (cut < budget * 0.5) cut = budget;
	// Never split a surrogate pair.
	if (/[\uD800-\uDBFF]/.test(value[cut - 1] || '')) cut -= 1;
	return [value.slice(0, cut).trimEnd(), value.slice(cut).trimStart()];
}

/**
 * Fill up to `maxMessages` messages. Returns { bodies: string[], truncated: boolean }.
 * `budgets[i]` is the visible-character budget of message i.
 */
function packTokens(tokens, budgets) {
	const queue = tokens.map(token => ({ ...token }));
	const bodies = [];
	for (const budget of budgets) {
		if (!queue.length) break;
		let html = '';
		let used = 0;
		let links = 0;
		while (queue.length) {
			const token = queue[0];
			const length = token.t === 'nl' ? 1 : token.v.length;
			if (used + length <= budget) {
				const allowLink = token.t === 'link' && links < MAX_LINKS_PER_MESSAGE;
				if (allowLink) links += 1;
				html += renderToken(token, allowLink);
				used += length;
				queue.shift();
				continue;
			}
			const room = budget - used;
			if (token.t === 'text' && room > 20) {
				const [head, tail] = splitText(token.v, room);
				html += escapeTelegramHtml(head);
				used += head.length;
				token.v = tail;
				if (!tail) queue.shift();
			} else if (token.t === 'link' && !html) {
				queue.shift(); // a single label longer than a whole message: drop it
				continue;
			}
			break;
		}
		while (queue[0]?.t === 'nl') queue.shift();
		bodies.push(html.replace(/\n+$/, ''));
	}
	return { bodies, truncated: queue.length > 0 };
}

/**
 * Build the Telegram HTML message(s) for a received email.
 *
 * The body is rendered compactly: links become short clickable labels instead of raw
 * tracking URLs, images (and image-only links) are dropped, hidden preheaders are skipped.
 * With a "View" button (`hasViewLink`) the result is a single message; otherwise up to
 * three messages, ending with a truncation note when the mail is even longer.
 */
export function buildTelegramEmailMessages(email, tgMsgTo, tgMsgFrom, tgMsgText, options = {}) {
	const header = buildHeader(email, tgMsgTo, tgMsgFrom);
	if (tgMsgText !== 'show') return [header];

	const tokens = bodyTokens(email);
	if (!tokens.length) return [header];

	const hasViewLink = Boolean(options.hasViewLink);
	const maxMessages = hasViewLink ? MAX_MESSAGES_WITH_VIEW : MAX_MESSAGES_WITHOUT_VIEW;
	const note = hasViewLink ? TRUNCATED_WITH_VIEW : TRUNCATED_WITHOUT_VIEW;
	const firstPrefix = `${header}\n\n`;
	const budgets = [];
	for (let index = 0; index < maxMessages; index += 1) {
		const prefix = index === 0 ? firstPrefix : CONTINUATION_HEADER;
		let budget = TELEGRAM_VISIBLE_LIMIT - visibleLength(prefix);
		// The last allowed message keeps room for the truncation note.
		if (index === maxMessages - 1) budget -= visibleLength(note);
		budgets.push(Math.max(1, budget));
	}

	const { bodies, truncated } = packTokens(tokens, budgets);
	if (!bodies.length) return [header];
	const messages = bodies.map((body, index) => `${index === 0 ? firstPrefix : CONTINUATION_HEADER}${body}`);
	if (truncated) messages[messages.length - 1] += note;
	return messages;
}

// Keep the original default export for any downstream code that imports the template
// directly. It returns the first Telegram message only.
export default function emailMsgTemplate(email, tgMsgTo, tgMsgFrom, tgMsgText, options) {
	return buildTelegramEmailMessages(email, tgMsgTo, tgMsgFrom, tgMsgText, options)[0] || '';
}
