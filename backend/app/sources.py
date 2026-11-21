import json
import re
from datetime import datetime
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener


GITHUB_REPOSITORY = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def github_release(repo: str) -> tuple[str | None, str | None]:
    if not GITHUB_REPOSITORY.fullmatch(repo):
        return None, None
    request = Request(f"https://api.github.com/repos/{repo}/releases/latest", headers={
        "Accept": "application/vnd.github+json", "User-Agent": "qishi-ai",
    })
    try:
        with build_opener(NoRedirect()).open(request, timeout=5) as response:
            release = json.loads(response.read(1_048_576))
        tag = release["tag_name"]
        if release.get("draft") or release.get("prerelease") or not re.fullmatch(r"[A-Za-z0-9._+/-]{1,128}", tag):
            return None, None
        released = datetime.fromisoformat(release["published_at"]).date().isoformat()
        url = f"https://github.com/{repo}/releases/tag/{quote(tag, safe='')}"
        answer = f"{repo} 的最新正式发布为 **{tag}**，发布日期为 {released}（UTC）。\n\n[GitHub 发布记录]({url})"
        return tag, answer
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None, None
