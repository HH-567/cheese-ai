"""用云端模型审核夜间生成的候选问答：判断答案对不对，错的顺手改掉。

夜间生成器（nightly_qa_builder.py）用本地 3B 写的答案里有不少编造细节。
这个脚本把候选按批（默认 5 条一批）交给云端模型：

- ``ok=true``：答案可用，原样保留；
- ``ok=false`` 且给出 ``fix``：用修正后的答案替换；
- ``ok=false`` 且没有修正：进丢弃清单，不导入。

审核结果逐批写进 ``<source>-cloud.jsonl``，中断可以续跑；全部完成后汇总成
``<source>-cloud.json``（可直接导入）和 ``<source>-cloud-dropped.json``。

用法（项目根目录）::

    python backend/tools/cloud_review_candidates.py --limit 50          # 先试 50 条
    python backend/tools/cloud_review_candidates.py                     # 全量
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from tools._env import load_env_file  # noqa: E402

load_env_file()

from app import config  # noqa: E402

SYSTEM = (
    "你是问答质检员。逐条判断问答是否满足：1) 问题是一个独立、具体、用户真的会问的问题"
    "（新闻标题、栏目名、没有指向的短语都不算，直接判不合格）；2) 答案正确回答了问题；"
    "3) 没有编造具体的时间、金额、地点、人名或版本号；4) 答案本身自洽。"
    '只输出 JSON 数组，每项：{"i": 序号, "ok": true/false, '
    '"fix": "ok 为 false 时给出简短、保守、正确的答案；问题本身不合格或拿不准就写空字符串"}'
    "。不要输出解释、不要加代码围栏。"
)

STATS = {"keep": 0, "fixed": 0, "drop": 0, "unreviewed": 0}
LOCK = threading.Lock()
TOKENS = {"in": 0, "out": 0}


def request(batch: list[dict], model: str, timeout: int = 180) -> dict:
    lines = []
    for index, item in enumerate(batch, 1):
        lines.append(f"{index}. 问：{item['question']}\n   答：{item['answer']}")
    prompt = "逐条审核下面这些问答：\n\n" + "\n".join(lines)
    body = json.dumps({"model": model, "temperature": 0, "max_tokens": 2000,
                       "messages": [{"role": "system", "content": SYSTEM},
                                    {"role": "user", "content": prompt}]}).encode("utf-8")
    req = urllib.request.Request(config.CLOUD_BASE_URL + "/chat/completions", data=body,
                                 headers={"Content-Type": "application/json",
                                          "Authorization": f"Bearer {config.CLOUD_API_KEY}"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read())


def parse_verdicts(text: str, size: int) -> dict[int, dict]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    start, end = text.find("["), text.rfind("]")
    if start >= 0 and end > start:
        text = text[start:end + 1]
    try:
        rows = json.loads(text)
    except ValueError:
        return {}
    verdicts = {}
    if not isinstance(rows, list):
        return {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            index = int(row.get("i"))
        except (TypeError, ValueError):
            continue
        if 1 <= index <= size:
            verdicts[index] = {"ok": bool(row.get("ok")), "fix": str(row.get("fix") or "").strip()}
    return verdicts


def review_batch(batch: list[dict], model: str) -> list[dict]:
    for attempt in range(3):
        try:
            data = request(batch, model)
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            time.sleep(2 + attempt * 3)
            last_error = str(error)
            continue
        usage = data.get("usage") or {}
        with LOCK:
            TOKENS["in"] += int(usage.get("prompt_tokens") or 0)
            TOKENS["out"] += int(usage.get("completion_tokens") or 0)
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
        verdicts = parse_verdicts(content, len(batch))
        if verdicts:
            return [verdicts.get(index + 1, {"ok": None, "fix": ""}) for index in range(len(batch))]
        last_error = "无法解析审核结果"
    return [{"ok": None, "fix": "", "error": last_error} for _ in batch]


def main() -> None:
    parser = argparse.ArgumentParser(description="用云端模型审核候选问答")
    parser.add_argument("--source", default=str(ROOT / "data" / "candidates" / "qa-20261122.json"))
    parser.add_argument("--model", default="qwen4-max")
    parser.add_argument("--batch", type=int, default=5)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 条，0 表示全部")
    parser.add_argument("--out-suffix", default="-cloud")
    args = parser.parse_args()

    if not (config.CLOUD_BASE_URL and config.CLOUD_API_KEY):
        raise SystemExit("没有云端配置，先在 .env 里设置 CLOUD_BASE_URL / CLOUD_API_KEY")

    source = Path(args.source)
    payload = json.loads(source.read_text(encoding="utf-8"))
    items = payload.get("qa") or []
    if args.limit:
        items = items[:args.limit]
    out_base = source.with_name(source.stem + args.out_suffix)
    jsonl_path = out_base.with_suffix(".jsonl")
    done: dict[str, dict] = {}
    if jsonl_path.exists():
        for line in jsonl_path.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get("id"):
                done[row["id"]] = row
    pending = [item for item in items if item["id"] not in done]
    print(f"source {len(items)} items, already reviewed {len(done)}, pending {len(pending)}", flush=True)

    batches = [pending[i:i + args.batch] for i in range(0, len(pending), args.batch)]
    started = time.time()

    def run(batch: list[dict]) -> list[dict]:
        verdicts = review_batch(batch, args.model)
        rows = []
        for item, verdict in zip(batch, verdicts):
            answer = item["answer"]
            status = "unreviewed"
            if verdict.get("ok") is True:
                status = "keep"
            elif verdict.get("ok") is False:
                fix = verdict.get("fix") or ""
                if fix and 8 <= len(fix) <= 200:
                    answer = fix
                    status = "fixed"
                else:
                    status = "drop"
            row = {**item, "answer": answer, "review": {"status": status, "model": args.model}}
            with LOCK:
                STATS[status] += 1
            rows.append(row)
        with LOCK, jsonl_path.open("a", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        return rows

    processed = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        for rows in pool.map(run, batches):
            processed += len(rows)
            if processed % 100 < args.batch:
                elapsed = time.time() - started
                rate = processed / elapsed if elapsed else 0
                print(f"{processed}/{len(pending)} · {rate:.1f} 条/秒 · 剩余约 {(len(pending) - processed) / rate / 60 if rate else 0:.0f} 分钟 · {STATS}",
                      flush=True)

    rows = []
    if jsonl_path.exists():
        for line in jsonl_path.read_text(encoding="utf-8").splitlines():
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue
    kept = [row for row in rows if row["review"]["status"] in ("keep", "fixed")]
    dropped = [row for row in rows if row["review"]["status"] in ("drop", "unreviewed")]
    for name, rows_out in (("", kept), ("-dropped", dropped)):
        path = out_base.with_name(out_base.name + name + ".json")
        path.write_text(json.dumps({**payload, "meta": {**payload.get("meta", {}), "count": len(rows_out),
                                                        "reviewed_by": args.model},
                                    "qa": rows_out}, ensure_ascii=False, indent=1), encoding="utf-8")

    minutes = (time.time() - started) / 60
    print(f"done in {minutes:.1f} min · tokens in={TOKENS['in']} out={TOKENS['out']} · {STATS}", flush=True)
    print(f"kept {len(kept)} -> {out_base.name}.json", flush=True)
    print(f"dropped {len(dropped)} -> {out_base.name}-dropped.json", flush=True)


if __name__ == "__main__":
    main()
