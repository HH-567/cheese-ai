"""把外包生成的等价问法批量导入 aliases 表。

输入格式（workbuddy 回传）既可以是对象 ``{"items":[...]}``，也可以是数组::

    {"items": [{"id": "qa_gen-20261122-00005", "questions": ["怎么合并两列", "..."]}]}

逐条校验：长度 4–30、必须是中文问句、不能和原问相同、不能和已有问法重复。
不合格的跳过并计数，不会写进库。

用法（项目根目录）::

    python backend/tools/import_alias_batch.py --source data/candidates/alias-workbuddy/alias-part-01.out.json --dry-run
    python backend/tools/import_alias_batch.py --source data/candidates/alias-workbuddy
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from tools._env import load_env_file  # noqa: E402

load_env_file()

from app import config  # noqa: E402
from app.db import connect, now_iso  # noqa: E402
from app.engine import uid  # noqa: E402
from app.matcher import normalize  # noqa: E402


def acceptable(question: str) -> bool:
    if not 4 <= len(question) <= 30:
        return False
    if not re.search(r"[\u4e00-\u9fff]{2}", question):
        return False
    if re.search(r"[a-zA-Z]{4,}", question):
        return False
    return question[-1] in "？?吗呢" or any(word in question for word in ("哪", "什么", "怎么", "如何", "为什么"))


def load_items(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    items = payload.get("items") if isinstance(payload, dict) else payload
    return [item for item in (items or []) if isinstance(item, dict)]


def main() -> int:
    parser = argparse.ArgumentParser(description="导入外包生成的等价问法")
    parser.add_argument("--source", required=True, help="回传的 JSON 文件或目录")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    source = Path(args.source)
    if source.is_dir():
        files = [path for path in sorted(source.glob("*.json"))
                 if path.name != "input-all.json" and not re.fullmatch(r"alias-part-\d+\.json", path.name)]
    else:
        files = [source]
    if not files:
        raise SystemExit("没有找到回传文件（目录模式下会跳过 input-all.json 和未改名的 alias-part-NN.json）")

    db = connect()
    try:
        taken = {row["text_key"]: row["group_id"] for row in db.execute(
            "SELECT group_id,text_key FROM aliases WHERE status='active'").fetchall()}
        originals = {row["id"]: row["original"] for row in db.execute(
            "SELECT id,original FROM groups WHERE status='active'").fetchall()}
        added = skipped = unknown = 0
        rows: list[tuple[str, str, str, str]] = []
        for path in files:
            for item in load_items(path):
                group_id = str(item.get("id") or "").strip()
                if group_id not in originals:
                    unknown += 1
                    continue
                original_key = normalize(originals[group_id])
                questions = item.get("questions") or []
                if not isinstance(questions, list):
                    continue
                for question in questions:
                    text = str(question or "").strip().strip('"“”')
                    key = normalize(text)
                    if len(key) < 3 or key == original_key or not acceptable(text):
                        skipped += 1
                        continue
                    if key in taken:
                        skipped += 1
                        continue
                    taken[key] = group_id
                    rows.append((uid("alias"), group_id, text, key))
            print(f"{path.name}: 累计可新增 {len(rows)} 条")
        if args.dry_run:
            print(f"[dry-run] 可新增 {len(rows)} 条，跳过 {skipped}，未知 id {unknown}")
        else:
            with db:
                for row in rows:
                    db.execute(
                        """INSERT OR IGNORE INTO aliases(id,group_id,text,text_key,status,source,created_at)
                           VALUES(?,?,?,?, 'active', 'generated', ?)""",
                        (*row, now_iso()),
                    )
            print(f"完成：新增 {len(rows)} 条，跳过 {skipped}，未知 id {unknown}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
