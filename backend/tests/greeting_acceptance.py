"""Verify greetings are learned into the library, using a local mock cloud."""

from __future__ import annotations

import http.cookiejar
import json
import os
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

GREETING = "你好"
IDENTITY = "你是谁"
THANKS = "谢谢"
GREETING_ANSWER = "你好！我是柒柿AI，一个本地优先的通用助手。"
IDENTITY_ANSWER = "我是柒柿AI，一个本地优先的通用问答助手。"
ALIASES = ["你好呀", "嗨，在吗"]


class ModelFixture(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        prompt = body["messages"][-1]["content"]
        usage = {"prompt_tokens": 10, "completion_tokens": 8}
        if not body.get("stream"):
            payload = {"choices": [{"message": {"content": json.dumps({"aliases": ALIASES}, ensure_ascii=False)}}],
                       "usage": usage}
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(payload, ensure_ascii=False).encode())
            return
        answer = IDENTITY_ANSWER if IDENTITY in prompt else GREETING_ANSWER
        events = [{"choices": [{"delta": {"content": answer[:8]}}]},
                  {"choices": [{"delta": {"content": answer[8:]}}]},
                  {"choices": [{"delta": {}, "finish_reason": "stop"}]},
                  {"choices": [], "usage": usage}]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for event in events:
            self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")


def sse_events(raw: str):
    events = []
    for block in raw.replace("\r\n", "\n").split("\n\n"):
        name, payload = "message", ""
        for line in block.splitlines():
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                payload += line[5:].strip()
        if payload:
            events.append((name, json.loads(payload)))
    return events


def main() -> None:
    with TemporaryDirectory() as data_dir, ThreadingHTTPServer(("127.0.0.1", 0), ModelFixture) as model:
        threading.Thread(target=model.serve_forever, daemon=True).start()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        root = Path(__file__).resolve().parents[2]
        env = {**os.environ, "QISHI_DATA_DIR": data_dir,
               "QISHI_DB_PATH": str(Path(data_dir) / "test.sqlite3"), "QISHI_DEMO_MODE": "1",
               "QISHI_DEMO_SEED_PATH": "",
               "CLOUD_BASE_URL": f"http://127.0.0.1:{model.server_port}/v1", "CLOUD_API_KEY": "fixture"}
        server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--app-dir", "backend",
             "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
            cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        base = f"http://127.0.0.1:{port}"
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

        def call(method: str, path: str, body=None) -> str:
            data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
            request = urllib.request.Request(base + path, data=data, method=method,
                                             headers={"Content-Type": "application/json"} if data else {})
            with opener.open(request, timeout=60) as response:
                return response.read().decode()

        def ask(session_id: str, text: str) -> dict:
            raw = call("POST", f"/api/sessions/{session_id}/messages", {"text": text})
            return next(data for event, data in sse_events(raw) if event == "done")

        try:
            for _ in range(120):
                try:
                    urllib.request.urlopen(base + "/api/health", timeout=1)
                    break
                except OSError:
                    time.sleep(0.1)
            call("POST", "/api/auth/login", {"user_id": "u-a", "password": "demo1234"})
            session_id = json.loads(call("POST", "/api/sessions", {"scope": "personal"}))["id"]

            for text in (GREETING, IDENTITY):
                done = ask(session_id, text)
                assert done["source"] == "cloud" and done.get("learn_task"), (text, done)
            dropped = ask(session_id, THANKS)
            assert not dropped.get("learn_task"), dropped
            personal = ask(session_id, "我是谁")
            assert not personal.get("learn_task"), personal

            database = sqlite3.connect(Path(data_dir) / "test.sqlite3")
            try:
                for _ in range(60):
                    states = [row[0] for row in database.execute("SELECT state FROM learn_tasks")]
                    if states and all(state == "done" for state in states):
                        break
                    time.sleep(0.5)
                originals = [row[0] for row in database.execute("SELECT original FROM groups")]
                aliases = [row[0] for row in database.execute(
                    "SELECT text FROM aliases WHERE source='generated'")]
                states = [row[0] for row in database.execute("SELECT state FROM learn_tasks")]
            finally:
                database.close()

            assert sorted(originals) == sorted([GREETING, IDENTITY]), originals
            assert states and all(state == "done" for state in states), states
            assert set(aliases) == set(ALIASES), aliases
            assert all(len(alias) < 6 for alias in aliases), aliases

            reuse = ask(session_id, GREETING)
            assert reuse["source"] == "library" and reuse["cloud_calls"] == 0, reuse

            # 关掉自动生成等价问法：新问答照样入库，但不再排队生成问法。
            call("PATCH", "/api/settings", {"auto_alias": False})
            plain_session = json.loads(call("POST", "/api/sessions", {"scope": "personal"}))["id"]
            plain = ask(plain_session, "图书馆怎么借书？")
            assert plain.get("source") == "cloud" and not plain.get("learn_task"), plain
            database = sqlite3.connect(Path(data_dir) / "test.sqlite3")
            try:
                stored = database.execute(
                    "SELECT count(*) FROM groups WHERE original='图书馆怎么借书？'").fetchone()[0]
                queued = database.execute(
                    "SELECT count(*) FROM learn_tasks t JOIN groups g ON g.id=t.group_id "
                    "WHERE g.original='图书馆怎么借书？'").fetchone()[0]
            finally:
                database.close()
            assert stored == 1 and queued == 0, (stored, queued)
            call("PATCH", "/api/settings", {"auto_alias": True})

            print("Greeting acceptance passed: 你好/你是谁 learned with short aliases, 谢谢 and 我是谁 skipped, "
                  "auto_alias off still stores groups without alias tasks")
        finally:
            server.terminate()
            server.wait(timeout=10)
            model.shutdown()


if __name__ == "__main__":
    main()
