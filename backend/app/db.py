from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from . import config


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
  verified INTEGER NOT NULL DEFAULT 1, password_hash TEXT NOT NULL, created_at TEXT NOT NULL,
  daily_cloud_calls INTEGER, frozen INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS auth_limits (
  action TEXT NOT NULL, client_key TEXT NOT NULL, window INTEGER NOT NULL,
  attempts INTEGER NOT NULL, PRIMARY KEY(action,client_key,window)
);
CREATE TABLE IF NOT EXISTS cloud_daily (
  day TEXT NOT NULL, subject TEXT NOT NULL, calls INTEGER NOT NULL CHECK(calls>=0),
  PRIMARY KEY(day,subject)
);
CREATE TABLE IF NOT EXISTS libraries (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS library_members (
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', PRIMARY KEY (library_id, user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'personal', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_summaries (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '', through_message_id TEXT,
  updated_at TEXT, lease_id TEXT, lease_until REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS session_documents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL, size INTEGER NOT NULL, chunks_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_documents_session ON session_documents(session_id);
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunks_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_images (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL, mime TEXT NOT NULL, image BLOB NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_images_session ON session_images(session_id);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), scope TEXT NOT NULL,
  original TEXT NOT NULL, intent TEXT NOT NULL DEFAULT '', entities_json TEXT NOT NULL DEFAULT '[]',
  constraints_json TEXT NOT NULL DEFAULT '[]', current_version_id TEXT, freshness_kind TEXT NOT NULL DEFAULT 'stable',
  source TEXT, source_version TEXT, last_checked_at TEXT, review_at TEXT, review_interval_days INTEGER,
  route_tool TEXT, status TEXT NOT NULL DEFAULT 'active', hits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS group_versions (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  n INTEGER NOT NULL, answer TEXT NOT NULL, basis TEXT NOT NULL, by_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'published', created_at TEXT NOT NULL, UNIQUE(group_id, n)
);
CREATE TABLE IF NOT EXISTS aliases (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  text TEXT NOT NULL, text_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', reason TEXT,
  source TEXT NOT NULL DEFAULT 'generated', created_at TEXT NOT NULL, UNIQUE(group_id, text_key)
);
CREATE TABLE IF NOT EXISTS alias_suggestions (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  by_user_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL, text_key TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
  reply TEXT, handled_by TEXT, handled_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alias_suggestions_pending ON alias_suggestions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_alias_suggestions_group ON alias_suggestions(group_id, status);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', base_url TEXT NOT NULL,
  model TEXT NOT NULL, api_key TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id, created_at);
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES group_versions(id) ON DELETE CASCADE,
  style TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'published', by_user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, source TEXT, group_id TEXT, version_id TEXT,
  matched_alias TEXT, match_type TEXT, cloud_calls INTEGER NOT NULL DEFAULT 0,
  first_token_ms INTEGER NOT NULL DEFAULT 0, total_ms INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'done', meta_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, by_user_id TEXT NOT NULL REFERENCES users(id), group_id TEXT NOT NULL REFERENCES groups(id),
  target_key TEXT NOT NULL, type TEXT NOT NULL, version_id TEXT, match_key TEXT,
  category TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT, handled_by TEXT, handled_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS answer_reports (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  by_user_id TEXT NOT NULL REFERENCES users(id), category TEXT NOT NULL, note TEXT NOT NULL,
  question TEXT NOT NULL, answer TEXT NOT NULL, created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', resolution TEXT, reply TEXT, handled_by TEXT, handled_at TEXT,
  UNIQUE(message_id, by_user_id, category)
);
CREATE TABLE IF NOT EXISTS suspensions (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), kind TEXT NOT NULL,
  match_key TEXT, version_id TEXT, status TEXT NOT NULL DEFAULT 'active', since TEXT NOT NULL,
  reason TEXT NOT NULL, report_ids_json TEXT NOT NULL DEFAULT '[]', resolved_by TEXT, resolution TEXT, released_at TEXT
);
CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), base_version_id TEXT,
  proposed_answer TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', by_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending', handled_by TEXT, handled_at TEXT, published_version_id TEXT,
  created_at TEXT NOT NULL, source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL, source_version TEXT
);
CREATE TABLE IF NOT EXISTS source_checks (
  source TEXT NOT NULL, source_version TEXT NOT NULL, checked_at TEXT NOT NULL, observed_version TEXT,
  answer TEXT, lease_id TEXT, lease_until REAL NOT NULL DEFAULT 0, PRIMARY KEY (source, source_version)
);
CREATE TABLE IF NOT EXISTS shared_submissions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  group_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL,
  handled_by TEXT REFERENCES users(id),
  handled_at TEXT,
  shared_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_submissions_pending
  ON shared_submissions(group_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_shared_submissions_queue ON shared_submissions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_shared_submissions_group ON shared_submissions(group_id, created_at DESC);
CREATE TABLE IF NOT EXISTS learn_tasks (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TEXT NOT NULL, finished_at TEXT, ready_at REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL, query TEXT NOT NULL, path TEXT NOT NULL,
  cloud_calls INTEGER NOT NULL DEFAULT 0, first_token_ms INTEGER NOT NULL DEFAULT 0,
  total_ms INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1, reported INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS work_rules (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(owner_id, name)
);
CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai', threshold REAL NOT NULL DEFAULT 0.70,
  auto_learn INTEGER NOT NULL DEFAULT 1, default_scope TEXT NOT NULL DEFAULT 'personal',
  max_context_turns INTEGER NOT NULL DEFAULT 3, pause_threshold INTEGER NOT NULL DEFAULT 3,
  pause_window_days INTEGER NOT NULL DEFAULT 7,
  session_summary_enabled INTEGER NOT NULL DEFAULT 1,
  personal_memory_enabled INTEGER NOT NULL DEFAULT 0,
  disabled_models TEXT NOT NULL DEFAULT '[]',
  font_scale INTEGER NOT NULL DEFAULT 100,
  auto_alias INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS personal_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_personal_memories_user ON personal_memories(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_owner_updated ON sessions(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_aliases_key ON aliases(text_key);
CREATE INDEX IF NOT EXISTS idx_groups_review ON groups(review_at) WHERE status='active' AND review_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_groups_scope_updated ON groups(scope, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_groups_owner_updated ON groups(owner_id, scope, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_reports_group ON reports(group_id);
CREATE INDEX IF NOT EXISTS idx_reports_target_time ON reports(target_key, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage(user_id, at);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def connect() -> sqlite3.Connection:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(config.DB_PATH, timeout=15, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA busy_timeout=15000")
    return connection


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    db = connect()
    try:
        db.execute("BEGIN IMMEDIATE")
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def initialize() -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    db = connect()
    try:
        db.executescript(SCHEMA)
        with db:
            db.execute("BEGIN IMMEDIATE")
            if "ready_at" not in {row["name"] for row in db.execute("PRAGMA table_info(learn_tasks)")}:
                db.execute("ALTER TABLE learn_tasks ADD COLUMN ready_at REAL NOT NULL DEFAULT 0")
            if "model" not in {row["name"] for row in db.execute("PRAGMA table_info(usage)")}:
                db.execute("ALTER TABLE usage ADD COLUMN model TEXT")
            revision_columns = {row["name"] for row in db.execute("PRAGMA table_info(revisions)")}
            if "source_message_id" not in revision_columns:
                db.execute("ALTER TABLE revisions ADD COLUMN source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL")
            if "source_version" not in revision_columns:
                db.execute("ALTER TABLE revisions ADD COLUMN source_version TEXT")
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_revisions_message ON revisions(source_message_id)")
            check_columns = {row["name"] for row in db.execute("PRAGMA table_info(source_checks)")}
            if "lease_id" not in check_columns:
                db.execute("ALTER TABLE source_checks ADD COLUMN lease_id TEXT")
            if "lease_until" not in check_columns:
                db.execute("ALTER TABLE source_checks ADD COLUMN lease_until REAL NOT NULL DEFAULT 0")
            setting_columns = {row["name"] for row in db.execute("PRAGMA table_info(settings)")}
            if "session_summary_enabled" not in setting_columns:
                db.execute("ALTER TABLE settings ADD COLUMN session_summary_enabled INTEGER NOT NULL DEFAULT 1")
            if "personal_memory_enabled" not in setting_columns:
                db.execute("ALTER TABLE settings ADD COLUMN personal_memory_enabled INTEGER NOT NULL DEFAULT 0")
            if "disabled_models" not in setting_columns:
                db.execute("ALTER TABLE settings ADD COLUMN disabled_models TEXT NOT NULL DEFAULT '[]'")
            if "font_scale" not in setting_columns:
                db.execute("ALTER TABLE settings ADD COLUMN font_scale INTEGER NOT NULL DEFAULT 100")
            if "auto_alias" not in setting_columns:
                db.execute("ALTER TABLE settings ADD COLUMN auto_alias INTEGER NOT NULL DEFAULT 1")
            report_columns = {row["name"] for row in db.execute("PRAGMA table_info(reports)")}
            if "reply" not in report_columns:
                db.execute("ALTER TABLE reports ADD COLUMN reply TEXT")
            answer_columns = {row["name"] for row in db.execute("PRAGMA table_info(answer_reports)")}
            for column, ddl in (("status", "TEXT NOT NULL DEFAULT 'open'"), ("resolution", "TEXT"),
                                ("reply", "TEXT"), ("handled_by", "TEXT"), ("handled_at", "TEXT")):
                if column not in answer_columns:
                    db.execute(f"ALTER TABLE answer_reports ADD COLUMN {column} {ddl}")
            user_columns = {row["name"] for row in db.execute("PRAGMA table_info(users)")}
            if "daily_cloud_calls" not in user_columns:
                db.execute("ALTER TABLE users ADD COLUMN daily_cloud_calls INTEGER")
            if "frozen" not in user_columns:
                db.execute("ALTER TABLE users ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0")
        db.commit()
        if config.DEMO_MODE:
            _seed_demo(db)
        db.commit()
    finally:
        db.close()


def _seed_demo(db: sqlite3.Connection) -> None:
    from .auth import hash_password

    timestamp = now_iso()
    demo_users = [
        ("u-a", "用户 A", "admin", "demo1234"),
        ("u-b", "用户 B", "member", "demo1234"),
        ("u-c", "用户 C", "member", "demo1234"),
    ]
    db.execute("INSERT OR IGNORE INTO libraries(id,name,created_at) VALUES(?,?,?)", ("QS-2048", "柒柿共享库", timestamp))
    for user_id, name, role, password in demo_users:
        created = db.execute(
            "INSERT OR IGNORE INTO users(id,name,role,verified,password_hash,created_at) VALUES(?,?,?,?,?,?)",
            (user_id, name, role, 1, hash_password(password), timestamp),
        ).rowcount
        db.execute("INSERT OR IGNORE INTO settings(user_id) VALUES(?)", (user_id,))
        if created:
            db.execute("INSERT INTO library_members(library_id,user_id,role) VALUES('QS-2048',?,?)", (user_id, role))

    if not config.DEMO_SEED_PATH:
        return
    seed_path = Path(config.DEMO_SEED_PATH)
    records = json.loads(seed_path.read_text(encoding="utf-8"))
    for item in records:
        if db.execute("SELECT 1 FROM groups WHERE id=?", (item["id"],)).fetchone():
            continue
        version_id = f"{item['id']}:v1"
        db.execute(
            """INSERT INTO groups(id,owner_id,scope,original,intent,entities_json,constraints_json,
               current_version_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (item["id"], "u-a", item["scope"], item["original"], item["intent"],
             json.dumps(item["entities"], ensure_ascii=False), json.dumps(item["constraints"], ensure_ascii=False),
             version_id, timestamp, timestamp),
        )
        db.execute(
            "INSERT INTO group_versions(id,group_id,n,answer,basis,by_user_id,created_at) VALUES(?,?,?,?,?,?,?)",
            (version_id, item["id"], 1, item["answer"], "演示知识样例", "u-a", timestamp),
        )
        alias_values = [item["original"], *item["aliases"]]
        for index, text in enumerate(alias_values):
            key = "".join(char.lower() for char in text if char.isalnum())
            db.execute(
                "INSERT OR IGNORE INTO aliases(id,group_id,text,text_key,source,created_at) VALUES(?,?,?,?,?,?)",
                (f"{item['id']}:alias:{index}", item["id"], text, key, "seed", timestamp),
            )
        for variant_index, item_variant in enumerate(item.get("variants", [])):
            db.execute(
                "INSERT OR IGNORE INTO variants(id,group_id,version_id,style,text,status,by_user_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
                (f"{item['id']}:variant:{variant_index}", item["id"], version_id, item_variant["style"],
                 item_variant["text"], "published", "u-a", timestamp),
            )


def as_json(value: str | None, fallback: Any = None) -> Any:
    if value is None:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback
