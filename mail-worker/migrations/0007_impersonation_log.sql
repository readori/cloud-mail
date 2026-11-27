-- 超级管理员代登录审计：记录“哪个管理员在何时代登录了哪个账号、何时结束”，仅超级管理员可见。
-- 代登录期间的日常收发不额外记录，这里只保留这一条可追溯记录。
-- CREATE TABLE IF NOT EXISTS 幂等，可重复执行；旧部署也会由 /init 与服务首次用到时自动补建。
CREATE TABLE IF NOT EXISTS impersonation_log (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	admin_user_id INTEGER NOT NULL,
	admin_email TEXT NOT NULL DEFAULT '',
	target_user_id INTEGER NOT NULL,
	target_email TEXT NOT NULL DEFAULT '',
	ip TEXT NOT NULL DEFAULT '',
	start_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
	end_time DATETIME
);
CREATE INDEX IF NOT EXISTS idx_impersonation_admin ON impersonation_log(admin_user_id, id);
