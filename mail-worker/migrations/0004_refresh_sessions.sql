-- Long-lived native-client session renewal without storing passwords or plaintext refresh tokens.
-- Refresh credentials are opaque on the client and represented only by SHA-256 hashes in D1.
CREATE TABLE IF NOT EXISTS refresh_session (
  refresh_hash TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL,
  session_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_session_user
  ON refresh_session(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_session_session
  ON refresh_session(user_id, session_token);

-- Historical CloudMail schemas did not always declare FK relationships. This trigger keeps
-- refresh credentials from surviving a physical user deletion even on those installations.
CREATE TRIGGER IF NOT EXISTS trg_refresh_session_user_delete
AFTER DELETE ON user
BEGIN
  DELETE FROM refresh_session WHERE user_id = OLD.user_id;
END;
