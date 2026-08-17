#!/usr/bin/env python3
"""DB-001/DB-002 migration matrix using SQLite-compatible D1 SQL.

Fixtures represent three supported legacy schema ages. The migration must apply cleanly,
refuse new orphan rows, preserve valid rows, and provide defensive physical-delete cleanup.
"""
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = [(p.name, p.read_text(encoding='utf-8')) for p in sorted((ROOT / 'migrations').glob('*.sql'))]

BASE = '''
CREATE TABLE user (user_id INTEGER PRIMARY KEY, email TEXT NOT NULL);
CREATE TABLE account (account_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, email TEXT NOT NULL);
CREATE TABLE email (email_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, account_id INTEGER NOT NULL, subject TEXT, is_del INTEGER NOT NULL DEFAULT 0);
CREATE TABLE attachments (att_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, account_id INTEGER NOT NULL, email_id INTEGER NOT NULL, key TEXT NOT NULL);
CREATE TABLE star (star_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, email_id INTEGER NOT NULL);
CREATE TABLE role (role_id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE perm (perm_id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE role_perm (id INTEGER PRIMARY KEY, role_id INTEGER, perm_id INTEGER);
CREATE TABLE push_subscription (push_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, subscription_id TEXT NOT NULL);
CREATE TABLE setting (register INTEGER NOT NULL DEFAULT 0);
INSERT INTO setting(register) VALUES (0);
'''

FIXTURES = {
    'legacy-3.0': BASE,
    'gateway-3.5': BASE + 'CREATE UNIQUE INDEX idx_ps ON push_subscription(user_id, subscription_id);\n',
    'hardened-3.8': BASE + 'CREATE TABLE rate_limit_bucket(bucket_key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);\n',
    'upstream-3.1': BASE.replace("CREATE TABLE setting (register INTEGER NOT NULL DEFAULT 0);", "CREATE TABLE setting (register INTEGER NOT NULL DEFAULT 0, sync_delete INTEGER NOT NULL DEFAULT 0);"),
}


def apply_upstream_compatibility_bridge(db: sqlite3.Connection) -> None:
    columns = {row[1] for row in db.execute("PRAGMA table_info('setting')")}
    if 'sync_delete' not in columns:
        db.execute('ALTER TABLE setting ADD COLUMN sync_delete INTEGER NOT NULL DEFAULT 1')

def seed(db: sqlite3.Connection) -> None:
    db.executescript('''
    INSERT INTO user VALUES (1, 'u@example.com');
    INSERT INTO account VALUES (10, 1, 'u@example.com');
    INSERT INTO email VALUES (100, 1, 10, 'hello', 0);
    INSERT INTO attachments VALUES (1000, 1, 10, 100, 'attachments/x');
    INSERT INTO star VALUES (2000, 1, 100);
    INSERT INTO role VALUES (2, 'user');
    INSERT INTO perm VALUES (3, 'read');
    INSERT INTO role_perm VALUES (4, 2, 3);
    INSERT INTO push_subscription VALUES (5, 1, 'ps_fixture');
    ''')


def must_abort(db: sqlite3.Connection, sql: str, expected: str) -> None:
    try:
        db.execute(sql)
    except sqlite3.IntegrityError as exc:
        if expected not in str(exc):
            raise AssertionError(f'expected {expected!r}, got {exc!r}') from exc
    else:
        raise AssertionError(f'orphan write unexpectedly succeeded: {sql}')


def run_fixture(name: str, schema: str) -> None:
    db = sqlite3.connect(':memory:')
    db.executescript(schema)
    seed(db)
    apply_upstream_compatibility_bridge(db)
    for _, migration in MIGRATIONS:
        db.executescript(migration)
    assert db.execute("SELECT value FROM cloudmail_schema_meta WHERE key='integrity_schema'").fetchone()[0] == '2'
    expected_sync_delete = 0 if name == 'upstream-3.1' else 1
    assert db.execute("SELECT sync_delete FROM setting").fetchone()[0] == expected_sync_delete
    assert db.execute("SELECT value FROM cloudmail_schema_meta WHERE key='upstream_cloud_mail'").fetchone()[0] == '3.1.0'

    must_abort(db, "INSERT INTO account VALUES (11, 999, 'bad@example.com')", 'integrity:account.user_id')
    must_abort(db, "INSERT INTO email(email_id,user_id,account_id,subject,is_del) VALUES (101, 1, 999, 'bad', 0)", 'integrity:email.owner')
    must_abort(db, "INSERT INTO attachments VALUES (1001, 1, 10, 999, 'attachments/bad')", 'integrity:attachments.owner')
    must_abort(db, "INSERT INTO star VALUES (2001, 999, 100)", 'integrity:star.owner')
    must_abort(db, "INSERT INTO role_perm VALUES (5, 999, 3)", 'integrity:role_perm')
    must_abort(db, "INSERT INTO push_subscription VALUES (6, 999, 'ps_bad')", 'integrity:push_subscription.user_id')

    # Valid writes remain possible.
    db.execute("INSERT INTO email(email_id,user_id,account_id,subject,is_del) VALUES (101, 1, 10, 'valid', 0)")
    db.execute("INSERT INTO attachments VALUES (1001, 1, 10, 101, 'attachments/valid')")
    db.execute("INSERT INTO star VALUES (2001, 1, 101)")

    # Defensive child cleanup on physical email deletion.
    db.execute('DELETE FROM email WHERE email_id=101')
    assert db.execute('SELECT COUNT(*) FROM attachments WHERE email_id=101').fetchone()[0] == 0
    assert db.execute('SELECT COUNT(*) FROM star WHERE email_id=101').fetchone()[0] == 0

    # Refresh credentials are hash-only and must follow user deletion on every historical schema.
    db.execute("INSERT INTO refresh_session(refresh_hash,user_id,session_token,expires_at,created_at) VALUES ('hash_fixture',1,'session_fixture',9999999999,1)")
    # Physical user deletion must not leave account/email/attachment/star/push/session orphans.
    db.execute('DELETE FROM user WHERE user_id=1')
    for table in ('account','email','attachments','star','push_subscription','refresh_session'):
        assert db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0, table
    db.close()
    print(f'  PASS {name}')


def corrupt_fixture_must_fail() -> None:
    db = sqlite3.connect(':memory:')
    db.executescript(BASE)
    seed(db)
    apply_upstream_compatibility_bridge(db)
    db.execute("INSERT INTO account VALUES (99, 999, 'orphan@example.com')")
    try:
        for _, migration in MIGRATIONS:
            db.executescript(migration)
    except sqlite3.IntegrityError:
        print('  PASS corrupt-preflight-fails-closed')
        return
    raise AssertionError('migration silently accepted pre-existing orphan data')

for name, schema in FIXTURES.items():
    run_fixture(name, schema)
corrupt_fixture_must_fail()
print('✅ D1 versioned migration + referential invariant matrix PASS')
