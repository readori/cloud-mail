-- CloudMail Industrial Audit: DB-001 / DB-002
-- Transitional versioned migration for installations upgraded from the legacy POST /init schema.
-- The legacy initializer creates/upgrades tables first; this migration adds strong referential
-- invariants without rebuilding existing D1 tables, preserving Cloud-Mail 3.0.0 upgrade safety.

CREATE TABLE IF NOT EXISTS cloudmail_schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO cloudmail_schema_meta(key, value, updated_at)
VALUES ('integrity_schema', '1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;

-- Refuse to enable integrity triggers over an already-corrupt database. This is intentionally
-- fail-closed: an operator must repair orphan rows instead of a migration silently deleting mail.
CREATE TABLE IF NOT EXISTS _cloudmail_integrity_guard (
  orphan_count INTEGER NOT NULL CHECK(orphan_count = 0)
);
DELETE FROM _cloudmail_integrity_guard;

INSERT INTO _cloudmail_integrity_guard(orphan_count)
SELECT COUNT(*) FROM account a
WHERE NOT EXISTS (SELECT 1 FROM user u WHERE u.user_id = a.user_id);

INSERT INTO _cloudmail_integrity_guard(orphan_count)
SELECT COUNT(*) FROM email e
WHERE NOT EXISTS (SELECT 1 FROM user u WHERE u.user_id = e.user_id)
   OR NOT EXISTS (SELECT 1 FROM account a WHERE a.account_id = e.account_id AND a.user_id = e.user_id);

INSERT INTO _cloudmail_integrity_guard(orphan_count)
SELECT COUNT(*) FROM attachments a
WHERE NOT EXISTS (SELECT 1 FROM user u WHERE u.user_id = a.user_id)
   OR NOT EXISTS (SELECT 1 FROM account ac WHERE ac.account_id = a.account_id AND ac.user_id = a.user_id)
   OR NOT EXISTS (SELECT 1 FROM email e WHERE e.email_id = a.email_id AND e.account_id = a.account_id AND e.user_id = a.user_id);

INSERT INTO _cloudmail_integrity_guard(orphan_count)
SELECT COUNT(*) FROM star s
WHERE NOT EXISTS (SELECT 1 FROM user u WHERE u.user_id = s.user_id)
   OR NOT EXISTS (SELECT 1 FROM email e WHERE e.email_id = s.email_id AND e.user_id = s.user_id);

INSERT INTO _cloudmail_integrity_guard(orphan_count)
SELECT COUNT(*) FROM role_perm rp
WHERE NOT EXISTS (SELECT 1 FROM role r WHERE r.role_id = rp.role_id)
   OR NOT EXISTS (SELECT 1 FROM perm p WHERE p.perm_id = rp.perm_id);

INSERT INTO _cloudmail_integrity_guard(orphan_count)
SELECT COUNT(*) FROM push_subscription ps
WHERE NOT EXISTS (SELECT 1 FROM user u WHERE u.user_id = ps.user_id);

DROP TABLE _cloudmail_integrity_guard;

-- Account ownership.
CREATE TRIGGER IF NOT EXISTS trg_account_user_insert
BEFORE INSERT ON account
WHEN NOT EXISTS (SELECT 1 FROM user u WHERE u.user_id = NEW.user_id)
BEGIN
  SELECT RAISE(ABORT, 'integrity:account.user_id');
END;

CREATE TRIGGER IF NOT EXISTS trg_account_user_update
BEFORE UPDATE OF user_id ON account
WHEN NOT EXISTS (SELECT 1 FROM user u WHERE u.user_id = NEW.user_id)
BEGIN
  SELECT RAISE(ABORT, 'integrity:account.user_id');
END;

-- Every email belongs to an account owned by the same user.
CREATE TRIGGER IF NOT EXISTS trg_email_owner_insert
BEFORE INSERT ON email
WHEN NOT EXISTS (
  SELECT 1 FROM account a
  WHERE a.account_id = NEW.account_id AND a.user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'integrity:email.owner');
END;

CREATE TRIGGER IF NOT EXISTS trg_email_owner_update
BEFORE UPDATE OF account_id, user_id ON email
WHEN NOT EXISTS (
  SELECT 1 FROM account a
  WHERE a.account_id = NEW.account_id AND a.user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'integrity:email.owner');
END;

-- Attachment ownership must agree with the parent email and account.
CREATE TRIGGER IF NOT EXISTS trg_attachment_owner_insert
BEFORE INSERT ON attachments
WHEN NOT EXISTS (
  SELECT 1 FROM email e
  WHERE e.email_id = NEW.email_id
    AND e.account_id = NEW.account_id
    AND e.user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'integrity:attachments.owner');
END;

CREATE TRIGGER IF NOT EXISTS trg_attachment_owner_update
BEFORE UPDATE OF email_id, account_id, user_id ON attachments
WHEN NOT EXISTS (
  SELECT 1 FROM email e
  WHERE e.email_id = NEW.email_id
    AND e.account_id = NEW.account_id
    AND e.user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'integrity:attachments.owner');
END;

-- Stars are user-scoped and may only reference that user's email.
CREATE TRIGGER IF NOT EXISTS trg_star_owner_insert
BEFORE INSERT ON star
WHEN NOT EXISTS (
  SELECT 1 FROM email e WHERE e.email_id = NEW.email_id AND e.user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'integrity:star.owner');
END;

CREATE TRIGGER IF NOT EXISTS trg_star_owner_update
BEFORE UPDATE OF email_id, user_id ON star
WHEN NOT EXISTS (
  SELECT 1 FROM email e WHERE e.email_id = NEW.email_id AND e.user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'integrity:star.owner');
END;

-- RBAC join rows must reference existing role and permission records.
CREATE TRIGGER IF NOT EXISTS trg_role_perm_insert
BEFORE INSERT ON role_perm
WHEN NOT EXISTS (SELECT 1 FROM role r WHERE r.role_id = NEW.role_id)
   OR NOT EXISTS (SELECT 1 FROM perm p WHERE p.perm_id = NEW.perm_id)
BEGIN
  SELECT RAISE(ABORT, 'integrity:role_perm');
END;

CREATE TRIGGER IF NOT EXISTS trg_role_perm_update
BEFORE UPDATE OF role_id, perm_id ON role_perm
WHEN NOT EXISTS (SELECT 1 FROM role r WHERE r.role_id = NEW.role_id)
   OR NOT EXISTS (SELECT 1 FROM perm p WHERE p.perm_id = NEW.perm_id)
BEGIN
  SELECT RAISE(ABORT, 'integrity:role_perm');
END;

-- Push subscriptions are always owned by a real CloudMail user.
CREATE TRIGGER IF NOT EXISTS trg_push_subscription_user_insert
BEFORE INSERT ON push_subscription
WHEN NOT EXISTS (SELECT 1 FROM user u WHERE u.user_id = NEW.user_id)
BEGIN
  SELECT RAISE(ABORT, 'integrity:push_subscription.user_id');
END;

CREATE TRIGGER IF NOT EXISTS trg_push_subscription_user_update
BEFORE UPDATE OF user_id ON push_subscription
WHEN NOT EXISTS (SELECT 1 FROM user u WHERE u.user_id = NEW.user_id)
BEGIN
  SELECT RAISE(ABORT, 'integrity:push_subscription.user_id');
END;

-- Defensive cascade cleanup for the rare physical-delete/admin-maintenance path.
CREATE TRIGGER IF NOT EXISTS trg_email_delete_children
AFTER DELETE ON email
BEGIN
  DELETE FROM attachments WHERE email_id = OLD.email_id;
  DELETE FROM star WHERE email_id = OLD.email_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_account_delete_children
AFTER DELETE ON account
BEGIN
  DELETE FROM email WHERE account_id = OLD.account_id;
  DELETE FROM attachments WHERE account_id = OLD.account_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_user_delete_children
AFTER DELETE ON user
BEGIN
  DELETE FROM push_subscription WHERE user_id = OLD.user_id;
  DELETE FROM star WHERE user_id = OLD.user_id;
END;
