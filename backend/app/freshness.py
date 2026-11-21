from __future__ import annotations

import json
import time
from datetime import datetime, timedelta
from pathlib import Path

from . import config
from .db import now_iso, transaction
from .engine import uid
from .sources import github_release


def next_review_at(checked_at: str, interval_days: int | None) -> str:
    return (datetime.fromisoformat(checked_at) + timedelta(days=max(1, interval_days or 1))).isoformat(timespec="milliseconds")


def read_source(source: str) -> tuple[str | None, str | None]:
    if source.startswith("github-release:"):
        return github_release(source.removeprefix("github-release:"))
    if not config.SOURCE_CATALOG:
        return None, None
    try:
        entry = json.loads(Path(config.SOURCE_CATALOG).read_text(encoding="utf-8"))[source]
        version, answer = entry["version"], entry["answer"]
        if isinstance(version, str) and version.strip() and isinstance(answer, str) and 0 < len(answer.strip()) <= 12000:
            return version.strip(), answer.strip()
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None, None


def _check_source(source: str, base_version: str, due: str) -> tuple[str | None, str | None]:
    deadline = time.monotonic() + 8
    key = (source, base_version)
    while time.monotonic() < deadline:
        lease_id = None
        with transaction() as db:
            row = db.execute("SELECT * FROM source_checks WHERE source=? AND source_version=?", key).fetchone()
            now = time.time()
            recent = (datetime.fromisoformat(now_iso()) - timedelta(minutes=5)).isoformat(timespec="milliseconds")
            if row and row["checked_at"] >= max(due, recent):
                return row["observed_version"], row["answer"]
            if not row or row["lease_until"] <= now:
                lease_id = uid("check")
                db.execute(
                    """INSERT INTO source_checks(source,source_version,checked_at,lease_id,lease_until) VALUES(?,?,'',?,?)
                       ON CONFLICT(source,source_version) DO UPDATE SET
                       lease_id=excluded.lease_id,lease_until=excluded.lease_until""", (*key, lease_id, now + 15),
                )
        if lease_id:
            version, answer = read_source(source)
            with transaction() as db:
                stored = db.execute(
                    """UPDATE source_checks SET checked_at=?,observed_version=?,answer=?,lease_id=NULL,lease_until=0
                       WHERE source=? AND source_version=? AND lease_id=?""",
                    (now_iso(), version, answer, *key, lease_id),
                ).rowcount
            if stored:
                return version, answer
        time.sleep(0.05)
    return None, None


def refresh_due(get_group) -> str:
    with transaction() as db:
        group = get_group(db)
    due = group["review_at"]
    if group["status"] != "active":
        return "unavailable"
    if not due or due > now_iso():
        return "ready"
    if group["freshness_kind"] != "versioned" or not group["source"]:
        return "unavailable"

    source, base_source_version = group["source"], group["source_version"] or ""
    version, answer = _check_source(source, base_source_version, due)
    with transaction() as db:
        latest = get_group(db)
        if latest["status"] != "active":
            return "unavailable"
        if not latest["review_at"] or latest["review_at"] > now_iso():
            return "ready"
        if any(latest[key] != group[key] for key in ("source", "source_version", "current_version_id", "review_at")):
            return "unavailable"
        return _apply_source(db, latest, version, answer)


def _apply_source(db, group: dict, version: str | None, answer: str | None) -> str:
    now = now_iso()
    if version is None or answer is None:
        return "unavailable"
    current = db.execute("SELECT answer FROM group_versions WHERE id=?", (group["current_version_id"],)).fetchone()
    if current and answer == current["answer"].strip():
        db.execute("UPDATE groups SET source_version=?,last_checked_at=?,review_at=? WHERE id=?",
                   (version, now, next_review_at(now, group["review_interval_days"]), group["id"]))
        return "ready"
    exists = db.execute(
        """SELECT 1 FROM revisions WHERE group_id=? AND base_version_id=? AND source_version=? AND proposed_answer=?""",
        (group["id"], group["current_version_id"], version, answer),
    ).fetchone()
    if not exists:
        db.execute(
            """INSERT INTO revisions(id,group_id,base_version_id,proposed_answer,note,by_user_id,created_at,source_version)
               VALUES(?,?,?,?,?,?,?,?)""",
            (uid("rev"), group["id"], group["current_version_id"], answer, "来源复核发现内容变更",
             group["owner_id"], now, version),
        )
    return "review"
