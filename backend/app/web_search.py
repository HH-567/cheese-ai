from __future__ import annotations

import html
import json
import re
from typing import TypedDict
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener

from . import config
from .sources import NoRedirect


class WebSource(TypedDict):
    number: int
    title: str
    url: str
    excerpt: str


class WebSearchError(RuntimeError):
    pass


def search_provider() -> str:
    return "Brave Search" if config.SEARCH_PROVIDER == "brave" else "百度"


def search_results_link(query: str) -> str | None:
    if config.SEARCH_PROVIDER == "brave":
        return None
    return "https://www.baidu.com/s?" + urlencode({"wd": query})


def _text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(html.unescape(re.sub(r"<[^>]*>", "", value)).split())[:limit]


def _search_json(url: str, headers: dict[str, str], body: dict | None = None) -> dict:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    request = Request(url, data=data, headers={
        "User-Agent": "QishiAI/1.0 (user-requested citation search)",
        "Accept": "application/json",
        **headers,
    })
    with build_opener(NoRedirect()).open(request, timeout=8) as response:
        payload = json.loads(response.read(512_000))
    if not isinstance(payload, dict) or "error" in payload or payload.get("code") not in (None, 0, "0"):
        raise ValueError("Unexpected search response")
    return payload


def _baidu_entries(query: str) -> list[dict]:
    if not config.BAIDU_API_KEY:
        raise WebSearchError("站内百度搜索尚未启用。可打开百度查看结果。")
    data = _search_json("https://qianfan.baidubce.com/v2/ai_search/web_search", {
        "Authorization": f"Bearer {config.BAIDU_API_KEY}",
        "Content-Type": "application/json",
    }, {
        "messages": [{"role": "user", "content": query}],
        "search_source": "baidu_search_v2",
        "edition": "standard",
        "resource_type_filter": [{"type": "web", "top_k": 5}],
        "query_policy": {"enable_rewrite": True},
    })
    entries = data.get("references", [])
    if not isinstance(entries, list):
        raise ValueError("Unexpected Baidu references")
    return [{"title": item.get("title"), "url": item.get("url"),
             "description": item.get("snippet") or item.get("content")}
            for item in entries if isinstance(item, dict) and item.get("type", "web") == "web"]


def find_web_sources(query: str) -> list[WebSource]:
    words = " ".join(query.split())
    try:
        if config.SEARCH_PROVIDER == "brave":
            if not config.BRAVE_SEARCH_API_KEY:
                raise WebSearchError("站内 Brave Search 尚未启用。")
            chinese = bool(re.search(r"[\u3400-\u9fff]", words))
            params = urlencode({
                "q": words, "count": 5, "search_lang": "zh-hans" if chinese else "en", "safesearch": "moderate",
            })
            data = _search_json(f"https://api.search.brave.com/res/v1/web/search?{params}",
                                {"X-Subscription-Token": config.BRAVE_SEARCH_API_KEY})
            entries = data.get("web", {}).get("results", [])
        else:
            entries = _baidu_entries(words)
        if not isinstance(entries, list):
            raise ValueError("Unexpected search results")
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        raise WebSearchError(f"暂时无法访问{search_provider()}，请稍后重试。") from error

    sources: list[WebSource] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        url = entry.get("url")
        if not isinstance(url, str) or url in seen or len(url) > 2048 or re.search(r"[\x00-\x20\x7f\\]", url):
            continue
        try:
            parts = urlsplit(url)
            if parts.scheme not in {"https", "http"} or not parts.hostname or parts.username or parts.password:
                continue
        except ValueError:
            continue
        title = _text(entry.get("title"), 180)
        excerpt = _text(entry.get("description"), 800)
        if title and excerpt:
            seen.add(url)
            sources.append({"number": len(sources) + 1, "title": title, "url": url, "excerpt": excerpt})
            if len(sources) == 5:
                break
    return sources


def search_prompt(question: str, sources: list[WebSource]) -> str:
    # Links are rendered from the original results. The model receives only evidence text and its number.
    records = [{key: value for key, value in source.items() if key != "url"} for source in sources]
    return json.dumps({"question": question, "sources": records}, ensure_ascii=False)
