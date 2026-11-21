"""为已入库的问答组批量生成口语化等价问法。

柒柿AI 的聊天流程会在云端回答后由后台生成等价问法，这里把同一件事搬到离线批量执行，
用来给整批导入的问答组（例如校园知识库）补上学生真实会说的问法。

用法（在项目根目录，需要配置 CLOUD_BASE_URL / CLOUD_API_KEY）::

    python backend/tools/generate_aliases.py --prefix "qa_cau-faq-" --batch 12
    python backend/tools/generate_aliases.py --prefix "qa_cau-faq-" --limit 24 --dry-run

每批一次模型调用，返回的 JSON 经过长度、字数、重复与冲突校验后才写入 ``aliases``，
source 记为 ``generated``。脚本幂等：已经有 ``generated`` 问法的问答组默认跳过。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from _env import load_env_file  # noqa: E402

load_env_file()

from app import config  # noqa: E402
from app.db import connect, now_iso  # noqa: E402
from app.engine import complete_cloud, estimated_cost, uid  # noqa: E402
from app.matcher import normalize  # noqa: E402

PROMPT = (
    "你是中国农业大学的校园助手。为下列每条校园问答各生成 3 条学生可能自然说出的中文问法。\n"
    "要求：口语化，每条 4 到 25 个字；必须是学生真会打的问句，能独立看懂；"
    "保持原问题的对象和范围，不要改变专业、地点、数字或时间条件；"
    "不要照抄原题，不要编号，不要英文，不要加解释。\n"
    "只返回一个 JSON 对象，格式为 {\"items\":[{\"id\":\"编号\",\"questions\":[\"问法1\",\"问法2\",\"问法3\"]}]}。\n"
    "输入：\n"
)


def load_targets(db, prefix: str, limit: int, skip_generated: bool) -> list[dict[str, Any]]:
    rows = db.execute(
        """SELECT g.id,g.original,g.intent,v.answer,
                  (SELECT count(*) FROM aliases a WHERE a.group_id=g.id AND a.source='generated' AND a.status='active') AS generated
           FROM groups g JOIN group_versions v ON v.id=g.current_version_id
           WHERE g.id GLOB ? AND g.status='active'
           ORDER BY g.id""",
        (f"{prefix}*",),
    ).fetchall()
    targets = []
    for row in rows:
        if skip_generated and row["generated"] > 0:
            continue
        targets.append(dict(row))
        if limit and len(targets) >= limit:
            break
    return targets


def ask_batch(batch: list[dict[str, Any]]) -> tuple[dict[str, list[str]], dict[str, int]]:
    payload = [{
        "id": item["id"],
        "title": item["original"],
        "category": item["intent"],
        "keywords": [alias for alias in item.get("keywords", [])][:6],
        "body": item["answer"][:160],
    } for item in batch]
    prompt = PROMPT + json.dumps(payload, ensure_ascii=False)
    # 该模型会先输出推理内容，批次大时容易撞上输出上限，这里放宽到 8192。
    text, usage = complete_cloud([{"role": "user", "content": prompt}], max_tokens=8192)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return {}, usage
    try:
        parsed = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return {}, usage
    result: dict[str, list[str]] = {}
    for entry in parsed.get("items", []):
        if not isinstance(entry, dict):
            continue
        entry_id = str(entry.get("id") or "").strip()
        questions = entry.get("questions")
        if entry_id and isinstance(questions, list):
            result[entry_id] = [str(question).strip() for question in questions if isinstance(question, str)]
    return result, usage


def ask_with_split(batch: list[dict[str, Any]], state: dict[str, Any]) -> dict[str, list[str]]:
    """一次调用失败时把批次对半拆开重试，避免一条坏数据拖垮整批。"""
    try:
        generated, usage = ask_batch(batch)
        state["calls"] += 1
        state["cost"] += estimated_cost(usage.get("tokens_in", 0), usage.get("tokens_out", 0))
        return generated
    except Exception as error:
        if len(batch) <= 1:
            state["failed"] += 1
            print(f"  单条失败（{batch[0]['id']}）：{error}")
            return {}
        middle = len(batch) // 2
        return {**ask_with_split(batch[:middle], state), **ask_with_split(batch[middle:], state)}


def acceptable(question: str) -> bool:
    if not 4 <= len(question) <= 30:
        return False
    if not re.search(r"[\u4e00-\u9fff]{2}", question):
        return False
    if re.search(r"[a-zA-Z]{4,}", question):
        return False
    return question[-1] in "？?吗呢" or "哪" in question or "什么" in question or "怎么" in question


def main() -> int:
    parser = argparse.ArgumentParser(description="批量生成等价问法")
    parser.add_argument("--prefix", required=True, help="问答组 id 前缀，例如 qa_cau-faq-")
    parser.add_argument("--batch", type=int, default=12, help="每次模型调用包含的问答数")
    parser.add_argument("--limit", type=int, default=0, help="最多处理多少条（0 为全部）")
    parser.add_argument("--db", default=None)
    parser.add_argument("--dry-run", action="store_true", help="只生成并打印，不写库")
    parser.add_argument("--include-generated", action="store_true", help="已有等价问法的问答组也重新生成")
    args = parser.parse_args()

    if args.db:
        config.DB_PATH = Path(args.db)
        config.DATA_DIR = config.DB_PATH.parent
    if not config.CLOUD_BASE_URL or not config.CLOUD_API_KEY:
        raise SystemExit("未配置云端模型，无法生成等价问法。")

    db = connect()
    try:
        targets = load_targets(db, args.prefix, args.limit, skip_generated=not args.include_generated)
        if not targets:
            print("没有需要生成等价问法的问答组。")
            return 0
        keywords = {}
        for item in targets:
            keywords[item["id"]] = [row["text"] for row in db.execute(
                "SELECT text FROM aliases WHERE group_id=? AND source='seed' ORDER BY created_at", (item["id"],)
            ).fetchall()]
        taken = {row["text_key"]: row["group_id"] for row in db.execute(
            "SELECT group_id,text_key FROM aliases WHERE status='active'").fetchall()}
        existing_group_ids = {row["id"] for row in db.execute("SELECT id FROM groups").fetchall()}
    finally:
        db.close()

    print(f"目标问答组 {len(targets)} 个，每批 {args.batch} 条")
    started = time.perf_counter()
    added = skipped = 0
    state: dict[str, Any] = {"calls": 0, "cost": 0.0, "failed": 0}
    batch_size = max(1, args.batch)
    for offset in range(0, len(targets), batch_size):
        batch = targets[offset:offset + batch_size]
        for item in batch:
            item["keywords"] = keywords.get(item["id"], [])
        generated = ask_with_split(batch, state)
        rows: list[tuple[str, str, str, str]] = []
        for item in batch:
            group_id = item["id"]
            question_key = normalize(item["original"])
            for question in generated.get(group_id, []):
                key = normalize(question)
                if len(key) < 3 or key == question_key or not acceptable(question):
                    skipped += 1
                    continue
                if key in taken:
                    skipped += 1
                    continue
                taken[key] = group_id
                rows.append((uid("alias"), group_id, question, key))
        if args.dry_run:
            for question in rows[:3]:
                print(f"  {question[1]} ← {question[2]}")
        elif rows:
            db = connect()
            try:
                with db:
                    for row in rows:
                        db.execute(
                            """INSERT OR IGNORE INTO aliases(id,group_id,text,text_key,status,source,created_at)
                               VALUES(?,?,?,?, 'active', 'generated', ?)""",
                            (*row, now_iso()),
                        )
            finally:
                db.close()
        added += len(rows)
        done = min(offset + batch_size, len(targets))
        print(f"  进度 {done}/{len(targets)}：本批新增 {len(rows)} 条，累计 {added} 条，"
              f"跳过 {skipped}，调用 {state['calls']} 次")

    elapsed = time.perf_counter() - started
    print(f"完成：新增等价问法 {added} 条，模型调用 {state['calls']} 次，失败 {state['failed']} 条，"
          f"用时 {elapsed:.0f} 秒，估算费用 {state['cost']:.4f} 美元")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
