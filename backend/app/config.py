from __future__ import annotations

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("QISHI_DATA_DIR", ROOT / "data"))
DB_PATH = Path(os.getenv("QISHI_DB_PATH", DATA_DIR / "qishi.sqlite3"))
SECRET_PATH = DATA_DIR / "secret.key"
DEMO_MODE = os.getenv("QISHI_DEMO_MODE", "1").lower() not in {"0", "false", "no"}
DEMO_USER_IDS = ("u-a", "u-b", "u-c")
OPEN_REGISTRATION = os.getenv("QISHI_OPEN_REGISTRATION", "0").lower() in {"1", "true", "yes"}
REGISTRATION_PER_HOUR = max(1, int(os.getenv("QISHI_REGISTRATION_PER_HOUR", "5")))
USER_DAILY_CLOUD_CALLS = max(0, int(os.getenv("QISHI_USER_DAILY_CLOUD_CALLS", "20" if OPEN_REGISTRATION or not DEMO_MODE else "0")))
SITE_DAILY_CLOUD_CALLS = max(0, int(os.getenv("QISHI_SITE_DAILY_CLOUD_CALLS", "200" if OPEN_REGISTRATION or not DEMO_MODE else "0")))
DEMO_SEED_PATH = os.getenv("QISHI_DEMO_SEED_PATH", str(ROOT / "backend" / "data" / "seed_qa.json"))
COOKIE_SECURE = os.getenv("QISHI_COOKIE_SECURE", "0").lower() in {"1", "true", "yes"}
COOKIE_NAME = os.getenv("QISHI_COOKIE_NAME", "qishi_session")
TOKEN_TTL_SECONDS = int(os.getenv("QISHI_TOKEN_TTL_SECONDS", "43200"))
CLOUD_BASE_URL = os.getenv("CLOUD_BASE_URL", "").rstrip("/")
CLOUD_API_KEY = os.getenv("CLOUD_API_KEY", "")
CLOUD_MODEL = os.getenv("CLOUD_MODEL", "deepseek-chat")
LOCAL_MODEL = os.getenv("QISHI_LOCAL_MODEL", "").strip()
LOCAL_MODEL_URL = os.getenv("QISHI_LOCAL_MODEL_URL", "http://127.0.0.1:8080/v1/chat/completions").rstrip("/")
CLOUD_EXTRA_MODELS = tuple(dict.fromkeys(filter(None, (
    name.strip() for name in os.getenv("CLOUD_EXTRA_MODELS", "").split(",")
))))
CLOUD_VISION_MODEL = os.getenv("CLOUD_VISION_MODEL", "").strip() or (
    CLOUD_MODEL if CLOUD_MODEL in {"deepseek-flash", "deepseek-v4.1-flash-1017", "deepseek-v4-flash-vision-exp"} else ""
)
SPEECH_MODEL_DIR = Path(os.getenv("QISHI_SPEECH_MODEL_DIR", str(
    DATA_DIR / "models" / "sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01"
)))
CLOUD_TIMEOUT_SECONDS = int(os.getenv("CLOUD_TIMEOUT_SECONDS", "90"))
CLOUD_MAX_TOKENS = max(0, int(os.getenv("CLOUD_MAX_TOKENS", "4096" if OPEN_REGISTRATION or not DEMO_MODE else "0")))
CLOUD_INPUT_USD_PER_MTOK = float(os.environ["CLOUD_INPUT_USD_PER_MTOK"]) if "CLOUD_INPUT_USD_PER_MTOK" in os.environ else None
CLOUD_OUTPUT_USD_PER_MTOK = float(os.environ["CLOUD_OUTPUT_USD_PER_MTOK"]) if "CLOUD_OUTPUT_USD_PER_MTOK" in os.environ else None
MATCH_THRESHOLD = float(os.getenv("QISHI_MATCH_THRESHOLD", "0.70"))
PAUSE_THRESHOLD = max(1, int(os.getenv("QISHI_PAUSE_THRESHOLD", "3")))
PAUSE_WINDOW_DAYS = max(1, int(os.getenv("QISHI_PAUSE_WINDOW_DAYS", "7")))
SOURCE_CATALOG = os.getenv("QISHI_SOURCE_CATALOG", "")
SEARCH_PROVIDER = os.getenv("QISHI_SEARCH_PROVIDER", "baidu").strip().lower()
# 问答库没命中时自动查共享资料的最低相关度；设成 1 以上可关闭自动兜底。
KNOWLEDGE_FALLBACK_SCORE = float(os.getenv("QISHI_KNOWLEDGE_FALLBACK_SCORE", "0.40"))
BAIDU_API_KEY = os.getenv("BAIDU_API_KEY", "").strip()
BRAVE_SEARCH_API_KEY = os.getenv("BRAVE_SEARCH_API_KEY", "").strip()
EMBEDDING_MODEL_PATH = os.getenv("QISHI_EMBEDDING_MODEL", "")
RERANKER_MODEL_PATH = os.getenv("QISHI_RERANKER_MODEL", "")
# 「画一只骑自行车的鹈鹕」默认给哪一版整页：complete / simple / simple2。
PELICAN_VARIANT = os.getenv("QISHI_PELICAN_VARIANT", "complete").strip().lower()
