"""Score CPU matching on a fresh snapshot of the demo library, without cloud or model downloads."""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory


B, E, M, R = "grp_bool_empty", "grp_excel_merge", "grp_mac_shot", "grp_react_hooks"
CALIBRATION = [
    ("Python 3 的 if 条件遇到空列表时会判断为真还是假？原因是什么？", B, "semantic"),
    ("Python 3 中空列表的布尔值是什么？", B, "semantic"),
    ("Excel 里怎么把两列文字拼接到一列？", E, "semantic"),
    ("Mac 如何只截取一个窗口？", M, "semantic"),
    ("React 中 useMemo 和 useEffect 有什么区别？", R, "semantic"),
    ("Python 3 的 bool(()) 返回什么？为什么？", None, "none"),
    ("Python 的非空列表在 if 条件下会判断为真还是假？", None, "none"),
    ("JavaScript 中空列表的布尔值是什么？", None, "none"),
    ("Excel 怎么把三列文字合并成一列？", None, "none"),
    ("Windows 怎么只截一个窗口？", None, "none"),
    ("React 中 useMemo 和 useCallback 有什么区别？", None, "none"),
    ("Excel 怎么把两列文字合并成一列，只返回公式？", None, "none"),
]
ACCEPTANCE = [
    ("Python 3 的 bool([]) 返回什么？为什么？", B, "exact"),
    ("Excel 怎么把两列文字合并成一列？", E, "exact"),
    ("苹果电脑如何截图一个窗口？", M, "alias"),
    ("useEffect 和 useMemo 有什么不同？", R, "alias"),
    ("Python 3 中 if 遇到空的列表会当成真还是假？", B, "semantic"),
    ("Python 3 中空列表的布尔值是 True 还是 False？", B, "semantic"),
    ("Excel 里如何把两列文字拼成一列？", E, "semantic"),
    ("Excel 怎样把两列文字合为一列？", E, "semantic"),
    ("macOS 怎么给单个窗口截图？", M, "semantic"),
    ("Mac 上怎么截取单个窗口的截图？", M, "semantic"),
    ("React 的 useEffect 和 useMemo 各有什么用？", R, "semantic"),
    ("在 React 里 useMemo 与 useEffect 的区别是什么？", R, "semantic"),
    ("Python 3 的 bool({}) 返回什么？为什么？", None, "none"),
    ("Python 3 的 bool([0]) 返回什么？为什么？", None, "none"),
    ("Python 2 的 bool([]) 返回什么？为什么？", None, "none"),
    ("Python 3 的 bool([]) 返回什么？为什么？请用日语回答", None, "none"),
    ("Python 3 中空列表的布尔值和空字典一样吗？", None, "none"),
    ("WPS 里怎么把两列文字拼接到一列？", None, "none"),
    ("Excel 里怎么把两列数字相加到一列？", None, "none"),
    ("Excel 怎么把两行文字合并成一行？", None, "none"),
    ("Excel 怎么把两列文字合并成一列，不用公式？", None, "none"),
    ("Mac 怎么只截一个窗口且不带阴影？", None, "none"),
    ("Mac 怎么录制一个窗口的视频？", None, "none"),
    ("Mac 怎么只截一个屏幕？", None, "none"),
    ("useMemo 和 useEffect 的执行顺序是什么？", None, "none"),
    ("React 中 useMemo 与 useEffect 的共同点是什么？", None, "none"),
]
CONDITION_REGRESSIONS = [
    ("Python2 的 bool([]) 返回什么？为什么？", None, "none"),
    ("python3的bool([])返回什么？为什么？", B, "exact"),
    ("Python 3 的 bool([]) 返回什么？请英文作答", None, "none"),
    ("Python 3 中列表的布尔值是 True 还是 False？", None, "none"),
    ("Excel 怎么把两列文字合并成两列？", None, "none"),
    ("Excel 怎么把两列文字合并成一列？只要给公式就行", None, "none"),
    ("Excel 怎么把两列文本合并成一列并去重？", None, "none"),
    ("React 中 useMemo 和 useEffect 怎么搭配？", None, "none"),
]


def evaluate(db, cases, threshold, show_mismatches=False):
    from app.matcher import analyze, normalize

    counts = Counter()
    for query, expected_group, expected_path in cases:
        if expected_path == "semantic":
            assert not db.execute("SELECT 1 FROM aliases WHERE text_key=?", (normalize(query),)).fetchone(), query
        result = analyze(db, query, "u-b", threshold)
        actual_group = result["chosen"]["id"] if result["chosen"] else None
        actual_path = result["match_type"]
        if (actual_group, actual_path) == (expected_group, expected_path):
            counts[expected_path] += 1
        elif actual_group is None:
            counts["missed"] += 1
        elif actual_group != expected_group:
            counts["wrong_reuse"] += 1
        else:
            counts["wrong_path"] += 1
        if show_mismatches and (actual_group, actual_path) != (expected_group, expected_path):
            print(f"  {query} -> {actual_group}, {actual_path}; expected {expected_group}, {expected_path}")
    return counts


def check_previous_observation(db, threshold):
    from app.db import now_iso
    from app.matcher import analyze, normalize

    query = "Python 3 中空列表的布尔值和空字典一样吗？"
    db.execute(
        "INSERT INTO aliases(id,group_id,text,text_key,source,created_at) VALUES(?,?,?,?,?,?)",
        ("old-observation", B, query, normalize(query), "observed", now_iso()),
    )
    assert analyze(db, query, "u-b", threshold)["chosen"] is None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--calibrate", action="store_true", help="Scan thresholds using only the calibration examples.")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "backend"))
    with TemporaryDirectory() as work:
        os.environ.update(
            QISHI_DATA_DIR=work, QISHI_DB_PATH=str(Path(work) / "acceptance.sqlite3"), QISHI_DEMO_MODE="1",
            QISHI_DEMO_SEED_PATH=str(root / "backend/data/seed_qa.json"),
            QISHI_EMBEDDING_MODEL="", QISHI_RERANKER_MODEL="",
        )
        from app import config
        from app.db import connect, initialize

        initialize()
        with closing(connect()) as db:
            if args.calibrate:
                for threshold in (0.60, 0.65, 0.70, 0.75, 0.80, 0.85):
                    scores = evaluate(db, CALIBRATION, threshold)
                    print(f"{threshold:.2f} ({len(CALIBRATION)} cases): {dict(scores)}")
                return
            scores = evaluate(db, ACCEPTANCE, config.MATCH_THRESHOLD, show_mismatches=True)
            print(f"Acceptance ({len(ACCEPTANCE)} cases, threshold {config.MATCH_THRESHOLD:.2f}): {dict(scores)}")
            assert sum(scores[path] for path in ("exact", "alias", "semantic", "none")) == len(ACCEPTANCE)
            conditions = evaluate(db, CONDITION_REGRESSIONS, config.MATCH_THRESHOLD, show_mismatches=True)
            assert conditions == {"exact": 1, "none": 7}, conditions
            check_previous_observation(db, config.MATCH_THRESHOLD)
            print(f"Passed {len(CONDITION_REGRESSIONS)} more condition checks and revalidated an old observed alias.")


if __name__ == "__main__":
    main()
