"""Render / 容器启动前的引导：建库、补演示账号、按需导入共享问答库快照。

幂等：共享库已有足够问题组时直接跳过，不重复导入。
导入失败不会阻止服务启动（仍可只用种子问答运行）。
"""
from __future__ import annotations

import gzip
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.db import connect, initialize  # noqa: E402

SNAPSHOT_URL = os.getenv(
    "DEMO_LIBRARY_URL",
    "https://github.com/HH-567/cheese-ai/releases/download/v0.1.0/cheese-ai-library-20261122.json.gz",
)
MIN_SHARED = int(os.getenv("DEMO_LIBRARY_MIN_SHARED", "1000"))


def shared_count() -> int:
    db = connect()
    try:
        return db.execute("SELECT COUNT(*) FROM groups WHERE scope='shared'").fetchone()[0]
    finally:
        db.close()


def fetch_snapshot() -> Path:
    work = Path(tempfile.mkdtemp(prefix="qishi-seed-"))
    gz_path = work / "library.json.gz"
    json_path = work / "library.json"
    print(f"[bootstrap] 下载演示库：{SNAPSHOT_URL}")
    request = urllib.request.Request(SNAPSHOT_URL, headers={"User-Agent": "cheese-ai-bootstrap"})
    with urllib.request.urlopen(request, timeout=120) as response, open(gz_path, "wb") as handle:
        handle.write(response.read())
    with gzip.open(gz_path, "rb") as source, open(json_path, "wb") as target:
        target.write(source.read())
    return json_path


def main() -> None:
    initialize()
    existing = shared_count()
    print(f"[bootstrap] 当前共享问题组：{existing}")
    if existing >= MIN_SHARED:
        print("[bootstrap] 库已就绪，跳过导入")
        return
    try:
        snapshot = fetch_snapshot()
        subprocess.run(
            [sys.executable, str(ROOT / "backend" / "tools" / "import_qa_library.py"),
             "--source", str(snapshot), "--scope", "shared"],
            check=True,
            cwd=str(ROOT),
        )
        print(f"[bootstrap] 导入完成，共享问题组：{shared_count()}")
    except Exception as exc:  # noqa: BLE001
        print(f"[bootstrap] 导入失败，继续用种子库启动：{exc}")


if __name__ == "__main__":
    main()
