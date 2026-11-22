"""Work API acceptance using a fresh database and a local cloud agent fixture."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from tempfile import TemporaryDirectory

import smoke_api
from cloud_flow import run_app
from smoke_api import Client

SPENDING = "帮我做活动支出简报：总预算1500元，用CSV的「金额」列汇总支出，再算预算余额。"
PREPARATION = "帮我做活动筹备简报：先算 2026-12-01 到 2026-12-05 的日期间隔，再用总预算 900 元和已支出 180 元算余额。"
CLOUD_GOAL = PREPARATION.split("：", 1)[1]
BRANCH_GOAL = "先汇总 CSV 的「金额」列。如果合计超过 600 元，用总预算 1500 元算余额；否则只报告合计。"
RECOVERY_GOAL = "先汇总 CSV 的「金额」列。如果缺这列，改为汇总「费用」列。"
SAVE_GOAL = "先汇总 CSV 中「金额」列，再用 1800 元总预算减去汇总支出。"
INVALID_TOOL = "先计算日期，再读取不支持的数据"
FORWARD_REFERENCE = "使用后续步骤的值"
INVALID_REFERENCE = "引用前一步的列名作为金额"
TOO_MANY_STEPS = "分别计算五组日期"
PRIVATE_HIGH = "内部栏目,金额\n内部标签,400.25\n另一条内部标签,238.25"
PRIVATE_LOW = "内部栏目,金额\n内部标签,300.13\n另一条内部标签,42.87"
WORK = "/api/work/run"
RULES = "/api/work/rules"

DAYS = {"tool": "days", "inputs": {"start": "2026-12-01", "end": "2026-12-05"}}
BUDGET = {"tool": "budget", "inputs": {"budget": 900, "spent": 180}}
CSV = {"tool": "csv", "inputs": {"column": "金额"}}
DONE = {"done": True}
REUSABLE = {**DONE, "reusable": True}


def choose_action(goal: str, observations: list[dict]) -> dict:
    if goal == BRANCH_GOAL:
        if not observations:
            return CSV
        if len(observations) == 1:
            assert observations[-1]["tool"] == "csv" and observations[-1]["status"] == "completed"
            total = next(row["value"] for row in observations[-1]["result"] if row["label"] == "总和")
            if Decimal(total) > 600:
                return {"tool": "budget", "inputs": {"budget": 1500, "spent": "{{1:总和}}"}}
        # Even an overly optimistic model should not make a conditional task reusable.
        return REUSABLE
    if goal == RECOVERY_GOAL:
        if not observations:
            return CSV
        if len(observations) == 1:
            assert observations[-1]["status"] == "failed" and observations[-1]["tool"] == "csv"
            return {"tool": "csv", "inputs": {"column": "费用"}}
        return REUSABLE
    if goal == TOO_MANY_STEPS:
        return {"tool": "days", "inputs": {"start": "2026-12-01", "end": f"2026-12-{5 + len(observations):02d}"}}
    actions = {
        CLOUD_GOAL: [DAYS, BUDGET, DONE],
        SAVE_GOAL: [CSV, {"tool": "budget", "inputs": {"budget": 1800, "spent": "{{1:总和}}"}}, REUSABLE],
        INVALID_TOOL: [DAYS, {"tool": "unknown", "inputs": {}}],
        FORWARD_REFERENCE: [DAYS, {"tool": "budget", "inputs": {"budget": 900, "spent": "{{3:总和}}"}}],
        INVALID_REFERENCE: [CSV, {"tool": "budget", "inputs": {"budget": 900, "spent": "{{1:汇总列}}"}}],
        "算 CSV 金额列平均值": [{"unsupported": True}],
        "算预算余额": [{"clarification": "请提供总预算和已支出金额。"}],
    }
    return actions[goal][len(observations)]


class PlannerFixture(BaseHTTPRequestHandler):
    calls: list[dict] = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        messages = body["messages"]
        serialized = json.dumps(body, ensure_ascii=False)
        raw_csv_markers = ("内部栏目", "内部标签", "400.25", "238.25", "300.13", "42.87")
        if (self.path != "/v1/chat/completions" or body["stream"] or len(messages) < 2
                or any(marker in serialized for marker in raw_csv_markers)):
            self.send_error(400)
            return
        try:
            request = json.loads(messages[1]["content"])
            assert messages[0]["role"] == "system" and messages[1]["role"] == "user"
            assert set(request) == {"goal", "has_csv"} and isinstance(request["has_csv"], bool)
            observations = []
            for offset in range(2, len(messages), 2):
                assistant, user = messages[offset:offset + 2]
                assert assistant["role"] == "assistant" and user["role"] == "user"
                assert json.loads(assistant["content"]) == choose_action(request["goal"], observations)
                observation_message = json.loads(user["content"])
                assert set(observation_message) == {"observation"}
                observation = observation_message["observation"]
                assert observation["index"] == len(observations) + 1
                assert observation["tool"] == json.loads(assistant["content"])["tool"]
                observations.append(observation)
        except (AssertionError, IndexError, KeyError, TypeError, ValueError):
            self.send_error(400)
            return

        self.calls.append({**request, "observations": observations})
        try:
            action = choose_action(request["goal"], observations)
        except KeyError:
            self.send_error(503)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        plan = json.dumps(action, ensure_ascii=False)
        self.wfile.write(json.dumps({"choices": [{"message": {"content": plan}, "finish_reason": "stop"}],
                                    "usage": {"prompt_tokens": 21, "completion_tokens": 13}}).encode())


def verify():
    request = urllib.request.Request(smoke_api.BASE_URL + WORK, data=b'{"goal":"work"}',
                                     headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(request)
    except urllib.error.HTTPError as error:
        assert error.code == 401
    else:
        raise AssertionError("Work requires authentication")

    owner, member = Client("u-a"), Client("u-b")

    def run(goal, csv=None, client=owner):
        return client.json("POST", WORK, {"goal": goal, "csv": csv})

    for csv, total, remaining in (
        ("金额\n400.25\n238.25", "638.50 元", "861.50 元"),
        ("金额\n400\n300", "700 元", "800 元"),
    ):
        result = run(SPENDING, csv)
        assert result["source"] == "rule" and result["cloud_calls"] == 0 and result["status"] == "completed", result
        assert [step["tool"] for step in result["steps"]] == ["csv", "budget"], result
        assert f"总和：{total}" in result["report"] and f"预算余量：{remaining}" in result["report"], result

    local_preparation = run(PREPARATION)
    assert local_preparation["source"] == "rule" and local_preparation["status"] == "completed", local_preparation
    assert run(SPENDING)["status"] == "clarification"
    assert run(SPENDING.replace("1500", ""), "金额\n200")["status"] == "clarification"
    missing_column = run(SPENDING, "费用\n100")
    assert [step["status"] for step in missing_column["steps"]] == ["failed", "skipped"], missing_column
    assert "已跳过" in missing_column["report"] and "表头" in missing_column["report"], missing_column
    assert not PlannerFixture.calls, PlannerFixture.calls

    combined = run(CLOUD_GOAL, PRIVATE_HIGH)
    assert combined["source"] == "cloud" and combined["status"] == "completed", combined
    assert combined["cloud_calls"] == 3 and [step["tool"] for step in combined["steps"]] == ["days", "budget"], combined
    assert "日期间隔：4 天" in combined["report"] and "预算余量：720 元" in combined["report"], combined

    above = run(BRANCH_GOAL, PRIVATE_HIGH)
    below = run(BRANCH_GOAL, PRIVATE_LOW)
    assert above["status"] == below["status"] == "completed", (above, below)
    assert above["cloud_calls"] == 3 and [step["tool"] for step in above["steps"]] == ["csv", "budget"], above
    assert below["cloud_calls"] == 2 and [step["tool"] for step in below["steps"]] == ["csv"], below
    assert not above.get("rule_draft") and not below.get("rule_draft"), (above, below)
    assert "预算余量：861.5" in above["report"] and "总和：343" in below["report"], (above, below)
    branch_calls = [call for call in PlannerFixture.calls if call["goal"] == BRANCH_GOAL]
    assert [len(call["observations"]) for call in branch_calls] == [0, 1, 2, 0, 1], branch_calls
    assert all(call["has_csv"] for call in branch_calls), branch_calls

    recovered = run(RECOVERY_GOAL, "费用\n55")
    assert [step["status"] for step in recovered["steps"]] == ["failed", "completed"], recovered
    assert recovered["status"] == "completed" and "总和：55" in recovered["report"], recovered
    assert not recovered.get("rule_draft"), recovered

    for goal, completed_tool in ((INVALID_TOOL, "days"), (FORWARD_REFERENCE, "days"), (INVALID_REFERENCE, "csv")):
        invalid = run(goal, PRIVATE_HIGH)
        assert invalid["status"] == "failed" and invalid["cloud_calls"] == 2, invalid
        assert [step["tool"] for step in invalid["steps"]] == [completed_tool], invalid
        assert invalid["steps"][0]["status"] == "completed" and "任务状态：未完成" in invalid["report"], invalid
    capped = run(TOO_MANY_STEPS)
    assert capped["status"] == "failed" and capped["cloud_calls"] == 5 and len(capped["steps"]) == 4, capped
    assert capped["report"], capped
    assert run("算 CSV 金额列平均值", PRIVATE_HIGH)["error_code"] == "unsupported_task"
    assert run("算预算余额")["status"] == "clarification"
    unavailable = run("模拟上游异常")
    assert unavailable["error_code"] == "cloud_unavailable" and unavailable["cloud_calls"] == 1, unavailable

    usage = owner.json("GET", "/api/usage")
    assert usage["total"] == 0 and usage["answer_calls"] == 0
    assert usage["work"] == {"total": 17, "completed": 7, "zero_cloud": 3, "cloud_calls": 25,
                             "average_cloud_calls": 1.471}, usage
    assert usage["quota"]["used"] == len(PlannerFixture.calls) == 25, usage
    calls = [row for row in usage["requests"] if row["cloud_calls"]]
    assert any(row["cloud_calls"] == 3 and row["tokens_in"] == 63 and row["tokens_out"] == 39
               and row["cost"] > 0 for row in calls), calls
    assert all(row["query"] == "Work 任务" and row["session_id"] is None for row in usage["requests"])
    assert owner.json("GET", "/api/groups")["total"] == 0
    assert not member.json("GET", "/api/usage")["work"]["total"]

    owner.json("PATCH", "/api/admin/members/u-b", {"daily_cloud_calls": 1})
    partial = run(CLOUD_GOAL, client=member)
    assert partial["error_code"] == "cloud_quota" and partial["cloud_calls"] == 1, partial
    assert [step["tool"] for step in partial["steps"]] == ["days"], partial
    assert "任务状态：未完成" in partial["report"] and "日期间隔：4 天" in partial["report"], partial
    gated = run(CLOUD_GOAL, client=member)
    assert gated["error_code"] == "cloud_quota" and gated["cloud_calls"] == 0, gated
    settings = member.json("GET", "/api/settings")
    member.json("PATCH", "/api/settings", {"disabled_models": [
        model["id"] for model in settings["models"] if model["kind"] == "cloud"
    ]})
    disabled = run(CLOUD_GOAL, client=member)
    assert disabled["error_code"] == "cloud_unavailable" and disabled["cloud_calls"] == 0, disabled
    assert run(SPENDING, "金额\n400\n300", client=member)["status"] == "completed"
    assert len(PlannerFixture.calls) == 26


def publish_rule() -> dict:
    owner, member = Client("u-a"), Client("u-b")
    assert owner.json("GET", RULES) == []
    run = owner.json("POST", WORK, {"goal": SAVE_GOAL, "csv": PRIVATE_HIGH})
    assert run["source"] == "cloud" and run["status"] == "completed" and run["cloud_calls"] == 3, run
    assert "1161.5" in run["report"], run
    draft = run["rule_draft"]
    assert {field["key"]: field["value"] for field in draft["fields"]} == {
        "1.column": "金额",
        "2.budget": "1800",
    }, draft

    save = {"token": draft["token"], "name": "月报", "parameter_keys": ["2.budget"]}
    altered = ("B" if save["token"].startswith("A") else "A") + save["token"][1:]
    for client, body in (
        (owner, {**save, "token": altered}),
        (member, save),
        (owner, {**save, "parameter_keys": ["2.spent"]}),
    ):
        status, response = client.request("POST", RULES, body)
        assert 400 <= status < 500, response

    rule = owner.json("POST", RULES, save)
    assert rule["name"] == "月报" and rule["requires_csv"], rule
    assert [field["key"] for field in rule["fields"]] == ["2.budget"], rule
    assert owner.json("GET", RULES) == [rule]
    assert member.json("GET", RULES) == []
    return rule


def verify_rule_after_restart(rule: dict) -> None:
    starting_calls = len(PlannerFixture.calls)
    owner, member = Client("u-a"), Client("u-b")
    key = "2.budget"
    body = {"rule_id": rule["id"], "values": {key: "1700"}, "csv": "项目,金额\n书,200\n笔,150"}
    rule_path = f"{RULES}/{rule['id']}"
    assert owner.json("GET", RULES) == [rule]

    for client, method, path, request in (
        (member, "POST", WORK, body),
        (member, "DELETE", rule_path, None),
        (owner, "POST", WORK, {**body, "values": {key: "1700", "2.spent": "0"}}),
    ):
        status, response = client.request(method, path, request)
        assert 400 <= status < 500 or json.loads(response)["status"] == "clarification", response

    def check_local(result: dict, expected: str) -> None:
        assert (result["source"], result["status"], result["cloud_calls"]) == ("rule", "completed", 0), result
        assert [step["tool"] for step in result["steps"]] == ["csv", "budget"], result
        balance = next(row["value"] for row in result["steps"][-1]["result"] if row["label"] == "预算余量")
        assert Decimal(balance.split()[0]) == Decimal(expected), result

    check_local(owner.json("POST", WORK, body), "1350")
    check_local(owner.json("POST", WORK, {"goal": "运行规则「月报」：2.budget=1600", "csv": "金额\n500"}), "1100")
    assert owner.json("DELETE", rule_path)["ok"]
    assert owner.json("GET", RULES) == []
    status, response = owner.request("POST", WORK, body)
    assert 400 <= status < 500 or json.loads(response)["status"] == "clarification", response
    assert len(PlannerFixture.calls) == starting_calls


def main():
    with ThreadingHTTPServer(("127.0.0.1", 0), PlannerFixture) as model, TemporaryDirectory() as data_dir:
        worker = threading.Thread(target=model.serve_forever, daemon=True)
        worker.start()
        try:
            with run_app(data_dir, model.server_port):
                verify()
                rule = publish_rule()
            with run_app(data_dir, model.server_port):
                verify_rule_after_restart(rule)
        finally:
            model.shutdown()
            worker.join()
    print("Work acceptance passed: adaptive branches, recovery, CSV privacy, quota and saved rule replay after restart.")


if __name__ == "__main__":
    main()
