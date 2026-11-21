"""Exercise the OpenAI-compatible transport and learning using an isolated local fixture."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

import smoke_api
from smoke_api import Client, sse_events


QUESTION = "什么是柠檬酸循环？"
ALIASES = ["柠檬酸循环是什么意思？", "请介绍一下柠檬酸循环", "柠檬酸循环指的是什么"]
ANSWER = "柠檬酸循环是细胞代谢中氧化乙酰辅酶 A 的循环反应。"
INTERRUPTED = "什么是图灵机？"
NEW_TOPIC = "Python 3 的 `bool([])` 返回什么？"
CHANGED_INPUT = "Python 3 的 `bool({})` 返回什么？"
FOLLOW_UP = "它的作用是什么？"


class ModelFixture(BaseHTTPRequestHandler):
    learning_attempts = 0

    def log_message(self, format, *args):
        pass

    def do_POST(self):
        if self.path != "/v1/chat/completions" or self.headers.get("Authorization") != "Bearer fixture":
            self.send_error(403)
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        prompt = body["messages"][-1]["content"]
        usage = {"prompt_tokens": 24, "completion_tokens": 16}
        if not body["stream"]:
            type(self).learning_attempts += 1
            if type(self).learning_attempts == 1:
                self.send_error(503)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            aliases = ALIASES if QUESTION in prompt else [
                "在 Python 3 中空字典的布尔值是多少？" if CHANGED_INPUT in prompt else "在 Python 3 中空列表的布尔值是多少？"
            ]
            content = json.dumps({"aliases": aliases}, ensure_ascii=False)
            self.wfile.write(json.dumps({"choices": [{"message": {"content": content}}], "usage": usage}).encode())
            return
        answers = {QUESTION: ANSWER, FOLLOW_UP: "它为细胞提供能量代谢所需的中间产物。",
                   NEW_TOPIC: "`bool([])` 返回 `False`。", CHANGED_INPUT: "`bool({})` 返回 `False`。"}
        if prompt != INTERRUPTED:
            with_history = len(body["messages"]) > 2
            if prompt not in answers or with_history != (prompt == FOLLOW_UP):
                self.send_error(400, "Unexpected prompt or context")
                return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        if prompt == INTERRUPTED:
            events = [{"choices": [{"delta": {"content": "未完成的回答"}}]}]
        else:
            answer = answers[prompt]
            events = [{"choices": [{"delta": {"content": chunk}}]} for chunk in (answer[:10], answer[10:])]
            events.extend([{"choices": [{"delta": {}, "finish_reason": "stop"}]}, {"choices": [], "usage": usage}])
        for event in events:
            self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
        if prompt != INTERRUPTED:
            self.wfile.write(b"data: [DONE]\n\n")


@contextmanager
def run_app(data_dir: str, model_port: int):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    smoke_api.BASE_URL = f"http://127.0.0.1:{port}"
    env = {**os.environ, "QISHI_DATA_DIR": data_dir, "QISHI_DB_PATH": str(Path(data_dir) / "test.sqlite3"),
           "QISHI_DEMO_MODE": "1", "QISHI_COOKIE_SECURE": "0", "QISHI_DEMO_SEED_PATH": "",
           "CLOUD_BASE_URL": f"http://127.0.0.1:{model_port}/v1", "CLOUD_API_KEY": "fixture",
           "CLOUD_INPUT_USD_PER_MTOK": "2", "CLOUD_OUTPUT_USD_PER_MTOK": "3"}
    root = Path(__file__).resolve().parents[2]
    command = [sys.executable, "-m", "uvicorn", "app.main:app", "--app-dir", "backend",
               "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"]
    with subprocess.Popen(command, cwd=root, env=env) as server:
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(smoke_api.BASE_URL + "/openapi.json", timeout=1):
                        break
                except OSError:
                    if server.poll() is not None:
                        raise RuntimeError("API exited during startup")
                    time.sleep(0.1)
            else:
                raise RuntimeError("API startup timed out")
            yield
        finally:
            server.terminate()
            server.wait(timeout=10)


def ask(client, question, session_id=None):
    if session_id is None:
        session_id = client.json("POST", "/api/sessions", {"scope": "shared"})["id"]
    status, raw = client.request("POST", f"/api/sessions/{session_id}/messages", {"text": question})
    assert status == 200, raw
    return session_id, sse_events(raw)


def main():
    with ThreadingHTTPServer(("127.0.0.1", 0), ModelFixture) as model, TemporaryDirectory() as data_dir:
        worker = threading.Thread(target=model.serve_forever, daemon=True)
        worker.start()
        try:
            with run_app(data_dir, model.server_port):
                owner = Client("u-a")
                assert not owner.json("GET", "/api/groups")
                _, events = ask(owner, QUESTION)
                done = next(data for name, data in events if name == "done")
                assert done["source"] == "cloud" and done["tokens_in"] == 24, done
                assert "".join(data["text"] for name, data in events if name == "delta") == ANSWER
                group_id = done["learn_task"]["group_id"]

                session, events = ask(owner, INTERRUPTED)
                assert events[-1][0] == "error", events
                history = owner.json("GET", f"/api/sessions/{session}")
                assert history["messages"][-1]["status"] == "error", history
                assert len(owner.json("GET", "/api/groups")) == 1
                for _ in range(120):
                    if ModelFixture.learning_attempts:
                        break
                    time.sleep(0.05)
                assert ModelFixture.learning_attempts == 1
                for _ in range(20):
                    usage = owner.json("GET", "/api/usage")
                    if usage["learn_calls"] == 1:
                        break
                    time.sleep(0.05)
                assert usage["learn_calls"] == 1
                assert usage["total"] == 2 and usage["cost_configured"], usage
                assert usage["cost"] == 0.000096 and usage["cost_per_100"] == 0.0048, usage

            with run_app(data_dir, model.server_port):
                member = Client("u-b")
                for _ in range(100):
                    group = member.json("GET", f"/api/groups/{group_id}")
                    if set(ALIASES).issubset(alias["text"] for alias in group["aliases"]):
                        break
                    time.sleep(0.1)
                else:
                    raise AssertionError("The queued learning retry did not persist its aliases")
                _, events = ask(member, ALIASES[0])
                done = next(data for name, data in events if name == "done")
                assert done["source"] == "library" and done["cloud_calls"] == 0 and done["match_type"] == "alias", done
                assert ModelFixture.learning_attempts == 2

                owner = Client("u-a")
                personal_id = owner.json("POST", "/api/sessions", {"scope": "personal"})["id"]
                _, events = ask(owner, QUESTION, personal_id)
                assert events[-1][1]["source"] == "library", events[-1]

                _, events = ask(owner, FOLLOW_UP, personal_id)
                done = events[-1][1]
                assert events[-1][0] == "done" and done["source"] == "cloud" and "learn_task" not in done, events[-1]
                assert any(step["key"] == "learn" and step["state"] == "skip" for step in done["trace"]), done

                _, events = ask(owner, NEW_TOPIC, personal_id)
                done = events[-1][1]
                assert events[-1][0] == "done" and done["source"] == "cloud" and done["group_scope"] == "personal", events[-1]
                personal_group_id = done["learn_task"]["group_id"]
                assert [g["original"] for g in owner.json("GET", "/api/groups?filter=mine")] == [NEW_TOPIC]
                assert member.request("GET", f"/api/groups/{personal_group_id}")[0] == 404
                _, events = ask(owner, NEW_TOPIC, personal_id)
                done = events[-1][1]
                assert done["source"] == "library" and done["cloud_calls"] == 0, done

                _, events = ask(owner, CHANGED_INPUT, personal_id)
                done = events[-1][1]
                assert done["source"] == "cloud" and done["learn_task"]["group_id"] != personal_group_id, done
                assert {g["original"] for g in owner.json("GET", "/api/groups?filter=mine")} == {NEW_TOPIC, CHANGED_INPUT}
                for question, expected_group_id in ((NEW_TOPIC, personal_group_id), (CHANGED_INPUT, done["group_id"])):
                    _, events = ask(owner, question, personal_id)
                    done = events[-1][1]
                    assert done["source"] == "library" and done["group_id"] == expected_group_id, done
        finally:
            model.shutdown()
    print("Cloud flow checks passed: streaming, truncated stream, retry across restart, shared reuse, learning new topics in existing chats")


if __name__ == "__main__":
    main()
