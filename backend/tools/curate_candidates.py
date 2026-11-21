"""把夜间生成的候选问答切成「可直接试导入」和「需要人工核对」两堆。

夜间生成器写出的 qa-YYYYMMDD.json 条目很多，但质量参差。这个脚本只做机械筛选：

- 只保留指定模型（默认 3B）；
- ``risk=low`` 的进 ``-usable.json``（技术类主题，或有搜索资料支撑的校园题）；
- 其余进 ``-review.json``，并附上每条的风险来源，方便人工过一遍；
- 再按长度、空答案、明显占位符做一轮清洗。

用法::

    python backend/tools/curate_candidates.py data/candidates/qa-20261122.json
    python backend/tools/curate_candidates.py ... --model qwen2.5-3b --min-answer 15
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

PLACEHOLDER = re.compile(r"……|<|>|某某|待补充|略|TODO", re.I)
TECH_TOPICS = {
    "Excel", "Word", "PPT", "WPS", "Windows", "macOS", "手机", "浏览器", "微信", "打印", "邮箱",
    "论文", "英语", "前端", "数据库", "Git", "Python", "电脑选购", "数据恢复", "AI 工具", "密码",
    "手机套餐", "生活常识", "理财",
}


def effective_risk(item: dict) -> str:
    """早期条目没有 risk 字段：有搜索资料或属于技术主题的按低风险算。"""
    risk = item.get("risk")
    if risk in ("low", "high"):
        return risk
    topic = item["category"].split("/", 1)[-1]
    return "low" if item.get("grounded") or topic in TECH_TOPICS else "high"


def keep(item: dict, *, model: str, min_answer: int, max_answer: int) -> bool:
    answer = str(item.get("answer", "")).strip()
    question = str(item.get("question", "")).strip()
    if item.get("model") not in (None, model) and model != "any":
        return False
    if not 6 <= len(question) <= 50 or not min_answer <= len(answer) <= max_answer:
        return False
    if PLACEHOLDER.search(question) or PLACEHOLDER.search(answer):
        return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="筛选夜间候选问答")
    parser.add_argument("source", help="qa-YYYYMMDD.json")
    parser.add_argument("--model", default="qwen2.5-3b", help="只保留这个模型生成的条目，any 表示全部")
    parser.add_argument("--min-answer", type=int, default=15)
    parser.add_argument("--max-answer", type=int, default=120)
    parser.add_argument("--out-suffix", default="")
    parser.add_argument("--split", action="store_true", help="另外按技术/校园主题拆成两个文件")
    args = parser.parse_args()

    source = Path(args.source)
    payload = json.loads(source.read_text(encoding="utf-8"))
    items = payload.get("qa") or []
    usable, review = [], []
    for item in items:
        if not keep(item, model=args.model, min_answer=args.min_answer, max_answer=args.max_answer):
            review.append(item)
        elif effective_risk(item) == "low":
            usable.append(item)
        else:
            review.append(item)

    stem = source.stem
    usable_path = source.with_name(f"{stem}-usable{args.out_suffix}.json")
    review_path = source.with_name(f"{stem}-review{args.out_suffix}.json")
    meta = {**payload.get("meta", {}), "curated_from": source.name,
            "filter": {"model": args.model, "min_answer": args.min_answer, "max_answer": args.max_answer}}
    usable_path.write_text(json.dumps({**payload, "meta": {**meta, "count": len(usable)}, "qa": usable},
                                      ensure_ascii=False, indent=1), encoding="utf-8")
    review_path.write_text(json.dumps({**payload, "meta": {**meta, "count": len(review)}, "qa": review},
                                      ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"source {len(items)} -> usable {len(usable)} / review {len(review)}")
    print("usable topics:", Counter(item["category"].split("/", 1)[-1] for item in usable).most_common(8))
    print(f"written: {usable_path.name}, {review_path.name}")
    if args.split:
        tech = [item for item in usable if item["category"].split("/", 1)[-1] in TECH_TOPICS]
        campus = [item for item in usable if item["category"].split("/", 1)[-1] not in TECH_TOPICS]
        for name, rows in (("tech", tech), ("campus", campus)):
            path = source.with_name(f"{stem}-{name}{args.out_suffix}.json")
            path.write_text(json.dumps({**payload, "meta": {**meta, "count": len(rows)}, "qa": rows},
                                       ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"written: {path.name} ({len(rows)})")


if __name__ == "__main__":
    main()
