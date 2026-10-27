-- 用户登录记录：每次登录成功的 IP / 地区 / 设备，供管理员在后台查看。
CREATE TABLE IF NOT EXISTS login_log (
	log_id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	ip TEXT NOT NULL DEFAULT '',
	country TEXT NOT NULL DEFAULT '',
	city TEXT NOT NULL DEFAULT '',
	os TEXT NOT NULL DEFAULT '',
	browser TEXT NOT NULL DEFAULT '',
	device TEXT NOT NULL DEFAULT '',
	method TEXT NOT NULL DEFAULT 'password',
	create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_log_user ON login_log(user_id, log_id);
