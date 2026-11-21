from datetime import datetime, time, timedelta, timezone

from . import config


class CloudQuotaExceeded(RuntimeError):
    pass


def _window(now: datetime) -> tuple[str, datetime]:
    return now.date().isoformat(), datetime.combine(now.date() + timedelta(days=1), time(), timezone.utc)


def cloud_quota(db, user_id: str, now: datetime | None = None) -> dict:
    day, reset = _window(now or datetime.now(timezone.utc))
    rows = db.execute("SELECT subject,calls FROM cloud_daily WHERE day=? AND subject IN (?,?)",
                      (day, "", user_id)).fetchall()
    calls = {row["subject"]: row["calls"] for row in rows}
    return {
        "limit": config.USER_DAILY_CLOUD_CALLS or None,
        "used": calls.get(user_id, 0),
        "site_exhausted": bool(config.SITE_DAILY_CLOUD_CALLS and calls.get("", 0) >= config.SITE_DAILY_CLOUD_CALLS),
        "resets_at": reset.isoformat(),
    }


def reserve_cloud(db, user_id: str) -> None:
    # The caller holds a write transaction. Reserve at launch, including attempts that later fail.
    now = datetime.now(timezone.utc)
    quota = cloud_quota(db, user_id, now)
    if quota["site_exhausted"]:
        raise CloudQuotaExceeded("工作区今日云端调用额度已用完，额度重置后可重试。")
    if quota["limit"] and quota["used"] >= quota["limit"]:
        raise CloudQuotaExceeded("你的今日云端调用额度已用完，额度重置后可重试。")
    db.executemany(
        """INSERT INTO cloud_daily(day,subject,calls) VALUES(?,?,1)
           ON CONFLICT(day,subject) DO UPDATE SET calls=cloud_daily.calls+1""",
        [(now.date().isoformat(), ""), (now.date().isoformat(), user_id)],
    )


def next_cloud_reset() -> float:
    return _window(datetime.now(timezone.utc))[1].timestamp()
