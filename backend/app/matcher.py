from __future__ import annotations

import re
import time
import unicodedata
import math
from collections import Counter
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import Any

from . import config
from .db import as_json, now_iso


PLATFORM = re.compile(
    r"(?<![a-z])(?:python|excel|wps|macos|mac|windows|linux|react|ios|android|javascript|typescript)(?![a-z])|苹果电脑",
    re.I,
)
PLATFORM_NAMES = {"macos": "mac", "苹果电脑": "mac"}
CODE_FORM = re.compile(
    r"(?<![a-z_0-9])[a-z_]\w*\s*\((?:\([^()\n]*\)|[^()\n])*\)|\[[^\[\]\n]*\]",
    re.I | re.ASCII,
)
CODE_TOKEN = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[^"\'\s]+')
NUMBER = re.compile(r"(?<![a-z0-9_.])[-+]?\d+(?:\.\d+)?", re.I | re.ASCII)
PLATFORM_VERSION = re.compile(r"(?<![a-z])(?:python|react|excel|macos|windows)\s*v?\s*(\d+(?:\.\d+)*)", re.I)
QUANTITY = re.compile(r"(单|一|两|二|三|四|五|六|七|八|九|十|\d+)(?:个(?:应用)?)?(行|列|窗口)")
QUANTITY_VALUES = dict(zip("单一两二三四五六七八九十", (1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10)))
LANGUAGE = r"(?:英语|英文|日语|日文|韩语|韩文|法语|法文|德语|德文|俄语|俄文|西班牙语|葡萄牙语|中文|汉语)"
OUTPUT_REQUEST = re.compile(
    rf"(?:用|以){LANGUAGE}(?:回答|解释|输出|说明|作答)?"
    rf"|{LANGUAGE}(?:回答|解释|输出|说明|作答)|in (?:english|japanese|chinese)|english answer"
    r"|(?:只|仅)(?:需|要)?(?:给出?|返回|输出|提供)(?:公式|代码|结果|答案|结论)|(?:json|csv|表格)格式",
    re.I,
)
NEGATION = re.compile(r"不(?!同|仅|止|过)|没有|禁止|除非|\b(?:not|never|without)\b", re.I)
SCOPE_TERMS = re.compile(
    r"非空|不为空|有元素|空(?:字典|元组|集合|字符串)|求和|相加|合并单元格|去重|(?:跳过|忽略)空"
    r"|全屏|整个屏幕|一个屏幕|指定区域|录屏|录制|阴影|透明背景"
    r"|共同点|(?:执行|运行)顺序|缺点|搭配|(?<!\w)use[A-Z]\w*"
)
SEARCH_REWRITES = (
    (r"macos|苹果电脑", "mac"),
    (r"(?<=[a-z0-9])\s*(?:的|里|上|中)(?=[\u4e00-\u9fff])", ""),
    (r"^(?:请问|请|解释|说明)|原因是什么|为什么$|是什么$|是什么意思$", ""),
    (r"有什么(?:区别|不同)|怎么区分|用途差异|各有什么用|分别有什么用", "区别"),
    (r"如何|怎样|怎么", ""),
    (r"空的列表|列表为空", "空列表"),
    (r"布尔值(?:是)?(?:\s*true\s*还是\s*false)?|(?:会)?(?:被?判断为|当成|判为)?真还是假", "真假"),
    (r"if\s*(?:语句|条件)?(?:下|遇到)?|条件判断", ""),
    (r"拼接到|拼接成|拼成|合为|合并成|连接成", "合并成"),
    (r"单个(?:应用)?窗口", "一个窗口"),
    (r"截取|截屏", "截图"),
    (r"给一个窗口截图", "截图一个窗口"),
    (r"截图一个窗口的截图", "截图一个窗口"),
    (r"(?<=[a-z])\s*与\s*(?=[a-z])", "和"),
)


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    return "".join(char for char in text if char.isalnum())


@lru_cache(maxsize=4096)
def _ngrams(text: str) -> Counter[str]:
    compact = normalize(text)
    return Counter(compact[index:index + 2] for index in range(max(0, len(compact) - 1)))


def _similarity(left: str, right: str) -> tuple[float, float]:
    a, b = _ngrams(left), _ngrams(right)
    common = sum((a & b).values())
    total = sum((a | b).values()) or 1
    lexical = common / total
    # 调用方只在 lexical >= 0.30 时才让序列相似度计分；算它之前先跳过昂贵的比对。
    sequence = SequenceMatcher(None, normalize(left), normalize(right)).ratio() if lexical >= 0.30 else 0.0
    return lexical, sequence


@lru_cache(maxsize=1)
def _embedding_model():
    if not config.EMBEDDING_MODEL_PATH or not Path(config.EMBEDDING_MODEL_PATH).is_dir():
        return None
    try:
        from sentence_transformers import SentenceTransformer
        return SentenceTransformer(config.EMBEDDING_MODEL_PATH, device="cpu", local_files_only=True)
    except Exception:
        return None


@lru_cache(maxsize=1)
def _reranker_model():
    if not config.RERANKER_MODEL_PATH or not Path(config.RERANKER_MODEL_PATH).is_dir():
        return None
    try:
        from sentence_transformers import CrossEncoder
        return CrossEncoder(config.RERANKER_MODEL_PATH, device="cpu", local_files_only=True)
    except Exception:
        return None


def _embedding_score(left: str, right: str) -> float | None:
    model = _embedding_model()
    if model is None:
        return None
    try:
        vectors = model.encode([left, right], normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
        return float(vectors[0] @ vectors[1])
    except Exception:
        return None


def _pair_score(query: str, corpus: str) -> float | None:
    model = _reranker_model()
    if model is None:
        return None
    try:
        result = model.predict([(query, corpus)], show_progress_bar=False)
        value = float(result[0])
        if value < 0 or value > 1:
            value = 1 / (1 + math.exp(-max(-30, min(30, value))))
        return value
    except Exception:
        return None


def _code_signature(text: str) -> set[str]:
    # Keep brackets and operators. The alias index pre-dates this check and ignores punctuation.
    text = unicodedata.normalize("NFKC", text)
    forms = CODE_FORM.findall(text)
    forms.extend(snippet for snippet in re.findall(r"`([^`\n]+)`", text) if re.search(r"[+\-*/%=<>!&|]", snippet))
    return {"".join(CODE_TOKEN.findall(form)) for form in forms}


def _numbers(text: str) -> set[str]:
    versions = set(PLATFORM_VERSION.findall(text))
    return set(NUMBER.findall(text)) | versions


def exact_conditions(text: str) -> tuple[set[str], set[str]]:
    text = unicodedata.normalize("NFKC", text)
    return _code_signature(text), _numbers(text)


def _platforms(text: str) -> set[str]:
    return {PLATFORM_NAMES.get(term, term) for term in PLATFORM.findall(text.casefold())}


def _quantities(text: str) -> list[tuple[int, str]]:
    return [(int(value) if value.isdigit() else QUANTITY_VALUES[value], unit) for value, unit in QUANTITY.findall(text)]


def _conflicts(query: str, record: dict[str, Any]) -> list[str]:
    conflicts: list[str] = []
    query = unicodedata.normalize("NFKC", query)
    original = unicodedata.normalize("NFKC", record["original"])
    if _code_signature(query) - _code_signature(original):
        conflicts.append("代码片段或输入值变化")

    quantities, original_quantities = _quantities(query), _quantities(original)
    quantity_mismatch = set(quantities) - set(original_quantities) or (
        len(quantities) == len(original_quantities) and quantities != original_quantities
    )
    if _numbers(query) - _numbers(original) or quantity_mismatch:
        conflicts.append("数值或版本条件变化")

    query_lower = query.lower()
    if set(OUTPUT_REQUEST.findall(query_lower)) - set(OUTPUT_REQUEST.findall(original.lower())):
        conflicts.append("输出语言或格式变化")

    if bool(NEGATION.search(query)) != bool(NEGATION.search(original)):
        conflicts.append("否定条件变化")

    entities = as_json(record.get("entities_json"), []) or []
    known = _platforms(" ".join([original, *entities]))
    if _platforms(query) - known:
        conflicts.append("对象或平台变化")
    if set(SCOPE_TERMS.findall(query)) - set(SCOPE_TERMS.findall(original)):
        conflicts.append("任务或适用范围变化")
    elif ("bool([])" in _code_signature(original) or "空列表" in original) and "列表" in query:
        if not re.search(r"空(?:的)?列表|列表(?:为|是)空|没有元素的列表", query):
            conflicts.append("列表的适用条件不明确")
    return conflicts


@lru_cache(maxsize=8192)
def _search_text(text: str) -> str:
    """归一化问法，用于相似度比较。纯函数，可安全缓存。"""
    text = unicodedata.normalize("NFKC", text).casefold()
    for pattern, replacement in SEARCH_REWRITES:
        text = re.sub(pattern, replacement, text)
    return normalize(text)


def _concept_score(query: str, record: dict[str, Any]) -> float:
    original = record["original"]
    # A previous semantic hit can be reused exactly but is not evidence for further paraphrases.
    aliases = [row["text"] for row in record["aliases"] if row["source"] != "observed"]
    phrases = [original, record["intent"], *aliases]
    query_text = _search_text(query)
    score = 0.0
    for phrase in phrases:
        if not phrase:
            continue
        lexical, sequence = _similarity(query_text, _search_text(phrase))
        score = max(score, lexical, sequence * 0.90 if lexical >= 0.30 else 0.0)
    vector_score = _embedding_score(query, " ".join(phrases))
    if vector_score is not None:
        score = max(score, vector_score)
    return min(score, 1.0)


def _target_key(group_id: str, version_id: str | None, match_key: str | None) -> str:
    if match_key:
        return f"g:{group_id}:m:{normalize(match_key)}"
    return f"g:{group_id}:v:{version_id or ''}"


def _blocked(db, user_id: str, group_id: str, version_id: str | None, match_key: str | None) -> str | None:
    target = _target_key(group_id, version_id, match_key)
    row = db.execute(
        """SELECT reason FROM suspensions WHERE status='active' AND group_id=? AND
           (kind='group' OR (kind='version' AND version_id=?) OR
            (kind='match' AND match_key=? AND (version_id=? OR version_id IS NULL))) LIMIT 1""",
        (group_id, version_id, normalize(match_key) if match_key else None, version_id),
    ).fetchone()
    if row:
        return row["reason"] or "该答案或问法已暂停复用"
    report = db.execute(
        """SELECT 1 FROM reports WHERE by_user_id=? AND status='open' AND
           ((category='fact' AND target_key=?) OR
            (category='mismatch' AND target_key=? AND (version_id=? OR version_id IS NULL))) LIMIT 1""",
        (user_id, _target_key(group_id, version_id, None), target, version_id),
    ).fetchone()
    if report:
        return "你已报告过这条结果，本次为你绕开该匹配"
    return None


_VISIBLE_SQL = """FROM groups g
    JOIN group_versions v ON v.id=g.current_version_id AND v.status='published'
    WHERE g.status='active' AND ((g.scope='shared' AND EXISTS (
      SELECT 1 FROM library_members lm WHERE lm.user_id=? AND lm.library_id='QS-2048'))
      OR (g.scope='personal' AND g.owner_id=?))
      AND (CASE WHEN ? THEN g.review_at<=? ELSE g.review_at IS NULL OR g.review_at>? END)"""

# 问答库上万条之后，逐条算相似度太慢。按字符二元组建一次倒排索引并缓存，
# 查询时只对「有共同片段」的候选打分；问答库或问法变化时签名变化自动重建。
_INDEX_TTL = 600.0
_INDEX_CACHE: dict[tuple[str, bool], dict[str, Any]] = {}


def _gram_set(text: str) -> set[str]:
    chars = [char for char in text if not char.isspace()]
    if len(chars) <= 1:
        return set(chars)
    return {left + right for left, right in zip(chars, chars[1:])}


def _load_index(db, user_id: str, expired: bool) -> dict[str, Any]:
    signature = db.execute(
        "SELECT (SELECT COUNT(*) FROM groups) AS groups, (SELECT COUNT(*) FROM aliases) AS aliases,"
        " (SELECT COUNT(*) FROM library_members) AS members, (SELECT MAX(updated_at) FROM groups) AS updated"
    ).fetchone()
    stamp = (signature["groups"], signature["aliases"], signature["members"], signature["updated"] or "")
    key = (user_id, expired)
    cached = _INDEX_CACHE.get(key)
    now = time.monotonic()
    if cached and cached["stamp"] == stamp and now - cached["at"] < _INDEX_TTL:
        return cached

    timestamp = now_iso()
    rows = db.execute(f"SELECT g.*, v.answer, v.id AS version_id, v.n AS version_n {_VISIBLE_SQL}",
                      (user_id, user_id, expired, timestamp, timestamp)).fetchall()
    aliases_by_group: dict[str, list[dict[str, Any]]] = {}
    for alias in db.execute("SELECT group_id,text,text_key,source FROM aliases WHERE status='active'"):
        aliases_by_group.setdefault(alias["group_id"], []).append(dict(alias))

    records: list[dict[str, Any]] = []
    grams: list[set[str]] = []
    index: dict[str, list[int]] = {}
    for row in rows:
        record = dict(row)
        record["aliases"] = aliases_by_group.get(record["id"], [])
        phrases = [record["original"], record["intent"] or "",
                   *(alias["text"] for alias in record["aliases"] if alias["source"] != "observed")]
        record_grams = _gram_set(_search_text(" ".join(phrases)))
        for gram in record_grams:
            index.setdefault(gram, []).append(len(records))
        records.append(record)
        grams.append(record_grams)

    entry = {"stamp": stamp, "at": now, "records": records, "grams": grams, "index": index}
    if len(_INDEX_CACHE) >= 4:
        _INDEX_CACHE.pop(next(iter(_INDEX_CACHE)))
    _INDEX_CACHE[key] = entry
    return entry


def _prefilter(query: str, entry: dict[str, Any], limit: int = 200) -> list[int]:
    query_grams = _gram_set(_search_text(query))
    if not query_grams:
        return list(range(len(entry["records"])))
    counts: Counter[int] = Counter()
    for gram in query_grams:
        for position in entry["index"].get(gram, ()):
            counts[position] += 1
    if not counts:
        return []
    return [position for position, _ in counts.most_common(limit)]

_EXACT_SQL = """SELECT g.*, v.answer, v.id AS version_id, v.n AS version_n,
       a.text AS alias_text, a.source AS alias_source
    FROM aliases a
    JOIN groups g ON g.id=a.group_id
    JOIN group_versions v ON v.id=g.current_version_id AND v.status='published'
    WHERE a.status='active' AND a.text_key=? AND g.status='active'
      AND ((g.scope='shared' AND EXISTS (
        SELECT 1 FROM library_members lm WHERE lm.user_id=? AND lm.library_id='QS-2048'))
        OR (g.scope='personal' AND g.owner_id=?))
      AND (CASE WHEN ? THEN g.review_at<=? ELSE g.review_at IS NULL OR g.review_at>? END)"""


def _visible_count(db, user_id: str, expired: bool, timestamp: str) -> int:
    return db.execute(f"SELECT count(*) {_VISIBLE_SQL}",
                      (user_id, user_id, expired, timestamp, timestamp)).fetchone()[0]


def _exact_matches(db, query: str, user_id: str, expired: bool,
                   exact_key: str, query_conditions: tuple[set[str], set[str]],
                   timestamp: str) -> list[tuple[dict[str, Any], str]]:
    """精确问法命中。走 aliases.text_key 索引，问答库再大也只读命中的那几行。"""
    rows = db.execute(_EXACT_SQL, (exact_key, user_id, user_id, expired, timestamp, timestamp)).fetchall()
    matches: dict[str, tuple[dict[str, Any], str]] = {}
    for row in rows:
        item = dict(row)
        alias_text = item.pop("alias_text")
        alias_source = item.pop("alias_source")
        if exact_conditions(alias_text) != query_conditions:
            continue
        # 观察来的问法要再确认条件没有冲突，否则可能把不同问题当同一问。
        if alias_source == "observed" and _conflicts(query, item):
            continue
        via = "exact" if normalize(item["original"]) == exact_key else "alias"
        known = matches.get(item["id"])
        if known is None or (via == "exact" and known[1] != "exact"):
            matches[item["id"]] = (item, via)
    return list(matches.values())


def analyze(db, query: str, user_id: str, threshold: float | None = None, *,
            expired: bool = False) -> dict[str, Any]:
    threshold = threshold if threshold is not None else config.MATCH_THRESHOLD
    exact_key = normalize(query)
    query_conditions = exact_conditions(query)
    timestamp = now_iso()
    exact = _exact_matches(db, query, user_id, expired, exact_key, query_conditions, timestamp)

    blocked: list[dict[str, str]] = []
    if exact:
        if len(exact) == 1:
            record, via = exact[0]
            reason = _blocked(db, user_id, record["id"], record["version_id"], query)
            if not reason:
                return {"chosen": record, "match_type": via, "shortlist": [], "blocked": [],
                        "visible_count": _visible_count(db, user_id, expired, timestamp), "threshold": threshold}
            blocked.append({"group_id": record["id"], "kind": "bypass", "reason": reason})
        else:
            blocked.append({"group_id": exact[0][0]["id"], "kind": "ambiguous", "reason": "问法对应多条记录"})
        return {"chosen": None, "match_type": "none", "shortlist": [], "blocked": blocked,
                "visible_count": _visible_count(db, user_id, expired, timestamp), "threshold": threshold}

    entry = _load_index(db, user_id, expired)
    records = entry["records"]

    candidates: list[dict[str, Any]] = []
    for position in _prefilter(query, entry):
        item = records[position]
        if (item.get("source") or "").startswith("github-release:"):
            continue
        conflicts = _conflicts(query, item)
        if conflicts:
            continue
        score = _concept_score(query, item)
        candidates.append({"record": item, "score": score, "conflicts": conflicts})

    candidates.sort(key=lambda candidate: candidate["score"], reverse=True)
    eligible = []
    for candidate in candidates[:5]:
        if candidate["score"] < threshold:
            break
        item = candidate["record"]
        pair_score = _pair_score(query, item["intent"] or item["original"])
        if pair_score is not None and pair_score < threshold:
            continue
        if pair_score is not None:
            candidate["score"] = min(candidate["score"], pair_score)
        reason = _blocked(db, user_id, item["id"], item["version_id"], query)
        if reason:
            blocked.append({"group_id": item["id"], "kind": "suspended", "reason": reason})
            continue
        eligible.append(candidate)

    chosen: dict[str, Any] | None = None
    match_type = "none"
    eligible.sort(key=lambda candidate: candidate["score"], reverse=True)
    if not blocked and eligible and (len(eligible) == 1 or eligible[0]["score"] - eligible[1]["score"] >= 0.09):
        chosen = eligible[0]["record"]
        match_type = "semantic"
        candidates = [eligible[0], *(item for item in candidates if item is not eligible[0])]
    shortlist = [
        {"group_id": candidate["record"]["id"], "score": round(candidate["score"], 3),
         "conflicts": candidate["conflicts"]}
        for candidate in candidates[:5]
    ]
    return {"chosen": chosen, "match_type": match_type, "shortlist": shortlist,
            "blocked": blocked, "visible_count": len(records), "threshold": threshold}
