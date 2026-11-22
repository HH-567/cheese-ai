"""把共享问答库导出成可再导入的 JSON（或 .json.gz）快照。

只导出共享库中状态为 active 的问题组、当前答案版本和有效等价问法；
不包含用户、会话、消息、密码或任何模型密钥。

用法：
    python backend/tools/export_shared_library.py --out data/published/library.json
    python backend/tools/export_shared_library.py --out data/published/library.json --gzip
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app import config  # noqa: E402
from app.db import connect, now_iso  # noqa: E402


def build_snapshot(db) -> dict:
    groups = db.execute(
        """SELECT g.id, g.original, g.intent, g.entities_json, g.source, v.answer
           FROM groups g JOIN group_versions v ON v.id=g.current_version_id
           WHERE g.scope='shared' AND g.status='active'"""
    ).fetchall()
    variants: dict[str, list[str]] = {}
    for alias in db.execute(
        """SELECT a.group_id, a.text FROM aliases a JOIN groups g ON g.id=a.group_id
           WHERE g.scope='shared' AND g.status='active' AND a.status='active' AND a.source<>'original'"""
    ):
        variants.setdefault(alias["group_id"], []).append(alias["text"])

    items = []
    for row in groups:
        group_id = row["id"][3:] if row["id"].startswith("qa_") else row["id"]
        try:
            keywords = json.loads(row["entities_json"] or "[]")
        except ValueError:
            keywords = []
        items.append({
            "id": group_id,
            "question": row["original"],
            "answer": row["answer"],
            "intent": row["intent"] or "",
            "keywords": [word for word in keywords if isinstance(word, str)],
            "variants": variants.get(row["id"], []),
            "source": row["source"] or "",
        })
    return {
        "meta": {
            "title": "柒柿AI 共享问答库快照",
            "built": now_iso(),
            "count": len(items),
            "note": "只含共享库的问题组、当前答案与有效等价问法；不含用户、会话、消息与密钥。",
        },
        "qa": items,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="导出共享问答库快照")
    parser.add_argument("--out", required=True, help="输出 JSON 路径（.gz 自动识别）")
    parser.add_argument("--gzip", action="store_true", help="同时写出一份 .json.gz")
    args = parser.parse_args()

    db = connect()
    try:
        payload = build_snapshot(db)
    finally:
        db.close()

    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    target.write_text(body, encoding="utf-8")
    print(f"写入 {target}：{len(payload['qa'])} 个问题组，"
          f"{sum(len(item['variants']) for item in payload['qa'])} 条等价问法，"
          f"{target.stat().st_size / 1024 / 1024:.1f} MB")
    if args.gzip:
        compressed = Path(str(target) + ".gz")
        with gzip.open(compressed, "wb", compresslevel=9) as handle:
            handle.write(body.encode("utf-8"))
        print(f"写入 {compressed}：{compressed.stat().st_size / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
