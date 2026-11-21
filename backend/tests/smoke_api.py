from __future__ import annotations

import http.cookiejar
import json
import os
import urllib.error
import urllib.request


BASE_URL = os.getenv("QISHI_TEST_URL", "http://127.0.0.1:8000").rstrip("/")


class Client:
    def __init__(self, user_id: str):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.request("POST", "/api/auth/login", {"user_id": user_id, "password": "demo1234"})

    def request(self, method: str, path: str, body=None):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        request = urllib.request.Request(f"{BASE_URL}{path}", data=payload, method=method,
                                         headers={"Content-Type": "application/json"} if payload else {})
        try:
            with self.opener.open(request, timeout=20) as response:
                return response.status, response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode("utf-8", "replace")

    def json(self, method: str, path: str, body=None):
        status, raw = self.request(method, path, body)
        assert status < 400, f"{method} {path}: {status} {raw}"
        return json.loads(raw)


def sse_events(raw: str):
    events = []
    for block in raw.replace("\r\n", "\n").split("\n\n"):
        name, data = "message", ""
        for line in block.splitlines():
            if line.startswith("event:"):
                name = line[6:].strip()
            if line.startswith("data:"):
                data += line[5:].strip()
        if data:
            events.append((name, json.loads(data)))
    return events


def main():
    owner = Client("u-a")
    member = Client("u-b")
    created = owner.json("POST", "/api/sessions", {"scope": "shared"})
    session_id = created["id"]

    match = member.json("POST", "/api/match", {"query": "Python 3 的 if 条件遇到空列表时会判断为真还是假？原因是什么？"})
    assert match["decision"] == "reuse" and match["chosen"]["via"] == "semantic", match
    member.json("PATCH", "/api/settings", {"threshold": 0.82})
    assert member.json("POST", "/api/match", {"query": "Mac 如何只截取一个窗口？"})["threshold"] == 0.82
    member.json("PATCH", "/api/settings", {"threshold": 0.70})
    changed = member.json("POST", "/api/match", {"query": "那 bool([0]) 呢？"})
    assert changed["chosen"] is None, changed
    for unrelated in ("Python 3 的 bool({}) 返回什么？为什么？", "用英语解释 Python 3 的 bool([]) 为什么为假。",
                      "React 路由怎样设置？", "Windows 怎么关闭通知？"):
        match = member.json("POST", "/api/match", {"query": unrelated})
        assert match["chosen"] is None, match

    status, raw = owner.request("POST", f"/api/sessions/{session_id}/messages", {"text": "37 × 48 等于多少？"})
    events = sse_events(raw)
    done = next(data for event, data in events if event == "done")
    assert status == 200 and done["source"] == "tool" and done["cloud_calls"] == 0, (status, events)

    for expected_path in ("semantic", "alias"):
        status, raw = owner.request("POST", f"/api/sessions/{session_id}/messages", {"text": "Mac 上怎么截取单个窗口的截图？"})
        name, done = sse_events(raw)[-1]
        assert status == 200 and name == "done" and done["group_id"] == "grp_mac_shot", (status, done)
        assert done["match_type"] == expected_path and done["cloud_calls"] == 0, done

    status, raw = owner.request("POST", f"/api/sessions/{session_id}/messages", {"text": "2026年11月21日是星期几？"})
    events = sse_events(raw)
    assert events[-1][1]["source"] == "tool" and events[-1][1]["cloud_calls"] == 0, events
    assert "2026-11-21 星期六" in "".join(data["text"] for event, data in events if event == "delta"), events

    for text, language, marker in (("画一只骑自行车的鹈鹕", "zh", "用法："),
                                    ("Generate an SVG of a pelican riding a bicycle", "en", "How to use:")):
        status, raw = owner.request("POST", f"/api/sessions/{session_id}/messages", {"text": text})
        events = sse_events(raw)
        done = next(data for event, data in events if event == "done")
        drawing = "".join(data["text"] for event, data in events if event == "delta")
        assert status == 200 and done["source"] == "tool" and done["tool"] == "pelican", done
        assert done["language"] == language and done["cloud_calls"] == 0, done
        assert marker in drawing and "<!doctype html>" in drawing.lower() and "</html>" in drawing.lower(), language

    status, raw = owner.request("POST", f"/api/sessions/{session_id}/messages", {"text": "Excel 两列内容怎么拼到一列里？"})
    events = sse_events(raw)
    done = next(data for event, data in events if event == "done")
    assert done["source"] == "library" and done["cloud_calls"] == 0 and "brief" in done["variant_styles"], done
    selected = owner.json("POST", f"/api/sessions/{session_id}/messages/{done['message_id']}/variant", {"style": "brief"})
    assert selected["message"]["meta"]["variant_style"] == "brief", selected

    forbidden, _ = member.request("GET", f"/api/sessions/{session_id}")
    assert forbidden == 404, forbidden
    denied, _ = member.request("POST", "/api/groups/grp_bool_empty/versions", {"answer": "不允许成员发布", "basis": "test"})
    assert denied == 403, denied
    assert owner.json("GET", "/api/groups?filter=shared")

    status, raw = owner.request("POST", f"/api/sessions/{session_id}/messages", {"text": "请解释量子纠缠的基本概念"})
    events = sse_events(raw)
    error = next(data for event, data in events if event == "error")
    assert status == 200 and error["code"] == "cloud_unavailable" and "尚未配置云端模型" in error["message"], error
    history = owner.json("GET", f"/api/sessions/{session_id}")
    failed_answer = next(message for message in reversed(history["messages"]) if message["status"] == "error")
    assert failed_answer["meta"]["cloud_calls"] == 0, failed_answer

    voters = [member, owner, Client("u-c")]
    report_sessions = []
    for voter in voters:
        report_session = voter.json("POST", "/api/sessions", {"scope": "shared"})
        report_sessions.append((voter, report_session["id"]))
        _, raw_answer = voter.request("POST", f"/api/sessions/{report_session['id']}/messages",
                                      {"text": "Python 3 的 bool([]) 返回什么？为什么？"})
        answer_event = next(data for event, data in sse_events(raw_answer) if event == "done")
        assert answer_event["source"] == "library", answer_event
        voter.json("POST", "/api/reports", {"message_id": answer_event["message_id"], "category": "mismatch", "note": "治理闭环测试"})
    review = owner.json("GET", "/api/governance")
    active = next(item for item in review["suspensions"] if item["status"] == "active" and item["group_id"] == "grp_bool_empty")
    owner.json("POST", f"/api/suspensions/{active['id']}/resolve", {"resolution": "restored"})
    restored = member.json("POST", "/api/match", {"query": "Python 3 的 bool([]) 返回什么？为什么？"})
    assert restored["chosen"]["group_id"] == "grp_bool_empty", restored

    owner.json("DELETE", f"/api/sessions/{session_id}")
    for voter, report_session_id in report_sessions:
        voter.json("DELETE", f"/api/sessions/{report_session_id}")
    print("API smoke checks passed: auth, isolation, safe matching, SSE tools, pelican drawing, variants, governance, cloud retry path")


if __name__ == "__main__":
    main()
