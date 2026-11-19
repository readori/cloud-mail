const constant = {
	TOKEN_HEADER: 'Authorization',
	JWT_UID: 'user_id:',
	JWT_TOKEN: 'token:',
	TOKEN_EXPIRE: 60 * 60 * 24 * 30,
	// 上游 v3.6：提高此数字可使所有已签发的登录令牌失效。旧令牌没有 gen 字段，按 1 处理。
	AUTH_GEN: 1,
	ATTACHMENT_PREFIX: 'attachments/',
	BACKGROUND_PREFIX: 'static/background/',
	ADMIN_ROLE: {
		name: 'admin',
		sendCount: 0,
		sendType: 'count',
		accountCount: 0
	}
}

export default constant
