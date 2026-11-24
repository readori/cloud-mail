import { describe, expect, it } from 'vitest';
import { buildTelegramEmailMessages } from '../src/template/email-msg';
import { isEmbeddedBodyImage } from '../src/service/telegram-service';
import { telegramPlainText } from '../src/utils/telegram-utils';

const TRACK = 'https://d2Rl2304.na1.hubspotlinks.com/Ctc/DP+113/d2Rl2304/' + 'W'.repeat(600);

function visible(html) {
	return html.replace(/<[^>]*>/g, '').replace(/&(?:lt|gt|amp|quot);/g, '_');
}

function newsletterHtml(paragraphs = 3) {
	const body = Array.from({ length: paragraphs }, (_, i) =>
		`<p>Paragraph ${i + 1} with a <a href="${TRACK}">Read more</a> link.</p>`).join('');
	return `<html><head><style>p{color:red}</style></head><body>
		<div style="display:none;max-height:0;overflow:hidden">Hidden preheader text</div>
		<a href="${TRACK}"><img src="https://cdn.example.com/logo.png" alt="Logo"></a>
		${body}
		<table><tr>
			<td><a href="${TRACK}"><img src="https://cdn.example.com/x.png"></a></td>
			<td> | </td>
			<td><a href="${TRACK}">LinkedIn</a></td>
			<td><a href="${TRACK}">YouTube</a></td>
		</tr></table>
		<p>This email was sent to someone. <a href="${TRACK}">Unsubscribe</a> <a href="https://example.com/prefs?x=1&amp;y=2">Manage Preferences</a></p>
	</body></html>`;
}

const base = { subject: 'News', name: 'Sender', sendEmail: 's@example.com', toEmail: 'r@example.com' };

describe('Telegram email message', () => {
	it('renders links as short clickable labels and drops images, raw URLs and hidden preheaders', () => {
		const messages = buildTelegramEmailMessages({ ...base, content: newsletterHtml(), text: `Read (${TRACK})` }, 'show', 'show', 'show', { hasViewLink: true });
		expect(messages).toHaveLength(1);
		const [message] = messages;
		expect(message).toContain(`<a href="${TRACK}">Read more</a>`);
		expect(message).toContain('>LinkedIn</a>');
		expect(message).toContain('<a href="https://example.com/prefs?x=1&amp;y=2">Manage Preferences</a>');
		expect(visible(message)).not.toMatch(/https?:\/\//);
		expect(message).not.toContain('logo.png');
		// Image-only links (logo, social icons) are dropped, not shown as a hostname.
		expect(message).not.toContain('hubspotlinks.com</a>');
		expect(message).not.toContain('Hidden preheader');
		expect(message).not.toMatch(/\n\s*\|\s*\n/);
		expect(message).not.toMatch(/\n{3,}/);
	});

	it('keeps one message with a View button and marks truncation', () => {
		const messages = buildTelegramEmailMessages({ ...base, content: newsletterHtml(400) }, 'hide', 'show', 'show', { hasViewLink: true });
		expect(messages).toHaveLength(1);
		expect(visible(messages[0]).length).toBeLessThanOrEqual(4096);
		expect(messages[0]).toContain('「View」');
		expect((messages[0].match(/<a /g) || []).length).toBeLessThanOrEqual(50);
	});

	it('uses at most three messages without a View button', () => {
		const messages = buildTelegramEmailMessages({ ...base, content: newsletterHtml(800) }, 'hide', 'show', 'show', { hasViewLink: false });
		expect(messages).toHaveLength(3);
		for (const message of messages) expect(visible(message).length).toBeLessThanOrEqual(4096);
		expect(messages[1].startsWith('<b>邮件正文（续）</b>')).toBe(true);
		expect(messages[2]).toContain('已截断');
	});

	it('short mail is a single message without a truncation note', () => {
		const messages = buildTelegramEmailMessages({ ...base, content: '<p>Hello,&nbsp;</p><p>Thanks</p>' }, 'hide', 'show', 'show', { hasViewLink: false });
		expect(messages).toEqual([`<b>News</b>\nFrom​：Sender  &lt;s@example.com&gt;\n\nHello,\n\nThanks`]);
	});

	it('shortens URLs in plain-text-only mail', () => {
		const text = `LinkedIn (${TRACK})\n(${TRACK})\n[image: Logo]\nSee https://example.com/a. Thanks <b>`;
		const [message] = buildTelegramEmailMessages({ ...base, text }, 'hide', 'hide', 'show', { hasViewLink: true });
		expect(message).toContain(`LinkedIn <a href="${TRACK}">↗</a>`);
		expect(message).toContain('<a href="https://example.com/a">example.com</a>. Thanks &lt;b&gt;');
		expect(message).not.toContain('[image');
		expect(visible(message)).not.toMatch(/https?:\/\//);
	});

	it('shortens URLs printed as text inside an HTML body', () => {
		const support = 'https://engagecenter.microsoft.com/#view/Microsoft_AzureCXP_EngageHub/EngageHubMenu.MenuView/targetExperience/sfb/sapId/bc9d4067';
		const content = `<p>Your OTP: 297324</p><p>Need assistance? Contact Support&lt;${support}&gt;</p><p>Docs: https://learn.microsoft.com/a</p>`;
		const [message] = buildTelegramEmailMessages({ ...base, content }, 'hide', 'hide', 'show', { hasViewLink: true });
		expect(message).toContain(`Contact Support <a href="${support}">↗</a>`);
		expect(message).toContain('Docs: <a href="https://learn.microsoft.com/a">learn.microsoft.com</a>');
		expect(visible(message)).not.toMatch(/https?:\/\//);
		expect(message).toContain('297324');
	});

	it('plain-text fallback keeps link labels, not URLs', () => {
		expect(telegramPlainText(`<b>S</b>\n<a href="${TRACK}">Read more</a> &amp; <i>x</i>`)).toBe('S\nRead more & x');
	});

	it('does not forward body-embedded images as separate documents', () => {
		const html = '<img src="https://r2.example.com/attachments/abc.png">';
		expect(isEmbeddedBodyImage({ contentId: 'x', key: 'attachments/abc.png' }, html)).toBe(true);
		expect(isEmbeddedBodyImage({ contentId: 'x', key: 'attachments/other.png' }, html)).toBe(false);
		expect(isEmbeddedBodyImage({ contentId: null, key: 'attachments/abc.png' }, html)).toBe(false);
	});
});
