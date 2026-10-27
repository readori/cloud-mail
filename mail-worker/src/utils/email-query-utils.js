import BizError from '../error/biz-error.js';

function integer(value, {
	name,
	defaultValue,
	required = false,
	min = Number.MIN_SAFE_INTEGER,
	max = Number.MAX_SAFE_INTEGER
}) {
	if (value === undefined || value === null || value === '') {
		if (required && defaultValue === undefined) throw new BizError(`${name}不能为空`, 400);
		return defaultValue;
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
		throw new BizError(`${name}必须是${min}到${max}之间的整数`, 400);
	}
	return parsed;
}

function pageSize(value) {
	return integer(value, { name: 'size', defaultValue: 20, min: 1, max: 50 });
}

function optionalAllReceive(value) {
	if (value === undefined || value === null || value === '') return null;
	return integer(value, { name: 'allReceive', min: 0, max: 1 });
}

function assertAllAccountsScope(accountId, allReceive) {
	if (accountId === 0 && allReceive !== 1) {
		throw new BizError('accountId为0时allReceive必须为1', 400);
	}
}


const SEARCH_TYPES = new Set(['subject', 'content', 'sender', 'senderAddress', 'recipientAddress']);
const SEARCH_DATE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;

function searchDate(value, name) {
	if (value === undefined || value === null || value === '') return '';
	const text = String(value).trim();
	if (!SEARCH_DATE.test(text)) throw new BizError(`${name}格式错误`, 400);
	return text;
}

// 上游 v3.4 邮件搜索：text + searchType(主题/正文/发件人/发件地址/收件地址) + 起止时间(UTC)。
export function normalizeEmailSearch(params = {}) {
	const text = typeof params.text === 'string' ? params.text.trim().slice(0, 200) : '';
	const searchType = SEARCH_TYPES.has(params.searchType) ? params.searchType : 'subject';
	return {
		text,
		searchType,
		startDate: searchDate(params.startDate, 'startDate'),
		endDate: searchDate(params.endDate, 'endDate')
	};
}

// full=1 返回完整字段(含正文与附件)，full=0 只返回列表摘要。默认 1 兼容旧客户端。
export function normalizeFullFlag(value) {
	return integer(value, { name: 'full', defaultValue: 1, min: 0, max: 1 }) === 1;
}

export function normalizeEmailCursor(value, { timeSort = 0, name = 'emailId' } = {}) {
	const sort = integer(timeSort, { name: 'timeSort', defaultValue: 0, min: 0, max: 1 });
	const raw = integer(value, {
		name,
		defaultValue: sort ? 0 : Number.MAX_SAFE_INTEGER,
		min: 0,
		max: Number.MAX_SAFE_INTEGER
	});
	return !sort && raw === 0 ? Number.MAX_SAFE_INTEGER : raw;
}

export function normalizeEmailListQuery(params = {}) {
	const accountId = integer(params.accountId, {
		name: 'accountId', defaultValue: 0, min: 0, max: Number.MAX_SAFE_INTEGER
	});
	const size = pageSize(params.size);
	const timeSort = integer(params.timeSort, { name: 'timeSort', defaultValue: 0, min: 0, max: 1 });
	const type = integer(params.type, { name: 'type', required: true, min: 0, max: 1 });
	const rawEmailId = integer(params.emailId, {
		name: 'emailId',
		defaultValue: timeSort ? 0 : Number.MAX_SAFE_INTEGER,
		min: 0,
		max: Number.MAX_SAFE_INTEGER
	});
	const allReceive = optionalAllReceive(params.allReceive);

	assertAllAccountsScope(accountId, allReceive);

	return {
		accountId,
		size,
		timeSort,
		type,
		// Existing Web and iOS clients historically sent zero for the first
		// descending page. Normalize that sentinel to the newest possible cursor.
		emailId: !timeSort && rawEmailId === 0 ? Number.MAX_SAFE_INTEGER : rawEmailId,
		allReceive,
		full: normalizeFullFlag(params.full)
	};
}

export function normalizeEmailLatestQuery(params = {}) {
	const accountId = integer(params.accountId, {
		name: 'accountId', defaultValue: 0, min: 0, max: Number.MAX_SAFE_INTEGER
	});
	const emailId = integer(params.emailId, {
		name: 'emailId', defaultValue: 0, min: 0, max: Number.MAX_SAFE_INTEGER
	});
	const allReceive = optionalAllReceive(params.allReceive);

	assertAllAccountsScope(accountId, allReceive);
	return { accountId, emailId, allReceive };
}
