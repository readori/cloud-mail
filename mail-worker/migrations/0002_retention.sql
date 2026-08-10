-- Retention metadata for privacy-safe, configurable Trash cleanup.
ALTER TABLE email ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_email_retention_deleted_at
ON email(is_del, deleted_at);

CREATE TRIGGER IF NOT EXISTS trg_email_soft_delete_timestamp
AFTER UPDATE OF is_del ON email
WHEN NEW.is_del = 1 AND OLD.is_del <> 1
BEGIN
  UPDATE email SET deleted_at = CURRENT_TIMESTAMP WHERE email_id = NEW.email_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_email_restore_clear_timestamp
AFTER UPDATE OF is_del ON email
WHEN NEW.is_del = 0 AND OLD.is_del <> 0
BEGIN
  UPDATE email SET deleted_at = NULL WHERE email_id = NEW.email_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_email_insert_deleted_timestamp
AFTER INSERT ON email
WHEN NEW.is_del = 1 AND NEW.deleted_at IS NULL
BEGIN
  UPDATE email SET deleted_at = CURRENT_TIMESTAMP WHERE email_id = NEW.email_id;
END;
