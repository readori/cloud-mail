-- Cloud-Mail upstream 3.1 compatibility marker.
-- The protected POST /api/init compatibility bridge adds setting.sync_delete when absent
-- before repository migrations run. This SQL intentionally does not ALTER the column so
-- importing an existing upstream 3.1 database (where the column already exists) remains safe.
INSERT INTO cloudmail_schema_meta(key, value, updated_at)
VALUES ('upstream_cloud_mail', '3.1.0', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;
