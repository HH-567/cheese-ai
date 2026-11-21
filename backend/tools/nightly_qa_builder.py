"""整夜用本地模型生成候选问答，第二天人工筛选后导入问答库。

设计取舍：
- 只用本机 llama.cpp（``QISHI_LOCAL_MODEL_URL``），不消耗云端额度。
- 每个主题先搜一次百度（可关），把摘要当作资料喂给模型，答案更靠谱；
  同一份资料在 ``--search-ttl`` 内复用，避免把搜索额度打光。
- 质量门槛比较严：格式、长度、重复片段、寒暄和个人问题都会过滤，
  宁可少收也不把明显垃圾写进候选文件。

产物（默认 ``data/candidates/``）：
- ``qa-YYYYMMDD.jsonl``：每收一条就追加，进程中断也不丢。
- ``qa-YYYYMMDD.json``：可直接交给 ``backend/tools/import_qa_library.py`` 的快照。
- ``nightly-YYYYMMDD.log``：生成日志。
- ``report-YYYYMMDD.md``：结束时写的统计。

用法（项目根目录）::

    python backend/tools/nightly_qa_builder.py --minutes 480
    python backend/tools/nightly_qa_builder.py --minutes 5 --no-web --max-pairs 20   # 试跑
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from tools._env import load_env_file  # noqa: E402

load_env_file()

from app.matcher import normalize  # noqa: E402

TOPICS: list[tuple[str, str]] = [
    ("校园卡", "校园卡挂失、补办、充值、消费"),
    ("食堂", "食堂开放时间、支付方式、打包、外卖"),
    ("宿舍", "宿舍门禁、水电、报修、快递、搬家"),
    ("教务", "选课、退课、补选、成绩、绩点"),
    ("考试", "考试安排、缓考、补考、四六级报名"),
    ("图书馆", "借书、续借、座位预约、文献下载"),
    ("校园网", "校园网认证、VPN、WiFi、流量"),
    ("奖助", "奖学金、助学金、勤工助学、助学贷款"),
    ("转专业", "转专业、辅修、双学位、学分认定"),
    ("毕业", "毕业设计、答辩、离校手续、档案"),
    ("Excel", "Excel 公式、筛选、透视表、冻结、打印"),
    ("Word", "Word 排版、页眉页脚、目录、批注"),
    ("PPT", "PPT 母版、动画、导出、字体"),
    ("WPS", "WPS 与 Office 兼容、云文档"),
    ("Windows", "Windows 更新、快捷键、蓝屏、清理"),
    ("macOS", "macOS 截图、安装、快捷键、磁盘"),
    ("手机", "安卓与 iPhone 设置、备份、存储"),
    ("浏览器", "浏览器书签、扩展、缓存、下载"),
    ("微信", "微信文件、群管理、备份、电脑版"),
    ("打印", "校园打印、PDF 打印、双面、扫描"),
    ("邮箱", "学校邮箱、邮件客户端、垃圾邮件"),
    ("论文", "查重、文献检索、引用格式、选题"),
    ("英语", "四六级、雅思、背单词、听力"),
    ("考研", "考研报名、复习计划、调剂、复试"),
    ("求职", "简历、面试、实习证明、三方协议"),
    ("快递", "取件、寄件、驿站、退换货"),
    ("出行", "公交地铁、打车、火车票、共享单车"),
    ("健康", "校医院、医保、体检、运动"),
    ("理财", "银行卡、校园贷风险、记账"),
    ("证件", "身份证、学生证、护照、居住证"),
    ("生活常识", "天气、时间、单位换算、小窍门"),
    ("Python", "Python 基础、报错、环境、常用库"),
    ("前端", "HTML/CSS/JS、React、浏览器调试"),
    ("数据库", "SQL、SQLite、MySQL、索引"),
    ("Git", "Git 提交、分支、冲突、远程仓库"),
]

FOCUS = [
    "办理流程和时间地点", "常见错误和注意事项", "需要准备的材料",
    "费用和有效期", "线上办理和自助渠道", "新生最容易搞混的地方",
]

QUESTION_PREFIX = re.compile(r"^(?:问|问题|Q)\s*[：:]\s*", re.I)
ANSWER_PREFIX = re.compile(r"^(?:答|答案|A)\s*[：:]\s*", re.I)
INTERROGATIVE = re.compile(r"[？?]|怎么|如何|为什么|什么|哪些|哪个|多少|几点|能不能|可以|是否|要不要|多久|怎么办|怎样")
GREETING = re.compile(r"^(?:你好|您好|嗨|谢谢|在吗|你是谁|我是谁|hi|hello)[？?！!。]*$", re.I)
PERSONAL = re.compile(r"我是谁|我(?:的)?(?:名字|身份|学号|账号|密码|手机号|邮箱)|我叫什么", re.I)
PLACEHOLDER = re.compile(r"……|<|>|X{2,}|某某|待补充|略", re.I)
REFUSAL = re.compile(r"抱歉|无法回答|无法确定|我不确定|作为AI|作为一个", re.I)


def log(message: str, handle) -> None:
    line = f"{datetime.now():%H:%M:%S} {message}"
    print(line, flush=True)
    handle.write(line + "\n")
    handle.flush()


def chat(messages: list[dict], *, max_tokens: int = 220, temperature: float = 0.5, timeout: int = 180) -> str:
    payload = {
        "model": MODEL, "messages": messages, "max_tokens": max_tokens,
        "temperature": temperature, "repeat_penalty": 1.25, "top_p": 0.9,
    }
    request = urllib.request.Request(
        ENDPOINT, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = json.loads(response.read())
    return data["choices"][0]["message"]["content"].strip()


def parse_pairs(text: str) -> list[tuple[str, str]]:
    lines = [line.strip() for line in text.replace("\r", "").split("\n")]
    pairs: list[tuple[str, str]] = []
    question = None
    answer: list[str] = []
    for line in lines:
        if not line:
            continue
        if QUESTION_PREFIX.match(line):
            if question and answer:
                pairs.append((question, "".join(answer)))
            question = QUESTION_PREFIX.sub("", line).strip(" 　")
            answer = []
        elif ANSWER_PREFIX.match(line):
            answer.append(ANSWER_PREFIX.sub("", line).strip(" 　"))
        elif question and answer:
            answer.append(line)
    if question and answer:
        pairs.append((question, "".join(answer)))
    return pairs


def repeated(answer: str) -> bool:
    compact = re.sub(r"[\s，。！？、；：,.!?;:]", "", answer)
    if len(compact) < 12:
        return False
    grams = Counter(compact[i:i + 6] for i in range(len(compact) - 5))
    return bool(grams) and grams.most_common(1)[0][1] >= 3


def question_ok(question: str) -> bool:
    text = question.strip().strip('"“”\'`')
    text = re.sub(r'["“”]', "", text).strip()
    if not 6 <= len(text) <= 50:
        return False
    if not INTERROGATIVE.search(text):
        return False
    if text.endswith("。") and not re.search(r"[？?]", text):
        return False
    if re.search(r"[：:!！_…]|腾讯新闻|知乎|百度知道|新浪|搜狐", text):
        return False
    if re.search(r"常见问答|相关问答|问答有哪些|有哪些问题|问题汇总|常见问题", text):
        return False
    if GREETING.fullmatch(text) or PERSONAL.search(text):
        return False
    if PLACEHOLDER.search(text) or text.count("？") + text.count("?") > 1:
        return False
    if not re.search(r"[\u4e00-\u9fff]", text):
        return False
    return not re.search(r"(?:资料|上面|上述|根据|以下)", text)


def answer_ok(answer: str) -> bool:
    text = answer.strip().strip('"“”')
    if not 10 <= len(text) <= 120:
        return False
    if re.match(r"^(?:\d+[.、]|（\d+）|\([0-9]+\))", text):
        return False
    if not re.search(r"[\u4e00-\u9fff]", text):
        return False
    if REFUSAL.search(text) or PLACEHOLDER.search(text) or repeated(text):
        return False
    if re.search(r"https?://|www\.|\.com|\.cn|公众号|小程序|二维码", text, re.I):
        return False
    if text.count("!") >= 3:
        return False
    return text[-1] in "。！？!?"


def search_context(query: str) -> str:
    """搜一次百度，把标题和摘要拼成给模型的资料；失败返回空串。"""
    global SEARCHES
    if SEARCHES >= MAX_SEARCHES:
        return ""
    try:
        from app.web_search import find_web_sources
        sources = find_web_sources(query)
    except Exception as error:  # 搜索不可用不影响主流程
        log(f"search skipped: {error}", LOG)
        return ""
    SEARCHES += 1
    log(f"search [{SEARCHES}/{MAX_SEARCHES}] {query} -> {len(sources)} 条", LOG)
    return "\n".join(f"- {item['title']}：{item['excerpt'][:110]}" for item in sources[:4])


def build_prompt(topic: str, detail: str, focus: str, context: str, count: int) -> str:
    head = (
        f"你在为大学校园助手整理「{topic}」的常见问答。主题范围：{detail}。"
        f"这次重点写{focus}相关的 {count} 条。"
    )
    rules = (
        "要求：问题要具体、像真人会问的，问题里不要加引号，不要直接拿主题词开头；"
        "答案用一到两句话、只讲一个要点，不超过 50 字；不确定的细节不要编造；"
        "不要重复同一句话。\n"
        "示例：\n问：食堂晚上几点停止供餐？\n答：多数食堂 19:30 停止供餐，清真窗口会晚半小时。\n"
        "问：校园卡丢了怎么挂失？\n答：在校园卡自助机或微信校园卡里点挂失，再到卡务中心补办。"
    )
    if context:
        return (f"{head}\n{rules}\n只依据下面资料回答，资料没写的就换一个问题：\n{context}\n\n"
                "严格按格式输出，不要编号、不要解释：\n问：<问题>\n答：<回答>\n")
    return (f"{head}\n{rules}\n\n严格按格式输出，不要编号、不要解释：\n问：<问题>\n答：<回答>\n")


def save_snapshot(records: list[dict], path: Path, meta: dict) -> None:
    payload = {"meta": {**meta, "count": len(records)}, "qa": records}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="用本地模型整夜生成候选问答")
    parser.add_argument("--minutes", type=int, default=480, help="跑多少分钟，默认 8 小时")
    parser.add_argument("--max-pairs", type=int, default=4000)
    parser.add_argument("--out", default=str(ROOT / "data" / "candidates"))
    parser.add_argument("--endpoint", default="http://127.0.0.1:8080/v1/chat/completions")
    parser.add_argument("--model", default="qwen2.5-3b", help="llama-server 的 --alias")
    parser.add_argument("--no-web", action="store_true", help="不联网搜索，只靠本地模型")
    parser.add_argument("--search-ttl", type=int, default=7200, help="同一主题搜索结果复用秒数")
    parser.add_argument("--max-searches", type=int, default=90)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    global ENDPOINT, LOG, SEARCHES, MAX_SEARCHES, MODEL
    ENDPOINT, SEARCHES, MAX_SEARCHES, MODEL = args.endpoint, 0, args.max_searches, args.model
    random.seed(args.seed)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = f"{datetime.now():%Y%m%d}"
    jsonl_path = out_dir / f"qa-{stamp}.jsonl"
    snapshot_path = out_dir / f"qa-{stamp}.json"
    report_path = out_dir / f"report-{stamp}.md"
    LOG = (out_dir / f"nightly-{stamp}.log").open("a", encoding="utf-8")

    # 已存在的问法：库里 3 万多条别名 + 今晚新生成的
    import sqlite3
    from app import config

    db_path = config.DB_PATH
    seen: set[str] = set()
    if db_path.exists():
        db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            seen = {row[0] for row in db.execute("SELECT text_key FROM aliases WHERE status='active'")}
        finally:
            db.close()
    log(f"existing aliases: {len(seen)}; db: {db_path}", LOG)

    records: list[dict] = []
    if jsonl_path.exists():
        for line in jsonl_path.read_text(encoding="utf-8").splitlines():
            try:
                item = json.loads(line)
                records.append(item)
                seen.add(normalize(item["question"]))
            except (ValueError, KeyError):
                continue
        log(f"resumed {len(records)} records from {jsonl_path.name}", LOG)

    contexts: dict[str, tuple[float, str]] = {}
    deadline = datetime.now() + timedelta(minutes=args.minutes)
    rejected = Counter()
    calls = 0
    started = time.time()
    meta = {"source": "nightly-local-model", "model": MODEL, "endpoint": args.endpoint}

    try:
        while datetime.now() < deadline and len(records) < args.max_pairs:
            topic, detail = TOPICS[calls % len(TOPICS)]
            focus = FOCUS[(calls + random.randrange(len(FOCUS))) % len(FOCUS)]
            context = ""
            if not args.no_web:
                cached = contexts.get(topic)
                if cached and time.time() - cached[0] < args.search_ttl:
                    context = cached[1]
                else:
                    context = search_context(f"{topic} {detail} 常见问题")
                    contexts[topic] = (time.time(), context)
            count = 2 if calls % 3 else 3
            prompt = build_prompt(topic, detail, focus, context, count)
            try:
                text = chat([{"role": "user", "content": prompt}], max_tokens=240,
                            temperature=0.45 + 0.1 * (calls % 3))
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as error:
                log(f"model error: {error}", LOG)
                time.sleep(5)
                calls += 1
                continue
            calls += 1
            accepted_now = 0
            for question, answer in parse_pairs(text):
                question = re.sub(r'["“”]', "", question).strip()
                answer = answer.strip().strip('"“”').strip()
                if not question_ok(question):
                    rejected["question"] += 1
                    continue
                if not answer_ok(answer):
                    rejected["answer"] += 1
                    continue
                key = normalize(question)
                if key in seen:
                    rejected["duplicate"] += 1
                    continue
                seen.add(key)
                record = {
                    "id": f"gen-{stamp}-{len(records) + 1:05d}",
                    "category": f"本地生成/{topic}",
                    "intent": "常见问答（本地模型生成，待核对）",
                    "question": question,
                    "answer": answer,
                    "keywords": [topic],
                    "variants": [],
                    "grounded": bool(context),
                    "model": MODEL,
                    "created_at": datetime.now().isoformat(timespec="seconds"),
                }
                records.append(record)
                with jsonl_path.open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps(record, ensure_ascii=False) + "\n")
                accepted_now += 1
                if len(records) >= args.max_pairs:
                    break
            if accepted_now:
                log(f"+{accepted_now} [{len(records)}/{args.max_pairs}] {topic} · {focus}", LOG)
            if len(records) and len(records) % 20 == 0:
                save_snapshot(records, snapshot_path, meta)
            time.sleep(1.5)
    finally:
        save_snapshot(records, snapshot_path, meta)
        minutes = (time.time() - started) / 60
        by_topic = Counter(item["category"].split("/", 1)[-1] for item in records)
        report = [
            "# 夜间候选问答报告", "",
            f"- 运行时长：{minutes:.1f} 分钟",
            f"- 模型调用：{calls} 次",
            f"- 搜索次数：{SEARCHES}",
            f"- 收录问答：{len(records)} 条",
            f"- 有资料依据：{sum(1 for item in records if item['grounded'])} 条",
            f"- 过滤统计：{dict(rejected)}",
            f"- 输出：`{jsonl_path.name}` / `{snapshot_path.name}`", "",
            "## 按主题", "",
            *[f"- {name}：{count} 条" for name, count in by_topic.most_common()],
            "",
            "## 明天怎么用", "",
            "```powershell",
            f"python backend/tools/import_qa_library.py --source \"{snapshot_path}\" --scope shared --dry-run",
            f"python backend/tools/import_qa_library.py --source \"{snapshot_path}\" --scope shared",
            "```",
            "",
            "导入前建议先抽查 `qa-{0}.json` 里的答案：本地 {1} 生成的细节可能有误。".format(stamp, MODEL),
        ]
        report_path.write_text("\n".join(report), encoding="utf-8")
        log(f"done: {len(records)} records in {minutes:.1f} min -> {snapshot_path}", LOG)
        LOG.close()


if __name__ == "__main__":
    main()
