import re
import unicodedata

from fastapi import HTTPException

from .db import now_iso
from .engine import uid


MAX_MEMORIES = 30
MAX_MEMORY_LENGTH = 400
_COMMON_TERMS = {"可以", "什么", "怎么", "怎样", "如何", "帮我", "请问", "需要", "这个", "一个", "给我", "一些"}


def list_memories(db, user_id: str) -> list[dict]:
    return [dict(row) for row in db.execute(
        "SELECT id,content,updated_at FROM personal_memories WHERE user_id=? ORDER BY updated_at DESC, id",
        (user_id,),
    )]


def clean_memory(value: str) -> str:
    content = " ".join(value.split())
    if not 1 <= len(content) <= MAX_MEMORY_LENGTH or any(ord(char) < 32 for char in content):
        raise HTTPException(422, f"请填写 1 到 {MAX_MEMORY_LENGTH} 个字符的个人记忆。")
    return content


def add_memory(db, user_id: str, value: str) -> dict:
    content = clean_memory(value)
    memories = list_memories(db, user_id)
    existing = next((item for item in memories if item["content"] == content), None)
    if existing:
        return existing
    if len(memories) >= MAX_MEMORIES:
        raise HTTPException(409, f"最多可保存 {MAX_MEMORIES} 条个人记忆。")
    memory_id, timestamp = uid("mem"), now_iso()
    db.execute("INSERT INTO personal_memories(id,user_id,content,updated_at) VALUES(?,?,?,?)",
               (memory_id, user_id, content, timestamp))
    return {"id": memory_id, "content": content, "updated_at": timestamp}


def _terms(value: str) -> set[str]:
    words = re.findall(r"[a-z0-9]{2,}|[\u3400-\u9fff]{2,}",
                       unicodedata.normalize("NFKC", value).casefold())
    terms = set()
    for word in words:
        if word[0].isascii():
            terms.add(word)
        else:
            terms.update(word[index:index + 2] for index in range(len(word) - 1))
    return terms - _COMMON_TERMS


def asks_personal_context(question: str) -> bool:
    return bool(re.search(
        r"(?:我的|我(?:平时|常用|习惯))\s*(?:昵称|名字|称呼|偏好|习惯|语言|风格|设备|方案|要求)"
        r"|(?:按|根据|结合|沿用)我(?:的|平时|常用|习惯|偏好)"
        r"|我(?:常用|平时用|习惯用|偏好)什么|我叫什么", question))


def relevant_memories(db, user_id: str, question: str) -> list[str]:
    terms = _terms(question)
    rated = [(len(terms & _terms(row["content"])), row["content"]) for row in list_memories(db, user_id)]
    rated.sort(key=lambda item: item[0], reverse=True)
    minimum = 1 if asks_personal_context(question) else 2
    return [text for score, text in rated if score >= minimum][:3]
