"""Exercise governance, permissions and freshness through the local API."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import smoke_api
from smoke_api import Client, sse_events


ROOT = Path(__file__).resolve().parents[2]
BOOL = "Python 3 的 bool([]) 返回什么？为什么？"
BOOL_REPHRASED = "Python 3 中 if 遇到空的列表会当成真还是假？"
EXCEL = "Excel 怎么把两列文字合并成一列？"
EXCEL_ALIAS = "Excel 两列内容怎么拼到一列里？"
MAC = "Mac 怎么只截一个窗口？"
REASK = "在结果列输入 =A2&B2，再向下填充。"


class Model(BaseHTTPRequestHandler):
    requests = 0

    def log_message(self, *_):
        pass

    def do_POST(self):
        type(self).requests += 1
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if not body["stream"] or body["messages"][-1]["content"] != EXCEL:
            self.send_error(400)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for event in ({"choices": [{"delta": {"content": REASK}}]}, {"choices": [{"finish_reason": "stop"}]}):
            self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")


@contextmanager
def running(app):
    import uvicorn

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        smoke_api.BASE_URL = f"http://127.0.0.1:{sock.getsockname()[1]}"
        server = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
        thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
        thread.start()
        try:
            for _ in range(100):
                if server.started:
                    break
                if not thread.is_alive():
                    raise RuntimeError("API exited during startup")
                time.sleep(0.05)
            else:
                raise RuntimeError("API startup timed out")
            yield
        finally:
            server.should_exit = True
            thread.join(timeout=10)
            assert not thread.is_alive()


def ask(client, question, **fields):
    session = client.json("POST", "/api/sessions", {"scope": "personal"})["id"]
    status, raw = client.request("POST", f"/api/sessions/{session}/messages", {"text": question, **fields})
    assert status == 200, raw
    events = sse_events(raw)
    assert events[-1][0] == "done", events
    return session, events[-1][1], "".join(data["text"] for event, data in events if event == "delta")


def match(client, question):
    return client.json("POST", "/api/match", {"query": question})["chosen"]


def report(client, message_id, category):
    return client.json("POST", "/api/reports", {"message_id": message_id, "category": category})


def verify_reports(admin, members, guest, transaction):
    a, b, c, old = members
    messages = [ask(client, BOOL_REPHRASED)[1]["message_id"] for client in (*members, guest)]
    assert c.request("POST", "/api/reports", {"message_id": messages[0], "category": "mismatch"})[0] == 404
    old_report = report(old, messages[3], "mismatch")
    eight_days_ago = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
    with transaction() as db:
        db.execute("UPDATE reports SET created_at=? WHERE id=?", (eight_days_ago, old_report["report_id"]))
    assert report(old, messages[3], "mismatch")["report_id"] == old_report["report_id"]
    report(guest, messages[4], "mismatch")
    assert not report(c, messages[2], "style")["bypassed"]
    first = report(a, messages[0], "mismatch")
    assert first["bypassed"] and report(a, messages[0], "mismatch")["report_id"] == first["report_id"]
    assert not match(a, BOOL_REPHRASED) and match(a, BOOL)
    second = report(b, messages[1], "mismatch")
    assert admin.json("GET", "/api/governance")["metrics"]["suspended"] == 0
    third = report(c, messages[2], "mismatch")
    suspension, = [v for v in admin.json("GET", "/api/governance")["suspensions"] if v["status"] == "active"]
    assert suspension["kind"] == "match" and suspension["can_manage"]
    assert set(json.loads(suspension["report_ids_json"])) == {r["report_id"] for r in (first, second, third)}
    assert not match(admin, BOOL_REPHRASED) and match(admin, BOOL)
    url = f"/api/suspensions/{suspension['id']}/resolve"
    assert a.request("POST", url, {"resolution": "restored"})[0] == 403
    admin.json("POST", url, {"resolution": "restored"})
    assert admin.request("POST", url, {"resolution": "disabled"})[0] == 409
    assert match(a, BOOL_REPHRASED)
    assert report(a, messages[0], "mismatch")["report_id"] != first["report_id"]
    assert admin.json("GET", "/api/governance")["metrics"]["suspended"] == 0

    _, version_answer, _ = ask(a, BOOL)
    report(a, version_answer["message_id"], "fact")
    assert not match(a, BOOL) and not match(a, BOOL_REPHRASED)
    assert match(admin, BOOL) and match(admin, BOOL_REPHRASED)


def verify_versions(admin, member, outsider):
    group = "/api/groups/grp_excel_merge"
    version = "grp_excel_merge:v1"
    session, old_answer, _ = ask(member, EXCEL_ALIAS)
    assert old_answer["version_id"] == version and "brief" in old_answer["variant_styles"]
    variants = f"/api/sessions/{session}/messages/{old_answer['message_id']}/variant"
    brief = member.json("POST", variants, {"style": "brief"})
    assert brief["cloud_calls"] == 0
    _, reanswer, text = ask(member, EXCEL, reask_of={"group_id": "grp_excel_merge", "version_id": version})
    assert text == REASK and reanswer["source"] == "cloud" and "learn_task" not in reanswer
    assert not reanswer["group_can_manage"]
    assert admin.json("GET", group)["current_version_id"] == version
    assert match(admin, EXCEL)["version_id"] == version
    draft = {"group_id": "grp_excel_merge", "message_id": reanswer["message_id"], "proposed_answer": text}
    assert admin.request("POST", "/api/revisions", draft)[0] == 404
    suggestion = member.json("POST", "/api/revisions", draft)["revision_id"]
    assert member.json("POST", "/api/revisions", draft)["revision_id"] == suggestion
    alt = member.json("POST", "/api/revisions", {"group_id": "grp_excel_merge", "proposed_answer": "另一个建议"})["revision_id"]
    publish = {"action": "publish"}
    resolve = f"/api/revisions/{suggestion}/resolve"
    assert member.request("POST", resolve, publish)[0] == 403
    assert member.request("POST", group + "/versions", {"answer": text})[0] == 403
    assert outsider.request("POST", group + "/versions", {"answer": text})[0] == 404
    assert outsider.request("POST", resolve, publish)[0] == 404
    assert not outsider.json("GET", "/api/governance")["revisions"]
    newest = admin.json("POST", resolve, publish)["published_version_id"]
    assert admin.request("POST", resolve, publish)[0] == 409
    assert admin.request("POST", f"/api/revisions/{alt}/resolve", publish)[0] == 409
    assert admin.json("GET", group)["versions"][-1]["variants"] == []
    _, latest_answer, text = ask(member, EXCEL_ALIAS)
    assert latest_answer["version_id"] == newest and latest_answer["variant_styles"] == [] and text == REASK
    original = member.json("GET", f"/api/sessions/{session}")["messages"][-1]
    assert original["version_id"] == version and original["content"] == brief["message"]["content"]
    assert not report(member, old_answer["message_id"], "mismatch")["bypassed"]
    assert match(member, EXCEL_ALIAS)["version_id"] == newest


def run_cli(*arguments):
    subprocess.run([sys.executable, "-m", "app.cli", *arguments], cwd=ROOT / "backend",
                   check=True, capture_output=True)


def verify_freshness(admin, member, catalog, transaction):
    from app import freshness

    group = "/api/groups/grp_mac_shot"
    checked = admin.json("GET", group)
    old_answer = checked["versions"][0]["answer"]

    def set_source(source):
        run_cli("set-source", "--group", "grp_mac_shot", "--key", source, "--version", "v1", "--review-days", "2")

    set_source("missing")
    assert not match(member, MAC)
    assert ask(member, MAC)[1]["source"] == "local"
    assert member.request("POST", group + "/refresh", {})[0] == 403
    set_source("mac")
    catalog.write_text(json.dumps({"mac": {"version": "v1", "answer": old_answer}}), encoding="utf-8")

    def expired_batch(expected_source):
        def read_slower(source):
            time.sleep(0.15)
            return read_source(source)

        read_source = freshness.read_source
        with patch.object(freshness, "read_source", side_effect=read_slower) as fetched:
            with ThreadPoolExecutor(max_workers=6) as pool:
                results = list(pool.map(lambda _: ask(Client("u-b"), MAC), range(6)))
            assert fetched.call_count == 1, fetched.call_count
        assert all(data["source"] == expected_source and data["cloud_calls"] == 0 for _, data, _ in results), results

    expired_batch("library")
    assert admin.json("GET", group)["current_version_id"] == checked["current_version_id"]
    catalog.write_text(json.dumps({"mac": {"version": "v2", "answer": "已核对的新截图说明"}}), encoding="utf-8")
    with transaction() as db:
        db.execute("DELETE FROM source_checks WHERE source='mac'")
    set_source("mac")
    expired_batch("local")
    pending, = [r for r in admin.json("GET", "/api/governance")["revisions"] if r.get("source_version") == "v2"]
    assert not match(member, MAC)
    admin.json("POST", f"/api/revisions/{pending['id']}/resolve", {"action": "publish"})
    _, done, text = ask(member, MAC)
    assert done["source"] == "library" and text == "已核对的新截图说明"
    assert admin.json("GET", group)["source_version"] == "v2"


def main():
    sys.path.insert(0, str(ROOT / "backend"))
    with TemporaryDirectory() as directory, ThreadingHTTPServer(("127.0.0.1", 0), Model) as model:
        work = Path(directory)
        catalog = work / "catalog.json"
        os.environ.update(QISHI_DATA_DIR=directory, QISHI_DB_PATH=str(work / "test.sqlite3"), QISHI_DEMO_MODE="1",
                          QISHI_DEMO_SEED_PATH=str(ROOT / "backend/data/seed_qa.json"), QISHI_COOKIE_SECURE="0",
                          QISHI_EMBEDDING_MODEL="", QISHI_RERANKER_MODEL="", QISHI_SOURCE_CATALOG=str(catalog),
                          QISHI_PAUSE_THRESHOLD="3", QISHI_PAUSE_WINDOW_DAYS="7",
                          CLOUD_BASE_URL=f"http://127.0.0.1:{model.server_port}/v1", CLOUD_API_KEY="fixture")
        from app.db import initialize, now_iso, transaction
        from app.engine import run_tool
        from app.main import _make_learn_group, app

        worker = threading.Thread(target=model.serve_forever, daemon=True)
        worker.start()
        try:
            with running(app):
                with transaction() as db:
                    password = db.execute("SELECT password_hash FROM users WHERE id='u-b'").fetchone()[0]
                    db.execute("INSERT INTO libraries VALUES('other','其他库',?)", (now_iso(),))
                    for user_id, role, library, verified in (
                        ("u-d", "member", "QS-2048", 1), ("u-e", "member", "QS-2048", 1),
                        ("guest", "member", "QS-2048", 0), ("outside", "admin", "other", 1),
                    ):
                        db.execute("INSERT INTO users(id,name,role,verified,password_hash,created_at) VALUES(?,?,?,?,?,?)", (user_id, user_id, role, verified, password, now_iso()))
                        db.execute("INSERT INTO library_members VALUES(?,?,?)", (library, user_id, role))
                        db.execute("INSERT INTO settings(user_id) VALUES(?)", (user_id,))
                    private = _make_learn_group(db, "u-b", "personal", "水的化学式是什么？", "H₂O")["group_id"]
                    db.execute("DELETE FROM learn_tasks")
                admin, a, b, c, old, guest, outsider = [Client(uid) for uid in ("u-a", "u-b", "u-c", "u-d", "u-e", "guest", "outside")]
                path = f"/api/groups/{private}"
                assert a.request("GET", path)[0] == 200 and admin.request("GET", path)[0] == 404
                bad_token = Client("missing")
                from urllib.error import HTTPError
                from urllib.request import Request

                try:
                    bad_token.opener.open(Request(smoke_api.BASE_URL + path, headers={"Cookie": "qishi_session=invalid.token"}))
                except HTTPError as error:
                    assert error.code == 401
                    error.close()
                else:
                    raise AssertionError("Invalid session token could read a private record")
                verify_reports(admin, (a, b, c, old), guest, transaction)
                verify_versions(admin, b, outsider)
                verify_freshness(admin, a, catalog, transaction)
                for zone in ("Asia/Shanghai", "America/Los_Angeles"):
                    admin.json("PATCH", "/api/settings", {"timezone": zone})
                    _, local, _ = ask(admin, "今天星期几？")
                    assert local["source"] == "tool" and local["cloud_calls"] == 0 and local["timezone"] == zone
                before_midnight = datetime(2026, 11, 21, 15, 59, tzinfo=timezone.utc)
                after = before_midnight + timedelta(minutes=2)
                assert run_tool("今天星期几？", "Asia/Shanghai", now=before_midnight)[0] == "2026-11-21 星期六"
                assert run_tool("今天星期几？", "Asia/Shanghai", now=after)[0] == "2026-11-22 星期日"
                assert run_tool("今天星期几？", "America/Los_Angeles", now=after)[0] == "2026-11-21 星期六"
                fresh_semantic = "Python 3 中空列表的布尔值是 True 还是 False？"
                assert match(b, BOOL) and match(b, fresh_semantic)["via"] == "semantic"
                run_cli("revoke-member", "--id", "u-c")
                initialize()
                assert not match(b, BOOL) and not match(b, fresh_semantic)
                assert b.request("GET", "/api/groups/grp_bool_empty")[0] == 404
                assert b.request("POST", "/api/sessions", {"scope": "shared"})[0] == 403
                assert Model.requests == 1, Model.requests
        finally:
            model.shutdown()
    print("Passed governance acceptance: report windows, voting, versioning, access, source deduplication, and timezones.")


if __name__ == "__main__":
    main()
