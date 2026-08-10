-- DB-002 follow-up: complete the defensive delete chain for physical user deletion.
-- Rebuild this trigger because 0001 installations may already have the earlier version.
DROP TRIGGER IF EXISTS trg_user_delete_children;

CREATE TRIGGER trg_user_delete_children
AFTER DELETE ON user
BEGIN
  -- Account deletion invokes trg_account_delete_children, which deletes email rows;
  -- email deletion invokes trg_email_delete_children, which cleans attachments/stars.
  DELETE FROM account WHERE user_id = OLD.user_id;
  DELETE FROM push_subscription WHERE user_id = OLD.user_id;
  DELETE FROM star WHERE user_id = OLD.user_id;
END;

INSERT INTO cloudmail_schema_meta(key, value, updated_at)
VALUES ('integrity_schema', '2', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;
