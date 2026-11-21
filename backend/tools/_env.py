"""在导入 app 配置之前读取项目根目录的 .env。

``uvicorn --env-file`` 只在启动服务时生效；命令行工具需要自己加载同一份配置，
否则 CLOUD_BASE_URL 之类的变量不会出现在 ``app.config`` 里。
"""

from __future__ import annotations

import os
from pathlib import Path


def load_env_file(path: Path | None = None) -> None:
    target = path or Path(__file__).resolve().parents[2] / ".env"
    if not target.exists():
        return
    for raw in target.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
