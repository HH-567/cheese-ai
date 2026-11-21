"""把外部 JSON 问答库导入柒柿AI 的问答库。

外部格式（qa_library.json）::

    {"meta": {...}, "qa": [{"id": "QA00001", "category": "科学技术/物理",
                            "intent": "概念解释", "question": "...",
                            "answer": "...", "keywords": [...], "variants": [...]}]}

映射关系：

- ``question``        → 问答组原问（``groups.original``）与 ``original`` 问法
- ``variants``        → 等价问法（``aliases``，source=``seed``）
- ``keywords``        → ``entities_json``（库页面作为标签展示，不参与精确匹配）
- ``category``+``intent`` → ``groups.intent``（库页面可按键词搜索分类）
- ``answer``          → 首版答案（``group_versions`` v1）

写入时按归一化问法去重：同一问法只能属于一个问答组，否则精确匹配会判为歧义。
重复问法（外部数据本身存在 18 条）整条跳过，并列入报告。

用法（在项目根目录）：::

    python backend/tools/import_qa_library.py --source "C:\\path\\qa_library.json"
    python backend/tools/import_qa_library.py --source ... --dry-run
    python backend/tools/import_qa_library.py --source ... --replace   # 重导已导入的条目

脚本幂等：问答组 id 由外部编号派生（``qa_QA00001``），已存在的条目不会重复写入。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app import config  # noqa: E402
from app.db import connect, now_iso  # noqa: E402
from app.matcher import normalize  # noqa: E402

GROUP_PREFIX = "qa_"
SOURCE_LABEL = "外部问答库导入"


def load_source(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        items = payload.get("qa") or payload.get("items") or []
    elif isinstance(payload, list):
        items = payload
    else:
        raise SystemExit("无法识别的数据格式：顶层应为对象（含 qa 数组）或数组。")
    if not items:
        raise SystemExit("数据文件里没有问答条目。")
    return items


def existing_keys(db: sqlite3.Connection) -> dict[str, str]:
    """已被占用的归一化问法 → 所属问答组。"""
    rows = db.execute(
        """SELECT g.id AS group_id, a.text_key FROM aliases a JOIN groups g ON g.id=a.group_id
           WHERE a.status='active' AND g.status='active'"""
    ).fetchall()
    return {row["text_key"]: row["group_id"] for row in rows}


def existing_group_ids(db: sqlite3.Connection) -> set[str]:
    return {row["id"] for row in db.execute("SELECT id FROM groups").fetchall()}


def owner_for(db: sqlite3.Connection, requested: str) -> str:
    row = db.execute("SELECT id FROM users WHERE id=?", (requested,)).fetchone()
    if row:
        return row["id"]
    row = db.execute("SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1").fetchone()
    if row:
        return row["id"]
    row = db.execute("SELECT id FROM users ORDER BY created_at LIMIT 1").fetchone()
    if not row:
        raise SystemExit("数据库里没有可用的用户，先启动服务或运行 create-user。")
    return row["id"]


def build_plan(
    items: list[dict[str, Any]], *, taken: dict[str, str], imported: set[str],
    owner: str, scope: str, timestamp: str,
) -> dict[str, Any]:
    claimed = dict(taken)
    groups: list[dict[str, Any]] = []
    skipped_existing: list[str] = []
    skipped_duplicate: list[tuple[str, str, str]] = []
    skipped_invalid: list[tuple[str, str]] = []
    variant_conflicts: list[tuple[str, str, str]] = []

    for item in items:
        qa_id = str(item.get("id") or "").strip()
        question = str(item.get("question") or "").strip()
        answer = str(item.get("answer") or "").strip()
        if not qa_id or not question or not answer:
            skipped_invalid.append((qa_id or "?", "缺少编号、问题或答案"))
            continue
        group_id = f"{GROUP_PREFIX}{qa_id}"
        if group_id in imported:
            skipped_existing.append(group_id)
            continue
        key = normalize(question)
        if len(key) < 2:
            skipped_invalid.append((qa_id, "问题过短，无法作为问法"))
            continue
        if key in claimed:
            skipped_duplicate.append((qa_id, question, claimed[key]))
            continue
        claimed[key] = group_id
        groups.append({
            "group_id": group_id,
            "version_id": f"{group_id}:v1",
            "qa_id": qa_id,
            "question": question,
            "answer": answer,
            "key": key,
            "intent": " · ".join(part for part in (
                str(item.get("category") or "").strip(), str(item.get("intent") or "").strip(),
            ) if part),
            "entities": [str(term).strip() for term in (item.get("keywords") or []) if str(term).strip()],
            "variants": [str(text).strip() for text in (item.get("variants") or []) if str(text).strip()],
            "owner": owner,
            "scope": scope,
            "timestamp": timestamp,
        })

    # 第二遍才分配等价问法：确保任何一条原问都不会被别的组的改写抢先占用。
    for group in groups:
        group["aliases"] = [(group["key"], group["question"], "original")]
        seen = {group["key"]}
        for text in group["variants"]:
            key = normalize(text)
            if len(key) < 2 or key in seen:
                continue
            if key in claimed:
                variant_conflicts.append((group["qa_id"], text, claimed[key]))
                continue
            claimed[key] = group["group_id"]
            seen.add(key)
            group["aliases"].append((key, text, "seed"))

    return {
        "groups": groups,
        "skipped_existing": skipped_existing,
        "skipped_duplicate": skipped_duplicate,
        "skipped_invalid": skipped_invalid,
        "variant_conflicts": variant_conflicts,
    }


def backup_database(prefix: str = "qa-import") -> Path | None:
    source = Path(config.DB_PATH)
    if not source.exists():
        return None
    stamp = time.strftime("%Y%m%d-%H%M%S")
    target_dir = Path(config.DATA_DIR) / "backups" / f"before-{prefix}-{stamp}"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / source.name
    with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
        src.backup(dst)
    return target


def write_plan(plan: dict[str, Any]) -> dict[str, int]:
    groups = plan["groups"]
    counters = Counter()
    db = connect()
    try:
        db.execute("BEGIN IMMEDIATE")
        for group in groups:
            db.execute(
                """INSERT INTO groups(id,owner_id,scope,original,intent,entities_json,constraints_json,
                   current_version_id,freshness_kind,status,hits,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (group["group_id"], group["owner"], group["scope"], group["question"], group["intent"],
                 json.dumps(group["entities"], ensure_ascii=False), "[]", group["version_id"],
                 "stable", "active", 0, group["timestamp"], group["timestamp"]),
            )
            db.execute(
                """INSERT INTO group_versions(id,group_id,n,answer,basis,by_user_id,status,created_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                (group["version_id"], group["group_id"], 1, group["answer"],
                 f"{SOURCE_LABEL} · {group['qa_id']}", group["owner"], "published", group["timestamp"]),
            )
            for index, (key, text, source) in enumerate(group["aliases"]):
                db.execute(
                    """INSERT OR IGNORE INTO aliases(id,group_id,text,text_key,status,source,created_at)
                       VALUES(?,?,?,?,?,?,?)""",
                    (f"{group['group_id']}:a{index}", group["group_id"], text, key, "active", source,
                     group["timestamp"]),
                )
                counters[source] += 1
            counters["groups"] += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return dict(counters)


def delete_imported(db: sqlite3.Connection) -> int:
    rows = db.execute("SELECT id FROM groups WHERE id GLOB ?", (f"{GROUP_PREFIX}*",)).fetchall()
    for row in rows:
        db.execute("DELETE FROM groups WHERE id=?", (row["id"],))
    return len(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="把外部 JSON 问答库导入柒柿AI 问答库")
    parser.add_argument("--source", required=True, help="外部问答库 JSON 路径")
    parser.add_argument("--db", default=None, help="目标数据库（默认取 QISHI_DB_PATH 或 data/qishi.sqlite3）")
    parser.add_argument("--scope", default="shared", choices=("shared", "personal"), help="导入到共享库或个人库")
    parser.add_argument("--owner", default="u-a", help="问答组归属账号（默认 u-a）")
    parser.add_argument("--replace", action="store_true", help="先删除此前用本脚本导入的问答组，再重新导入")
    parser.add_argument("--dry-run", action="store_true", help="只解析并打印统计，不写库")
    parser.add_argument("--no-backup", action="store_true", help="跳过写库前的数据库备份")
    args = parser.parse_args()

    if args.db:
        config.DB_PATH = Path(args.db)
        config.DATA_DIR = config.DB_PATH.parent

    source = Path(args.source)
    if not source.exists():
        raise SystemExit(f"找不到数据文件：{source}")
    if not Path(config.DB_PATH).exists():
        raise SystemExit(f"找不到数据库：{config.DB_PATH}。先启动一次服务让它建库。")

    items = load_source(source)
    db = connect()
    try:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='groups'").fetchone():
            raise SystemExit("目标数据库还没有初始化，先启动一次服务。")
        owner = owner_for(db, args.owner)
        scope = args.scope
        if scope == "shared" and not db.execute(
            "SELECT 1 FROM library_members WHERE library_id='QS-2048' AND user_id=?", (owner,)
        ).fetchone():
            raise SystemExit(f"账号 {owner} 不是共享库成员，改用 --scope personal 或先加入共享库。")
        removed = 0
        if args.replace:
            if args.dry_run:
                removed = db.execute("SELECT count(*) FROM groups WHERE id GLOB ?", (f"{GROUP_PREFIX}*",)).fetchone()[0]
            else:
                removed = delete_imported(db)
                db.commit()
        plan = build_plan(
            items, taken=existing_keys(db), imported=existing_group_ids(db),
            owner=owner, scope=scope, timestamp=now_iso(),
        )
    finally:
        db.close()

    groups = plan["groups"]
    aliases = sum(len(group["aliases"]) for group in groups)
    variants = sum(1 for group in groups for alias in group["aliases"] if alias[2] == "seed")
    print(f"数据文件：{source}")
    print(f"目标数据库：{config.DB_PATH}（scope={scope}, owner={owner}）")
    print(f"源条目 {len(items)} 条 → 可导入问答组 {len(groups)} 个，问法 {aliases} 条（原问 {len(groups)}、等价问法 {variants}）")
    if removed:
        print(f"已清理旧导入记录 {removed} 个问答组")
    if plan["skipped_existing"]:
        print(f"跳过已存在问答组：{len(plan['skipped_existing'])} 个")
    if plan["skipped_duplicate"]:
        print(f"跳过重复问法：{len(plan['skipped_duplicate'])} 条")
        for qa_id, question, owner_group in plan["skipped_duplicate"][:5]:
            print(f"  - {qa_id}「{question}」已被 {owner_group} 占用")
    if plan["variant_conflicts"]:
        print(f"跳过与他人原问冲突的等价问法：{len(plan['variant_conflicts'])} 条")
        for qa_id, text, owner_group in plan["variant_conflicts"][:5]:
            print(f"  - {qa_id}「{text}」与 {owner_group} 的原问相同")
    if plan["skipped_invalid"]:
        print(f"跳过无效条目：{len(plan['skipped_invalid'])} 条")
        for qa_id, reason in plan["skipped_invalid"][:5]:
            print(f"  - {qa_id}：{reason}")

    if args.dry_run:
        print("（--dry-run，未写入数据库）")
        return 0
    if not groups:
        print("没有需要写入的条目。")
        return 0

    if not args.no_backup:
        backup = backup_database()
        if backup:
            print(f"已备份数据库：{backup}")

    started = time.perf_counter()
    counters = write_plan(plan)
    elapsed = time.perf_counter() - started
    print(f"写入完成：{counters.get('groups', 0)} 个问答组，"
          f"{counters.get('original', 0) + counters.get('seed', 0)} 条问法，用时 {elapsed:.2f} 秒")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
