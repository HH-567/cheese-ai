from __future__ import annotations

import argparse
import json

from . import config
from .auth import hash_password
from .db import connect, initialize, now_iso, transaction
from .engine import uid
from .freshness import next_review_at
from .matcher import normalize
from .sources import GITHUB_REPOSITORY, github_release


def main() -> None:
    parser = argparse.ArgumentParser(description="柒柿AI 服务端管理工具")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create-user", help="创建登录用户")
    create.add_argument("--id", required=True)
    create.add_argument("--name", required=True)
    create.add_argument("--password", required=True)
    create.add_argument("--role", choices=("member", "admin"), default="member")
    create.add_argument("--library", default="QS-2048")
    revoke = commands.add_parser("revoke-member", help="撤销共享库成员资格")
    revoke.add_argument("--id", required=True)
    revoke.add_argument("--library", default="QS-2048")
    grant = commands.add_parser("grant-member", help="将已注册的账号加入共享库")
    grant.add_argument("--id", required=True)
    grant.add_argument("--library", default="QS-2048")
    grant.add_argument("--verified", action="store_true", help="为已核验身份的成员启用暂停投票资格")
    source = commands.add_parser("set-source", help="将问答绑定到来源目录并在下次提问时复核")
    source.add_argument("--group", required=True)
    source.add_argument("--key", required=True)
    source.add_argument("--version", required=True)
    source.add_argument("--review-days", type=int, default=1)
    release = commands.add_parser("track-release", help="将 GitHub 仓库的最新正式发布加入问答库")
    release.add_argument("--repo", required=True)
    release.add_argument("--owner", required=True)
    release.add_argument("--scope", choices=("personal", "shared"), default="personal")
    release.add_argument("--review-days", type=int, default=1)
    args = parser.parse_args()

    initialize()
    if args.command == "grant-member":
        with transaction() as db:
            if not db.execute("SELECT 1 FROM users WHERE id=?", (args.id,)).fetchone():
                parser.error("账号不存在")
            if not db.execute("SELECT 1 FROM libraries WHERE id=?", (args.library,)).fetchone():
                parser.error("共享库不存在")
            db.execute("INSERT OR IGNORE INTO library_members(library_id,user_id,role) VALUES(?,?,'member')",
                       (args.library, args.id))
            if args.verified:
                db.execute("UPDATE users SET verified=1 WHERE id=?", (args.id,))
        print("共享库成员资格已生效")
        return
    if args.command == "revoke-member":
        with transaction() as db:
            changed = db.execute("DELETE FROM library_members WHERE library_id=? AND user_id=?",
                                 (args.library, args.id)).rowcount
        print("已撤销成员资格" if changed else "该用户没有此库的成员资格")
        return
    if args.command == "set-source":
        if not args.key.strip() or not args.version.strip() or not 1 <= args.review_days <= 3650:
            parser.error("来源键和版本不可为空，复核间隔必须在 1 至 3650 天之间")
        with transaction() as db:
            changed = db.execute(
                """UPDATE groups SET freshness_kind='versioned',source=?,source_version=?,
                   review_at=?,review_interval_days=? WHERE id=?""",
                (args.key.strip(), args.version.strip(), now_iso(), args.review_days, args.group),
            ).rowcount
            if not changed:
                parser.error(f"问答组 {args.group} 不存在")
        print("已绑定来源，下次匹配时复核")
        return
    if args.command == "track-release":
        repo = args.repo.strip().lower()
        if not GITHUB_REPOSITORY.fullmatch(repo) or not 1 <= args.review_days <= 3650:
            parser.error("仓库格式需为 owner/repo，复核间隔须为 1 至 3650 天")
        version, answer = github_release(repo)
        if version is None or answer is None:
            parser.error("无法从 GitHub 核验该仓库的正式发布")
        with transaction() as db:
            if not db.execute("SELECT 1 FROM users WHERE id=?", (args.owner,)).fetchone():
                parser.error("所属账号不存在")
            if args.scope == "shared" and not db.execute(
                "SELECT 1 FROM library_members WHERE library_id='QS-2048' AND user_id=? AND role='admin'", (args.owner,)
            ).fetchone():
                parser.error("共享发布记录需要 QS-2048 的管理员作为所属账号")
            key = f"github-release:{repo}"
            if db.execute("SELECT 1 FROM groups WHERE source=? AND scope=? AND (?='shared' OR owner_id=?)",
                          (key, args.scope, args.scope, args.owner)).fetchone():
                parser.error("该问答库已经跟踪此仓库")
            group_id, now = uid("grp"), now_iso()
            version_id, question = f"{group_id}:v1", f"{repo} 的最新正式版本是什么？"
            db.execute(
                """INSERT INTO groups(id,owner_id,scope,original,intent,entities_json,current_version_id,
                   freshness_kind,source,source_version,last_checked_at,review_at,review_interval_days,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,'versioned',?,?,?,?,?,?,?)""",
                (group_id, args.owner, args.scope, question, f"查询 {repo} 的 GitHub 正式发布", json.dumps([repo]),
                 version_id, key, version, now, next_review_at(now, args.review_days), args.review_days, now, now),
            )
            db.execute("INSERT INTO group_versions(id,group_id,n,answer,basis,by_user_id,created_at) VALUES(?,?,1,?,?,?,?)",
                       (version_id, group_id, answer, "GitHub 最新正式发布", args.owner, now))
            for text, kind in ((question, "original"), (f"{repo} 最新稳定版是什么？", "seed")):
                db.execute("INSERT INTO aliases(id,group_id,text,text_key,source,created_at) VALUES(?,?,?,?,?,?)",
                           (uid("alias"), group_id, text, normalize(text), kind, now))
        print(f"已收录 {question}（{group_id}）")
        return
    if args.id.strip().lower() in config.DEMO_USER_IDS:
        parser.error("该账号 ID 已为演示保留")
    db = connect()
    try:
        if db.execute("SELECT 1 FROM users WHERE id=?", (args.id,)).fetchone():
            parser.error(f"用户 {args.id} 已存在")
        if not db.execute("SELECT 1 FROM libraries WHERE id=?", (args.library,)).fetchone():
            db.execute("INSERT INTO libraries(id,name,created_at) VALUES(?,?,?)", (args.library, "柒柿共享库", now_iso()))
        db.execute("INSERT INTO users(id,name,role,verified,password_hash,created_at) VALUES(?,?,?,?,?,?)",
                   (args.id, args.name, args.role, 1, hash_password(args.password), now_iso()))
        db.execute("INSERT INTO library_members(library_id,user_id,role) VALUES(?,?,?)",
                   (args.library, args.id, "admin" if args.role == "admin" else "member"))
        db.execute("INSERT INTO settings(user_id) VALUES(?)", (args.id,))
        db.commit()
        print(f"Created {args.role} user {args.id} in library {args.library}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
