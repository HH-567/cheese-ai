"""「画一只骑自行车的鹈鹕」的本地答复。

整页 HTML 放在 backend/data/pelican/，一份中文一份英文：中文提问给中文页，
英文提问给英文页。答复就是页面源码加一句怎么用，不经过任何模型。
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from . import config

PAGE_DIR = Path(__file__).resolve().parents[1] / "data" / "pelican"
PAGE_FILES: dict[tuple[str, str], str] = {
    ("zh", "complete"): "zh-complete.html",
    ("zh", "simple"): "zh-simple.html",
    ("zh", "simple2"): "zh-simple2.html",
    ("en", "complete"): "en-complete.html",
    ("en", "simple"): "en-simple.html",
    ("en", "simple2"): "en-simple2.html",
}
VARIANTS = ("complete", "simple", "simple2")

_CJK = re.compile(r"[\u3400-\u9fff]")
_PELICAN = re.compile(r"鹈鹕|pelican", re.I)
_BICYCLE = re.compile(r"自行车|单车|脚踏车|骑车|骑行|bicycle|bike|cycle", re.I)
_DRAW = re.compile(
    r"画|绘|生成|制作|做个|搞个|整个|来一[张个幅]|输出|\bsvg\b|"
    r"draw|paint|sketch|render|generate|create|make|show\s+me|give\s+me",
    re.I,
)
_VARIANT_HINTS = (
    (re.compile(r"简单\s*2|simple\s*[-_]?\s*2|第二[版个]"), "simple2"),
    (re.compile(r"简单|simple|精简|minimal|朴素"), "simple"),
    (re.compile(r"完整|complete|full|丰富|细节"), "complete"),
)

_ZH_TEXT = (
    "画好了 —— 一整页 HTML 都在下面，另存为 `pelican.html` 双击就能看。\n\n"
    "```html\n{html}\n```\n\n"
    "用法：把代码块里的内容复制到一个文本文件，保存成 `pelican.html`（UTF-8 编码），"
    "双击用浏览器打开。页面是纯离线的，不需要联网，也不加载任何外部文件。"
)
_EN_TEXT = (
    "Done - the whole page is below. Save it as `pelican.html` and open it in a browser.\n\n"
    "```html\n{html}\n```\n\n"
    "How to use: copy the code block into a plain text file, save it as `pelican.html` "
    "(UTF-8), then double-click the file. The page runs fully offline - no network, "
    "no external files."
)


@lru_cache(maxsize=None)
def _page(language: str, variant: str) -> str | None:
    name = PAGE_FILES.get((language, variant))
    if name is None:
        return None
    path = PAGE_DIR / name
    try:
        return path.read_text(encoding="utf-8").rstrip()
    except OSError:
        return None


def _pick_variant(query: str) -> str:
    for pattern, variant in _VARIANT_HINTS:
        if pattern.search(query):
            return variant
    configured = (config.PELICAN_VARIANT or "").strip().lower()
    return configured if configured in VARIANTS else "complete"


def answer(query: str) -> tuple[str, dict] | None:
    """识别画图请求并返回整页 HTML 答复；不是这个请求时返回 None。"""
    if not (_PELICAN.search(query) and _BICYCLE.search(query) and _DRAW.search(query)):
        return None
    language = "zh" if _CJK.search(query) else "en"
    variant = _pick_variant(query)
    html = _page(language, variant) or _page(language, "complete")
    if not html:
        return None
    template = _ZH_TEXT if language == "zh" else _EN_TEXT
    return template.format(html=html), {
        "tool": "pelican",
        "language": language,
        "variant": variant,
        "filename": "pelican.html",
    }
