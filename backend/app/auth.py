from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

from fastapi import HTTPException, Request, Response

from . import config
from .db import connect, transaction


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _secret() -> bytes:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not config.SECRET_PATH.exists():
        temporary = config.DATA_DIR / f".secret-{secrets.token_hex(12)}"
        try:
            temporary.write_bytes(secrets.token_bytes(48))
            try:
                os.link(temporary, config.SECRET_PATH)
            except FileExistsError:
                pass
        finally:
            temporary.unlink(missing_ok=True)
    return config.SECRET_PATH.read_bytes()


def auth_attempt(request: Request, action: str, *, seconds: int, limit: int, site_limit: int | None = None) -> None:
    now = int(time.time())
    window = now // seconds * seconds
    host = request.client.host if request.client else "unknown"
    address_key = hmac.new(_secret(), host.encode(), hashlib.sha256).hexdigest()
    keys = [(address_key, limit), ("*", site_limit)] if site_limit else [(address_key, limit)]
    with transaction() as db:
        db.execute("DELETE FROM auth_limits WHERE window<?", (now - 86400,))
        for key, cap in keys:
            row = db.execute("SELECT attempts FROM auth_limits WHERE action=? AND client_key=? AND window=?",
                             (action, key, window)).fetchone()
            if row and row["attempts"] >= cap:
                raise HTTPException(429, "尝试次数过多，请稍后再试",
                                    headers={"Retry-After": str(window + seconds - now)})
            db.execute(
                """INSERT INTO auth_limits(action,client_key,window,attempts) VALUES(?,?,?,1)
                   ON CONFLICT(action,client_key,window) DO UPDATE SET attempts=auth_limits.attempts+1""",
                (action, key, window),
            )


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240_000)
    return f"pbkdf2_sha256${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, salt_text, digest_text = encoded.split("$", 2)
        if scheme != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text + "=" * (-len(salt_text) % 4))
        expected = base64.urlsafe_b64decode(digest_text + "=" * (-len(digest_text) % 4))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240_000)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def issue_token(user_id: str) -> tuple[str, str, int]:
    sid = secrets.token_urlsafe(24)
    expires = int(time.time()) + config.TOKEN_TTL_SECONDS
    payload = {"sub": user_id, "sid": sid, "exp": expires}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = _b64(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    with transaction() as db:
        db.execute("INSERT INTO auth_sessions(id,user_id,expires_at) VALUES(?,?,?)", (sid, user_id, expires))
    return f"{body}.{signature}", sid, expires


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        body, signature = token.split(".", 1)
        expected = _b64(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if int(payload.get("exp", 0)) <= int(time.time()):
            return None
        return payload
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def current_user(request: Request) -> dict[str, Any]:
    token = request.cookies.get(config.COOKIE_NAME)
    payload = decode_token(token) if token else None
    if not payload or (not config.DEMO_MODE and payload.get("sub") in config.DEMO_USER_IDS):
        raise HTTPException(status_code=401, detail="请先登录")
    db = connect()
    try:
        row = db.execute(
            """SELECT u.id,u.name,u.role,u.verified,s.id AS sid FROM users u
               JOIN auth_sessions s ON s.user_id=u.id
               WHERE u.id=? AND s.id=? AND s.revoked=0 AND s.expires_at>?""",
            (payload.get("sub"), payload.get("sid"), int(time.time())),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="登录已失效")
        return dict(row)
    finally:
        db.close()


def set_auth_cookie(response: Response, token: str, *, remember: bool = True) -> None:
    response.set_cookie(
        config.COOKIE_NAME, token, httponly=True, secure=config.COOKIE_SECURE,
        samesite="lax", max_age=config.TOKEN_TTL_SECONDS if remember else None, path="/",
    )
