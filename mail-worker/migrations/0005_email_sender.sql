-- 上游 cloud-mail v3.4：信封发件人(SMTP MAIL FROM)，用于显示代发地址。
--
-- email.sender_email 由 Worker 自行补齐，不在版本化迁移里 ALTER：
--   * src/init/schema-heal.js 在每个 Worker 实例首次处理请求/收信时按 PRAGMA 检查并补列；
--   * POST /api/init 的 v4_0DB 同样会补列(部署工作流先执行 /init 再执行迁移)。
-- SQLite 不支持 ADD COLUMN IF NOT EXISTS，这里若直接 ALTER，已被上述两处补过列的库会以
-- "duplicate column name: sender_email" 失败并阻断整个部署。因此本迁移只记录结构版本，可重复执行。
INSERT INTO cloudmail_schema_meta(key, value, updated_at)
VALUES ('email_sender_column', 'worker-managed', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;
