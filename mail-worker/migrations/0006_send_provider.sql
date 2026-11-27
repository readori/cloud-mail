-- Cloudflare Email Service 发信：发信通道选择 setting.send_provider ('auto' | 'cloudflare' | 'resend')。
--
-- setting.send_provider 由 Worker 自行补齐，不在版本化迁移里 ALTER(与 0005_email_sender.sql 相同的原因)：
--   * src/init/schema-heal.js 在每个 Worker 实例首次处理请求/收信时按 PRAGMA 检查并补列；
--   * POST /api/init 的 v4_2DB 同样会补列(部署工作流先执行 /init 再执行迁移)。
-- SQLite 不支持 ADD COLUMN IF NOT EXISTS，直接 ALTER 会让已补过列的库以 "duplicate column name" 失败，
-- 因此本迁移只记录结构版本，可重复执行。
INSERT INTO cloudmail_schema_meta(key, value, updated_at)
VALUES ('send_provider_column', 'worker-managed', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;
