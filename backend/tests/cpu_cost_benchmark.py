"""Measure offline reuse and optionally replay one real cloud baseline across four reuse modes."""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import statistics
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

import smoke_api
from matching_acceptance import ACCEPTANCE
from smoke_api import Client


ROOT = Path(__file__).resolve().parents[2]
MODES = {"cloud": set(), "original": {"exact"}, "aliases": {"exact", "alias"},
         "semantic": {"exact", "alias", "semantic"}}
UNKNOWN = "什么是拓扑排序？"


@contextmanager
def serve(work, cloud_env=None):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    smoke_api.BASE_URL = f"http://127.0.0.1:{port}"
    env = {
        **os.environ, "CLOUD_BASE_URL": "", "CLOUD_API_KEY": "", **(cloud_env or {}),
        "QISHI_DATA_DIR": str(work), "QISHI_DB_PATH": str(work / "benchmark.sqlite3"),
        "QISHI_DEMO_MODE": "1", "QISHI_COOKIE_SECURE": "0", "QISHI_MATCH_THRESHOLD": "0.70",
        "QISHI_DEMO_SEED_PATH": str(ROOT / "backend/data/seed_qa.json"),
        "QISHI_EMBEDDING_MODEL": "", "QISHI_RERANKER_MODEL": "", "CUDA_VISIBLE_DEVICES": "-1",
    }
    command = [sys.executable, "-m", "uvicorn", "app.main:app", "--app-dir", "backend",
               "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"]
    with subprocess.Popen(command, cwd=ROOT, env=env) as server:
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(smoke_api.BASE_URL + "/api/health", timeout=1) as response:
                        health = json.load(response)
                    break
                except OSError:
                    if server.poll() is not None:
                        raise RuntimeError("Benchmark API exited during startup")
                    time.sleep(0.1)
            else:
                raise RuntimeError("Benchmark API startup timed out")
            yield health
        finally:
            server.terminate()
            server.wait(timeout=10)


def score_match(client, query):
    start = time.perf_counter_ns()
    result = client.json("POST", "/api/match", {"query": query})
    result["roundtrip_ms"] = (time.perf_counter_ns() - start) / 1_000_000
    return result


def chat(client, query, *, force_cloud=False):
    session = client.json("POST", "/api/sessions", {"scope": "personal"})["id"]
    url = f"{smoke_api.BASE_URL}/api/sessions/{session}/messages"
    request = urllib.request.Request(url, method="POST", headers={"Content-Type": "application/json"},
                                     data=json.dumps({"text": query, "force_cloud": force_cloud}).encode())
    start = time.perf_counter_ns()
    first_ms = None
    fragments = []
    event = ""
    result = None
    with client.opener.open(request, timeout=120) as response:
        for line in response:
            text = line.decode("utf-8").strip()
            if text.startswith("event:"):
                event = text[6:].strip()
            elif text.startswith("data:"):
                payload = json.loads(text[5:])
                if event == "delta":
                    if first_ms is None:
                        first_ms = (time.perf_counter_ns() - start) / 1_000_000
                    fragments.append(payload["text"])
                elif event in {"done", "error"}:
                    result = payload
                    break
    if result is None:
        raise RuntimeError(f"Missing terminal event for {query!r}")
    return {**result, "event": event, "first_ms": first_ms,
            "complete_ms": (time.perf_counter_ns() - start) / 1_000_000, "answer": "".join(fragments)}


def offline(work):
    with serve(work) as health:
        assert not health["cloud_configured"], health
        with urllib.request.urlopen(smoke_api.BASE_URL + "/", timeout=5) as response:
            script = re.search(r'<script\b[^>]*src="(/assets/[^"]+\.js)"', response.read().decode())
        if not script:
            raise RuntimeError("Build frontend/dist before running the offline website check")
        with urllib.request.urlopen(smoke_api.BASE_URL + script[1], timeout=5) as response:
            assert b"/api/auth/login" in response.read()
        client = Client("u-b")
        rows = []
        # Query the fixed snapshot before chat saves any observed aliases.
        for query, expected_id, expected_path in ACCEPTANCE:
            match = score_match(client, query)
            assert (match["chosen"] or {}).get("group_id") == expected_id, (query, match)
            assert match["match_type"] == expected_path, (query, match)
            rows.append({"query": query, "expected_group": expected_id, "path": expected_path,
                         "match_ms": match["roundtrip_ms"]})
        for row in rows:
            if row["expected_group"] is not None:
                local = chat(client, row["query"])
                assert (local["event"], local["source"], local["match_type"], local["cloud_calls"]) == (
                    "done", "library", row["path"], 0), local
                assert local["group_id"] == row["expected_group"]
                row["local"] = local
        tool = chat(client, "37 × 48 等于多少？")
        assert tool["source"] == "tool" and tool["cloud_calls"] == 0, tool
        failure = chat(client, UNKNOWN)
        assert failure["event"] == "error" and failure["code"] == "cloud_unavailable", failure
        print("Offline: web assets, 12 library answers, local calculator, and unknown-question fallback passed.", flush=True)
        return rows


def online(work, rows, cloud_env):
    with serve(work, cloud_env) as health:
        assert health["cloud_configured"], health
        learner = Client("u-a")
        completion = chat(learner, UNKNOWN)
        assert completion["event"] == "done" and completion["source"] == "cloud", completion
        group_id = completion["learn_task"]["group_id"]
        for _ in range(300):
            task = learner.json("GET", f"/api/groups/{group_id}")["learn_task"]
            if task["state"] in {"done", "failed"}:
                break
            time.sleep(0.4)
        else:
            raise RuntimeError("Learning task did not finish")
        print(f"Cloud restored: one unknown question answered and learning finished ({task['state']}).", flush=True)
        overhead = learner.json("GET", "/api/usage")
        background = [row for row in overhead["requests"] if row["path"] in {"learn", "variant", "revision"}]

        def measure(row):
            result = chat(Client("u-b"), row["query"], force_cloud=True)
            print(f"{result['event']:5} {result['complete_ms']:7.0f} ms {row['query']}", flush=True)
            return result

        with ThreadPoolExecutor(max_workers=4) as pool:
            for row, result in zip(rows, pool.map(measure, rows)):
                row["cloud"] = result
        return health["model"], task, background


def summarize(rows, background, prices):
    output = {}
    for mode, paths in MODES.items():
        hits = [row for row in rows if row["path"] in paths]
        answers = [row["local"] if row["path"] in paths else row["cloud"] for row in rows]
        cloud = [row["cloud"] for row in rows if row["path"] not in paths]
        learning = background if mode in {"aliases", "semantic"} else []
        tokens_in = sum(x.get("tokens_in", 0) for x in cloud + learning)
        tokens_out = sum(x.get("tokens_out", 0) for x in cloud + learning)
        completed = [answer for answer in answers if answer["event"] == "done"]
        output[mode] = {
            "library_hits": len(hits), "completed": len(completed),
            "answer_calls": len(cloud), "background_calls": sum(x["cloud_calls"] for x in learning),
            "tokens_in": tokens_in, "tokens_out": tokens_out,
            "first_ms_p50": statistics.median(x["first_ms"] for x in completed) if completed else None,
            "complete_ms_p50": statistics.median(x["complete_ms"] for x in completed) if completed else None,
            "usd_per_100": (tokens_in * prices[0] + tokens_out * prices[1]) / 1_000_000 * 100 / len(rows)
            if prices is not None else None,
        }
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cloud", action="store_true", help="Run 26 cloud baseline requests and one learning probe.")
    parser.add_argument("--output", type=Path, required=True, help="Write measurements and sample answers as JSON.")
    args = parser.parse_args()
    cloud_env = None
    prices = None
    if args.cloud:
        from dotenv import dotenv_values

        config = {**dotenv_values(ROOT / ".env"), **os.environ}
        cloud_env = {key: value for key, value in config.items() if key.startswith("CLOUD_") and value is not None}
        if not all(cloud_env.get(key) for key in ("CLOUD_BASE_URL", "CLOUD_API_KEY", "CLOUD_MODEL")):
            parser.error("--cloud requires a cloud endpoint, key, and model")
        if all(cloud_env.get(key) for key in ("CLOUD_INPUT_USD_PER_MTOK", "CLOUD_OUTPUT_USD_PER_MTOK")):
            prices = tuple(float(cloud_env[key]) for key in ("CLOUD_INPUT_USD_PER_MTOK", "CLOUD_OUTPUT_USD_PER_MTOK"))

    with TemporaryDirectory() as tmp:
        work = Path(tmp)
        rows = offline(work / "offline")
        report = {"sample_count": len(rows), "rows": rows}
        if cloud_env is not None:
            model, task, background = online(work / "online", rows, cloud_env)
            report.update(model=model, learning=task, background=background, modes=summarize(rows, background, prices))
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {args.output}", flush=True)


if __name__ == "__main__":
    main()
