import json
import math
from collections import Counter

from .documents import search_terms


MAX_KNOWLEDGE_FILES = 30
_COMMON = {"请问", "什么", "怎么", "如何", "可以", "告诉", "资料", "共享", "查找", "一下", "这个", "一个"}


def search_knowledge(db, query: str, *, minimum_score: float = 0.0) -> list[dict]:
    """在共享知识库里找与问题最相关的段落。

    打分用 IDF 加权的覆盖度：每个查询词按「全库出现段落数」取对数权重，
    再把命中词的权重之和除以全部查询词的权重之和，得到 0–1 之间的覆盖度。
    这样罕见的偶然词组不会因为出现次数少就被放大，覆盖问题更多的段落排前面。

    ``minimum_score`` 用来判断资料是否真的覆盖了这个问题：自动兜底时低于门槛就当作没找到，
    显式选择「共享资料」时传 0，避免资料不全时反而不给原文。
    """
    terms = search_terms(query) - _COMMON
    if not terms:
        return []
    documents = [
        (row, json.loads(row["chunks_json"]))
        for row in db.execute(
            "SELECT id,name,chunks_json FROM knowledge_documents WHERE active=1 ORDER BY created_at DESC,id"
        )
    ]
    if not documents:
        return []
    entries: list[tuple[object, dict, set[str]]] = []
    frequencies: Counter[str] = Counter()
    for row, chunks in documents:
        for chunk in chunks:
            matched = terms & search_terms(chunk["excerpt"])
            entries.append((row, chunk, matched))
            frequencies.update(matched)
    if not frequencies:
        return []

    total = sum(len(chunks) for _, chunks in documents)
    weights = {term: math.log(1 + total / (1 + frequencies[term])) for term in terms}
    denominator = sum(weights.values()) or 1.0

    ranked = []
    for row, chunk, matched in entries:
        if not matched:
            continue
        coverage = sum(weights[term] for term in matched) / denominator
        title_hits = terms & search_terms(row["name"])
        bonus = 0.15 * sum(weights[term] for term in title_hits) / denominator
        ranked.append((coverage + bonus, len(matched), row, chunk))
    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)

    sources = []
    document_uses: Counter[str] = Counter()
    for score, _, row, chunk in ranked:
        if score < minimum_score:
            break
        if document_uses[row["id"]] >= 2:
            continue
        document_uses[row["id"]] += 1
        sources.append({"number": len(sources) + 1, "document_id": row["id"], "title": row["name"],
                        "score": round(score, 3), **chunk})
        if len(sources) == 5:
            break
    return sources
