"""把中国农业大学的课程数据与校园知识库导入柒柿AI。

两种数据走两条不同的路：

- 校园知识库（481 条 FAQ 式条目）→ 问答库的问答组。标题作为原问，关键词作为等价问法，
  正文作为答案，常见问法可以 0 次云端调用直接复用。
- 课程数据（16587 行）→ 共享知识库。按「学院 / 专业 / 学期」整理成课程清单，
  在聊天里开启「共享资料」后检索原文并带引用作答。
- 学院与专业目录 → 少量高频问答 + 一份目录文档。

用法（在项目根目录）：::

    python backend/tools/import_cau_data.py \\
        --course "C:\\path\\CAU课程数据.xlsx" \\
        --knowledge "C:\\path\\CAU校园知识库.xlsx"

    --dry-run   只打印统计
    --replace   先删除此前导入的问答组与知识文档再重导
    --skip-qa / --skip-docs  只导入其中一类

脚本幂等：问答组 id 由外部编号派生（``qa_cau-...``），知识文档 id 为 ``kn_cau_...``，
重复运行不会重复写入。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import config  # noqa: E402
from app.db import connect, now_iso  # noqa: E402
from import_qa_library import build_plan, existing_group_ids, existing_keys, owner_for, write_plan  # noqa: E402

from openpyxl import load_workbook  # noqa: E402

GROUP_PREFIX = "cau-"
DOC_PREFIX = "kn_cau_"
FAQ_SHEET = "校园知识库481条"
COURSE_SHEET = "全部课程16587"
DIRECTORY_SHEET = "学院专业目录"
COMMON_COLLEGE = "〖全校通识·公共课程〗"
SEASON = {"秋": "秋", "春": "春", "夏": "夏"}
GRADE_NAMES = {1: "大一", 2: "大二", 3: "大三", 4: "大四", 5: "大五"}


# ---------------------------------------------------------------- 读表

def read_sheet(path: Path, sheet_name: str) -> tuple[list[str], list[tuple]]:
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = workbook[sheet_name] if sheet_name in workbook.sheetnames else workbook.worksheets[0]
        rows = list(sheet.iter_rows(values_only=True))
    finally:
        workbook.close()
    header = ["" if cell is None else str(cell).strip() for cell in (rows[0] if rows else [])]
    return header, rows[1:]


def text(row: tuple, index: dict[str, int], name: str) -> str:
    position = index.get(name)
    if position is None or position >= len(row):
        return ""
    value = row[position]
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


# ---------------------------------------------------------------- 问答条目

def faq_items(rows: list[tuple], header: list[str]) -> list[dict[str, Any]]:
    index = {name: position for position, name in enumerate(header)}
    items = []
    for row in rows:
        number = text(row, index, "编号")
        module = text(row, index, "模块")
        title = text(row, index, "标题")
        body = text(row, index, "正文")
        keywords = [part.strip() for part in re.split(r"[、，,;；]", text(row, index, "关键词")) if part.strip()]
        if not number or not title or not body:
            continue
        items.append({
            "id": f"{GROUP_PREFIX}faq-{number}",
            "category": "中国农业大学",
            "intent": module or "校园知识",
            "question": title,
            "answer": body,
            "keywords": ["中国农业大学", module] if module else ["中国农业大学"],
            "variants": keywords,
        })
    return items


def directory_rows(rows: list[tuple], header: list[str]) -> list[tuple[str, str]]:
    index = {name: position for position, name in enumerate(header)}
    pairs = []
    for row in rows:
        college = text(row, index, "学院")
        major = text(row, index, "专业")
        if college and major:
            pairs.append((college, major))
    return pairs


def directory_items(pairs: list[tuple[str, str]]) -> list[dict[str, Any]]:
    by_college: dict[str, list[str]] = defaultdict(list)
    for college, major in pairs:
        if major not in by_college[college]:
            by_college[college].append(major)
    colleges = [college for college in by_college if college != COMMON_COLLEGE]
    items = [{
        "id": f"{GROUP_PREFIX}dir-colleges",
        "category": "中国农业大学",
        "intent": "院系设置",
        "question": "中国农业大学有哪些学院？",
        "answer": "中国农业大学现有 " + str(len(colleges)) + " 个学院（不含全校通识公共课程）：" + "、".join(colleges) + "。",
        "keywords": ["中国农业大学", "学院"],
        "variants": ["农大有哪些学院", "中国农大有哪些学院", "学校有哪些学院", "农学院校有哪些院系", "中国农业大学学院名单"],
    }]
    for position, college in enumerate(sorted(by_college), 1):
        majors = by_college[college]
        if college == COMMON_COLLEGE:
            continue
        items.append({
            "id": f"{GROUP_PREFIX}dir-college-{position:02d}",
            "category": "中国农业大学",
            "intent": "院系设置",
            "question": f"{college}有哪些专业？",
            "answer": f"{college}开设 {len(majors)} 个专业：" + "、".join(majors) + "。",
            "keywords": ["中国农业大学", college],
            "variants": [f"{college}的专业", f"{college}开设什么专业", f"{college}有什么专业", f"{college}专业有哪些"],
        })
    return items


# ---------------------------------------------------------------- 课程整理

def grade_label(term: str) -> str:
    matched = re.fullmatch(r"([1-5])\s*([秋春夏])", term)
    if not matched:
        return term
    grade = GRADE_NAMES.get(int(matched.group(1)), matched.group(1))
    return f"{grade}{SEASON[matched.group(2)]}（{term}）"


def compact_schedule(raw: str) -> str:
    if not raw:
        return ""
    slots = []
    for matched in re.finditer(r"[（(]([^）)]*?周[^）)]*?)[）)]\s*[（(]星期([一二三四五六日天])[）)]\s*([0-9,\-]+)节", raw):
        day = "周" + matched.group(2).replace("天", "日")
        slot = f"{day}{matched.group(3)}节"
        if slot not in slots:
            slots.append(slot)
    if slots:
        return "、".join(slots)
    return raw.split(";")[0][:24]


def compact_location(raw: str) -> str:
    seen = []
    for part in re.split(r"[;；]", raw):
        part = part.strip()
        if part and part not in seen:
            seen.append(part)
    return "、".join(seen)[:40]


def course_blocks(rows: list[tuple], header: list[str]) -> dict[str, list[dict[str, str]]]:
    """按学院归类，把同一门课的多条开课记录合并成一行。"""
    index = {name: position for position, name in enumerate(header)}
    collected: dict[str, dict[tuple[str, str], dict[str, dict[str, list[str]]]]] = defaultdict(dict)
    for row in rows:
        college = text(row, index, "学院")
        major = text(row, index, "专业") or "不限专业"
        term = text(row, index, "修读学期")
        course = text(row, index, "课程名称")
        if not college or not course or course in {"课程名称"} or term in {"课程名称", "课程编号(教务)"}:
            continue
        entry = collected[college].setdefault((major, term or "未标注学期"), {})
        key = "；".join((
            course, text(row, index, "课程类别"),
            (text(row, index, "学分") + "学分") if text(row, index, "学分") else "",
            (text(row, index, "学时") + "学时") if text(row, index, "学时") else "",
        ))
        detail = entry.setdefault(key, {"teachers": [], "campuses": [], "slots": [], "places": []})
        for field, value in (
            ("teachers", text(row, index, "授课教师")),
            ("campuses", text(row, index, "校区")),
            ("slots", compact_schedule(text(row, index, "上课时间"))),
            ("places", compact_location(text(row, index, "上课地点"))),
        ):
            if value and value not in detail[field]:
                detail[field].append(value)

    output: dict[str, list[dict[str, str]]] = {}
    for college, groups in collected.items():
        chunks: list[dict[str, str]] = []
        for major in sorted({key[0] for key in groups}):
            terms = [key[1] for key in groups if key[0] == major]
            for term in terms:
                entry = groups[(major, term)]
                lines = [_course_line(key, detail) for key, detail in entry.items()]
                if not lines:
                    continue
                label = grade_label(term) if term != "未标注学期" else "未标注学期"
                heading = f"{college} {major} 的课程（{label}），共 {len(lines)} 门。"
                chunks.extend(split_chunk(heading, lines, location=f"{major} · {label}"))
        output[college] = chunks
    return output


def _course_line(key: str, detail: dict[str, list[str]]) -> str:
    parts = [key]
    if detail["teachers"]:
        parts.append("教师：" + "、".join(detail["teachers"][:6]))
    if detail["campuses"]:
        parts.append("校区：" + "、".join(detail["campuses"][:3]))
    if detail["slots"]:
        parts.append("上课：" + "、".join(detail["slots"][:4]))
    if detail["places"]:
        parts.append("地点：" + "、".join(detail["places"][:3]))
    return " ".join(part for part in parts if part)


def split_chunk(heading: str, lines: list[str], *, location: str,
                limit: int = 900) -> list[dict[str, str]]:
    """把一门课一行拼成不超过 limit 字符的块，续块带「续」。"""
    chunks: list[dict[str, str]] = []
    buffer: list[str] = []
    size = len(heading) + 1
    for line in lines:
        if buffer and size + len(line) + 1 > limit:
            chunks.append({"location": location if not chunks else f"{location}（续 {len(chunks) + 1}）",
                           "excerpt": "\n".join([heading, *buffer])})
            buffer = []
            size = len(heading) + 1
        buffer.append(line)
        size += len(line) + 1
    if buffer:
        chunks.append({"location": location if not chunks else f"{location}（续 {len(chunks) + 1}）",
                       "excerpt": "\n".join([heading, *buffer])})
    return chunks


def faq_chunks(rows: list[tuple], header: list[str]) -> list[dict[str, str]]:
    index = {name: position for position, name in enumerate(header)}
    chunks = []
    for row in rows:
        number = text(row, index, "编号")
        module = text(row, index, "模块")
        title = text(row, index, "标题")
        body = text(row, index, "正文")
        keywords = text(row, index, "关键词")
        if not title or not body:
            continue
        chunks.append({
            "location": f"{number} · {module}" if module else number,
            "excerpt": f"中国农业大学 {module}：{title}\n关键词：{keywords}\n{body}",
        })
    return chunks


def directory_chunk(pairs: list[tuple[str, str]]) -> dict[str, str]:
    by_college: dict[str, list[str]] = defaultdict(list)
    for college, major in pairs:
        by_college[college].append(major)
    lines = [f"中国农业大学院系与专业目录，共 {len([c for c in by_college if c != COMMON_COLLEGE])} 个学院、{len(pairs)} 个专业。"]

    for college in sorted(by_college):
        majors = by_college[college]
        if college == COMMON_COLLEGE:
            continue
        lines.append(f"{college}（{len(majors)} 个专业）：" + "、".join(majors))
    return {"location": "院系与专业目录", "excerpt": "\n".join(lines)}


# ---------------------------------------------------------------- 写库

def write_documents(db, documents: list[dict[str, Any]]) -> dict[str, int]:
    counters = Counter()
    timestamp = now_iso()
    for document in documents:
        chunks_json = json.dumps(document["chunks"], ensure_ascii=False)
        db.execute("DELETE FROM knowledge_documents WHERE id=?", (document["id"],))
        db.execute(
            """INSERT INTO knowledge_documents(id,name,size,chunks_json,active,created_at)
               VALUES(?,?,?,?,1,?)""",
            (document["id"], document["name"], len(chunks_json.encode("utf-8")), chunks_json, timestamp),
        )
        counters["documents"] += 1
        counters["chunks"] += len(document["chunks"])
    return dict(counters)


def delete_imported(db) -> tuple[int, int]:
    groups = db.execute("SELECT id FROM groups WHERE id GLOB ?", (f"qa_{GROUP_PREFIX}*",)).fetchall()
    for row in groups:
        db.execute("DELETE FROM groups WHERE id=?", (row["id"],))
    documents = db.execute("SELECT id FROM knowledge_documents WHERE id GLOB ?", (f"{DOC_PREFIX}*",)).fetchall()
    for row in documents:
        db.execute("DELETE FROM knowledge_documents WHERE id=?", (row["id"],))
    return len(groups), len(documents)


def main() -> int:
    parser = argparse.ArgumentParser(description="导入中国农业大学课程数据与校园知识库")
    parser.add_argument("--course", default=None, help="CAU课程数据.xlsx")
    parser.add_argument("--knowledge", default=None, help="CAU校园知识库.xlsx")
    parser.add_argument("--db", default=None, help="目标数据库")
    parser.add_argument("--scope", default="shared", choices=("shared", "personal"))
    parser.add_argument("--owner", default="u-a")
    parser.add_argument("--replace", action="store_true", help="先删除此前导入的问答组与知识文档")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-qa", action="store_true", help="不导入问答库条目")
    parser.add_argument("--skip-docs", action="store_true", help="不导入共享知识库文档")
    parser.add_argument("--no-backup", action="store_true")
    args = parser.parse_args()

    if not args.course and not args.knowledge:
        raise SystemExit("至少提供 --course 或 --knowledge 其中一个。")
    if args.db:
        config.DB_PATH = Path(args.db)
        config.DATA_DIR = config.DB_PATH.parent
    if not Path(config.DB_PATH).exists():
        raise SystemExit(f"找不到数据库：{config.DB_PATH}")

    items: list[dict[str, Any]] = []
    documents: list[dict[str, Any]] = []

    if args.knowledge and not args.skip_qa:
        header, rows = read_sheet(Path(args.knowledge), FAQ_SHEET)
        faq = faq_items(rows, header)
        items.extend(faq)
        print(f"校园知识库：{len(rows)} 行 → {len(faq)} 条问答（关键词 {sum(len(i['variants']) for i in faq)} 个）")
    elif args.knowledge and args.skip_qa:
        header, rows = read_sheet(Path(args.knowledge), FAQ_SHEET)

    if args.course:
        course_header, course_rows = read_sheet(Path(args.course), COURSE_SHEET)
        directory_header, directory_data = read_sheet(Path(args.course), DIRECTORY_SHEET)
        pairs = directory_rows(directory_data, directory_header)
        if not args.skip_qa:
            items.extend(directory_items(pairs))
        if not args.skip_docs:
            documents.append({
                "id": f"{DOC_PREFIX}directory",
                "name": "中国农业大学 · 院系与专业目录",
                "chunks": [directory_chunk(pairs)],
            })
            blocks = course_blocks(course_rows, course_header)
            for position, (college, chunks) in enumerate(sorted(blocks.items()), 1):
                documents.append({
                    "id": f"{DOC_PREFIX}course-{position:02d}",
                    "name": f"中国农业大学 · 课程数据 · {college}",
                    "chunks": chunks,
                })
            print(f"课程数据：{len(course_rows)} 行 → {len(blocks)} 个文档，"
                  f"{sum(len(doc['chunks']) for doc in documents)} 个段落")
        else:
            blocks = {}

    if args.knowledge and not args.skip_docs:
        documents.append({
            "id": f"{DOC_PREFIX}faq",
            "name": "中国农业大学 · 校园知识库（481 条）",
            "chunks": faq_chunks(rows, header),
        })

    db = connect()
    try:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='groups'").fetchone():
            raise SystemExit("目标数据库还没有初始化，先启动一次服务。")
        owner = owner_for(db, args.owner)
        plan = build_plan(
            items, taken=existing_keys(db), imported=existing_group_ids(db),
            owner=owner, scope=args.scope, timestamp=now_iso(),
        ) if items else {"groups": [], "skipped_existing": [], "skipped_duplicate": [],
                         "skipped_invalid": [], "variant_conflicts": []}
        existing_documents = {row["id"] for row in db.execute("SELECT id FROM knowledge_documents").fetchall()}
    finally:
        db.close()

    groups = plan["groups"]
    new_documents = [doc for doc in documents if doc["id"] not in existing_documents]
    chunks = sum(len(doc["chunks"]) for doc in new_documents)
    characters = sum(len(chunk["excerpt"]) for doc in new_documents for chunk in doc["chunks"])
    print(f"入库计划：问答组 {len(groups)} 个（问法 {sum(len(g['aliases']) for g in groups)} 条）、"
          f"知识文档 {len(new_documents)} 份（{chunks} 段、{characters / 10000:.1f} 万字符）")
    for key, label in (("skipped_existing", "已存在问答组"), ("skipped_duplicate", "重复问法"),
                       ("variant_conflicts", "冲突等价问法"), ("skipped_invalid", "无效条目")):
        if plan[key]:
            print(f"  跳过{label}：{len(plan[key])}")

    if args.dry_run:
        print("（--dry-run，未写入数据库）")
        return 0

    if not args.no_backup:
        from import_qa_library import backup_database
        backup = backup_database(prefix="cau-import")
        if backup:
            print(f"已备份数据库：{backup}")

    if args.replace:
        db = connect()
        try:
            removed_groups, removed_documents = delete_imported(db)
            db.commit()
        finally:
            db.close()
        print(f"已清理旧导入：{removed_groups} 个问答组、{removed_documents} 份文档")
        db = connect()
        try:
            plan = build_plan(items, taken=existing_keys(db), imported=existing_group_ids(db),
                              owner=owner, scope=args.scope, timestamp=now_iso()) if items else plan
            groups = plan["groups"]
            existing_documents = {row["id"] for row in db.execute("SELECT id FROM knowledge_documents").fetchall()}
        finally:
            db.close()
        new_documents = [doc for doc in documents if doc["id"] not in existing_documents]

    started = time.perf_counter()
    if groups:
        counters = write_plan(plan)
        print(f"写入问答组：{counters.get('groups', 0)} 个，"
              f"问法 {counters.get('original', 0) + counters.get('seed', 0)} 条")
    if new_documents:
        db = connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            counters = write_documents(db, new_documents)
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
        print(f"写入知识文档：{counters['documents']} 份，{counters['chunks']} 段")
    print(f"完成，用时 {time.perf_counter() - started:.2f} 秒")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
