"""Verify registration, account isolation, and daily cloud limits on the real HTTP API."""

import http.cookiejar
import json
import os
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from tempfile import TemporaryDirectory

from governance_acceptance import ROOT, running
from smoke_api import Client, sse_events


PASSWORD = "test-only-trial-password"
QUESTION = "什么是拓扑排序？"


def client():
    session = Client.__new__(Client)
    session.jar = http.cookiejar.CookieJar()
    session.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(session.jar))
    return session


class Model(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *_):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).calls.append((body["stream"], body.get("max_tokens")))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream" if body["stream"] else "application/json")
        self.end_headers()
        if body["stream"]:
            self.wfile.write(b'data: {"choices":[{"delta":{"content":"Topological sorting orders nodes by dependencies."}}]}\n\n')
            self.wfile.write(b'data: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
        else:
            alias = json.dumps({"aliases": ["拓扑排序指的是什么？"]}, ensure_ascii=False)
            self.wfile.write(json.dumps({"choices": [{"message": {"content": alias}}]}).encode())


def ask(account, session, question=QUESTION, force=False):
    status, raw = account.request("POST", f"/api/sessions/{session}/messages", {"text": question, "force_cloud": force})
    assert status == 200, raw
    return sse_events(raw)[-1]


def register(account, user_id):
    return account.request("POST", "/api/auth/register", {"user_id": user_id, "name": "测试用户", "password": PASSWORD})


def main():
    sys.path.insert(0, str(ROOT / "backend"))
    with TemporaryDirectory() as work, ThreadingHTTPServer(("127.0.0.1", 0), Model) as model:
        os.environ.update(
            QISHI_DATA_DIR=work, QISHI_DB_PATH=os.path.join(work, "trial.sqlite3"), QISHI_DEMO_MODE="0",
            QISHI_OPEN_REGISTRATION="1", QISHI_COOKIE_SECURE="0", QISHI_REGISTRATION_PER_HOUR="5",
            QISHI_USER_DAILY_CLOUD_CALLS="2", QISHI_SITE_DAILY_CLOUD_CALLS="3", CLOUD_MAX_TOKENS="512",
            CLOUD_BASE_URL=f"http://127.0.0.1:{model.server_port}/v1", CLOUD_API_KEY="fixture",
        )
        from app import config
        from app.auth import hash_password, issue_token
        from app.db import initialize, now_iso, transaction
        from app.main import app

        initialize()
        with transaction() as db:
            db.execute("INSERT INTO users(id,name,password_hash,created_at) VALUES('u-a','demo',?,?)",
                       (hash_password("demo1234"), now_iso()))
        stale_demo_token, _, _ = issue_token("u-a")
        worker = threading.Thread(target=model.serve_forever, daemon=True)
        worker.start()
        try:
            with running(app):
                a, b, device, anonymous = (client() for _ in range(4))
                assert anonymous.json("GET", "/api/auth/options")["open_registration"]
                assert anonymous.request("GET", "/api/demo/users")[0] == 404
                assert anonymous.request("POST", "/api/auth/login", {"user_id": "u-a", "password": "demo1234"})[0] == 401
                authorization_probe = anonymous.jar
                authorization_probe.set_cookie(http.cookiejar.Cookie(
                    0, config.COOKIE_NAME, stale_demo_token, None, False, "127.0.0.1", False, False,
                    "/", True, False, None, True, None, None, {}, False,
                ))
                assert anonymous.request("GET", "/api/auth/me")[0] == 401
                assert register(a, "u-b")[0] == 422
                status, raw = register(a, "Tester-A")
                assert status == 201 and json.loads(raw)["user"] == {
                    "id": "tester-a", "name": "测试用户", "role": "member", "verified": False,
                }
                assert register(anonymous, "tester-a")[0] == 409
                assert register(b, "tester-b")[0] == 201
                assert register(client(), "tester-c")[0] == 201
                assert register(client(), "tester-d")[0] == 429
                assert not a.json("GET", "/api/settings")["shared_member"]
                assert a.request("POST", "/api/sessions", {"scope": "shared"})[0] == 403
                assert device.request("POST", "/api/auth/login", {"user_id": "TESTER-A", "password": PASSWORD})[0] == 200
                sid = a.json("POST", "/api/sessions", {})["id"]
                event, done = ask(a, sid)
                assert event == "done" and done["source"] == "cloud", done
                group_id = done["learn_task"]["group_id"]
                for _ in range(100):
                    group = a.json("GET", f"/api/groups/{group_id}")
                    if group["learn_task"]["state"] == "done":
                        break
                    time.sleep(0.05)
                else:
                    raise AssertionError("Background learning did not complete")
                assert a.json("GET", "/api/usage")["quota"]["used"] == 2
                assert device.json("GET", f"/api/sessions/{sid}")["messages"][-1]["id"] == done["message_id"]
                assert device.json("GET", "/api/sessions")[0]["id"] == sid
                assert b.request("GET", f"/api/sessions/{sid}")[0] == 404
                assert b.request("GET", f"/api/groups/{group_id}")[0] == 404
                assert ask(device, sid)[1]["source"] == "library"
                assert ask(device, sid, "37 × 48 等于多少？")[1]["source"] == "tool"
                assert ask(device, sid, force=True)[1]["code"] == "cloud_quota"
                assert a.request("POST", f"/api/sessions/{sid}/messages/{done['message_id']}/variant",
                                 {"style": "brief"})[0] == 429

                b.json("PATCH", "/api/settings", {"auto_learn": False})
                sessions = [b.json("POST", "/api/sessions", {})["id"] for _ in range(5)]
                with ThreadPoolExecutor(max_workers=5) as pool:
                    results = list(pool.map(lambda item: ask(b, item, force=True), sessions))
                assert sum(event == "done" for event, _ in results) == 1, results
                assert all(result.get("code") == "cloud_quota" for event, result in results if event == "error")
                assert b.json("GET", "/api/usage")["quota"]["site_exhausted"]
                assert Model.calls == [(True, 512), (False, 512), (True, 512)], Model.calls
                a.json("POST", "/api/auth/logout")
                assert a.request("GET", f"/api/sessions/{sid}")[0] == 401
                assert device.request("GET", f"/api/sessions/{sid}")[0] == 200
        finally:
            model.shutdown()
    print("Passed trial acceptance: signup limits, demo isolation, two-device history, shared quotas, and concurrent admission.")


if __name__ == "__main__":
    main()
