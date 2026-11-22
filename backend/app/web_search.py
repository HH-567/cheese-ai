from __future__ import annotations

import html
import json
import re
from typing import Literal, TypedDict, cast
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


SearchProvider = Literal["baidu", "wikipedia", "deepseek", "brave"]
PROVIDERS: dict[SearchProvider, str] = {
    "baidu": "百度", "wikipedia": "维基百科", "deepseek": "DeepSeek 搜索", "brave": "Brave Search",
}
DEEPSEEK_QUERY_LIMIT = 128


def default_search_provider() -> SearchProvider:
    return cast(SearchProvider, config.SEARCH_PROVIDER) if config.SEARCH_PROVIDER in PROVIDERS else "baidu"


def search_provider(provider: SearchProvider | None = None) -> str:
    return PROVIDERS[provider or default_search_provider()]


def _deepseek_key() -> str:
    if config.DEEPSEEK_SEARCH_API_KEY:
        return config.DEEPSEEK_SEARCH_API_KEY
    try:
        cloud = urlsplit(config.CLOUD_BASE_URL)
        if cloud.scheme == "https" and cloud.netloc.lower() == "api.deepseek.com":
            return config.CLOUD_API_KEY
    except ValueError:
        pass
    return ""


def search_catalog() -> list[dict]:
    configured = {
        "baidu": bool(config.BAIDU_API_KEY), "wikipedia": True,
        "deepseek": bool(_deepseek_key()), "brave": bool(config.BRAVE_SEARCH_API_KEY),
    }
    return [{"id": provider, "label": label, "configured": configured[provider]}
            for provider, label in PROVIDERS.items()
            if provider != "brave" or configured["brave"] or default_search_provider() == "brave"]


def _has_chinese(text: str) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", text))


def _wikipedia_base(query: str) -> str:
    lang = "zh" if _has_chinese(query) else "en"
    return f"https://{lang}.wikipedia.org"


def search_results_link(query: str, provider: SearchProvider | None = None) -> str | None:
    provider = provider or default_search_provider()
    if provider == "baidu":
        return "https://www.baidu.com/s?" + urlencode({"wd": query})
    if provider == "wikipedia":
        return _wikipedia_base(query) + "/wiki/Special:Search?" + urlencode({"search": query})
    return None


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


def _wikipedia_entries(query: str) -> list[dict]:
    base = _wikipedia_base(query)
    params = urlencode({
        "action": "query", "list": "search", "srsearch": query, "srnamespace": 0,
        "srlimit": 5, "srprop": "snippet", "format": "json", "formatversion": 2,
    })
    headers = {"User-Agent": config.WIKIPEDIA_USER_AGENT} if config.WIKIPEDIA_USER_AGENT else {}
    data = _search_json(f"{base}/w/api.php?{params}", headers)
    entries = data["query"]["search"]
    if not isinstance(entries, list):
        raise ValueError("Unexpected Wikipedia results")
    return [{"title": item.get("title"), "url": f"{base}/wiki/Special:Redirect/page/{item['pageid']}",
             "description": item.get("snippet")}
            for item in entries if isinstance(item, dict) and type(item.get("pageid")) is int and item["pageid"] > 0]


def _deepseek_entries(query: str) -> list[dict]:
    key = _deepseek_key()
    if not key:
        raise WebSearchError("站内 DeepSeek 搜索尚未配置。请选择其他搜索引擎。")
    if len(query) > DEEPSEEK_QUERY_LIMIT:
        raise WebSearchError(f"请将 DeepSeek 搜索问题缩短到 {DEEPSEEK_QUERY_LIMIT} 个字符以内。")
    data = _search_json("https://api.deepseek.com/v1/tools/search", {
        "Authorization": f"Bearer {key}", "Content-Type": "application/json",
    }, {"query": query, "count": 5})
    entries = data["results"]
    if not isinstance(entries, list):
        raise ValueError("Unexpected DeepSeek results")
    return [{"title": item.get("title"), "url": item.get("url"),
             "description": item.get("summary") or item.get("snippet")}
            for item in entries if isinstance(item, dict)]


def _brave_entries(query: str) -> list[dict]:
    if not config.BRAVE_SEARCH_API_KEY:
        raise WebSearchError("站内 Brave Search 尚未启用。")
    params = urlencode({
        "q": query, "count": 5, "search_lang": "zh-hans" if _has_chinese(query) else "en", "safesearch": "moderate",
    })
    data = _search_json(f"https://api.search.brave.com/res/v1/web/search?{params}",
                        {"X-Subscription-Token": config.BRAVE_SEARCH_API_KEY})
    return data.get("web", {}).get("results", [])


def find_web_sources(query: str, provider: SearchProvider | None = None) -> list[WebSource]:
    provider = provider or default_search_provider()
    words = " ".join(query.split())
    fetch = {"baidu": _baidu_entries, "wikipedia": _wikipedia_entries,
             "deepseek": _deepseek_entries, "brave": _brave_entries}
    try:
        entries = fetch[provider](words)
        if not isinstance(entries, list):
            raise ValueError("Unexpected search results")
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        raise WebSearchError(f"暂时无法访问{search_provider(provider)}，请稍后重试。") from error

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
