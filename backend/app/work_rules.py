"""Owner-scoped Work rules built from successful, fixed tool sequences."""

from __future__ import annotations

import json
import re
import time
from typing import Any

from . import work
from .auth import read_scoped_payload, sign_scoped_payload


MAX_NAME_LENGTH = 40
MAX_RULES = 50
MAX_PARAMETERS = work.MAX_STEPS * max(map(len, work.TOOL_INPUTS.values()))
_DRAFT_SCOPE = "work-rule-draft"
_ASSIGNMENTS = re.compile(r"[\r\n;；]+")
_COMMAND = re.compile(r"运行规则\s*「(?P<name>[^「」\n\r]{1,40})」\s*(?:[:：]\s*(?P<values>[\s\S]*))?")


def _describe(steps: list[work.Step]) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    fields, bindings = [], []
    for index, step in enumerate(steps, 1):
        for field, value in step.inputs.items():
            item = {"key": f"{index}.{field}", "label": f"第 {index} 步 · {work.TOOL_INPUTS[step.tool][field]}"}
            if isinstance(value, work.Reference):
                bindings.append({**item, "reference": f"第 {value.index + 1} 步 · {value.output}"})
            else:
                fields.append({**item, "value": value})
    return fields, bindings


def make_draft(owner: str, steps: list[work.Step], *, spending_format: bool = False) -> dict:
    plan = []
    for step in steps:
        inputs = {}
        for key, value in step.inputs.items():
            if isinstance(value, work.Reference):
                inputs[key] = "{{" + f"{value.index + 1}:{value.output}" + "}}"
            else:
                inputs[key] = value
        plan.append({"tool": step.tool, "inputs": inputs})
    token = sign_scoped_payload(_DRAFT_SCOPE, {
        "owner": owner, "expires": int(time.time()) + 3600,
        "steps": plan, "spending_format": spending_format,
    })
    fields, bindings = _describe(steps)
    return {"token": token, "fields": fields, "bindings": bindings}


def read_draft(owner: str, token: str) -> dict:
    payload = read_scoped_payload(_DRAFT_SCOPE, token)
    if not payload or payload["owner"] != owner or payload["expires"] <= time.time():
        raise work.PlanError("规则草稿无效或已过期，请重新运行任务。")
    return {"steps": payload["steps"], "spending_format": payload["spending_format"]}


def rule_name(name: str) -> str:
    name = name.strip()
    if not name or re.search(r"[「」\x00-\x1f\ud800-\udfff]", name):
        raise work.PlanError("请填写有效的规则名称，名称不能含有「」或换行。")
    return name


def field_specs(plan: dict) -> list[dict[str, str]]:
    steps = work.validate_plan({"steps": plan["steps"]}, has_csv=True)
    return _describe(steps)[0]


def rule_view(row: Any) -> dict:
    plan = json.loads(row["plan_json"])
    parameters = set(json.loads(row["parameters_json"]))
    fields = [{"key": field["key"], "label": field["label"]} for field in field_specs(plan) if field["key"] in parameters]
    invocation = f"运行规则「{row['name']}」"
    if fields:
        invocation += "：\n" + "\n".join(f"{field['key']}=<{field['label']}>" for field in fields)
    return {"id": row["id"], "name": row["name"], "fields": fields, "invocation": invocation,
            "requires_csv": any(step["tool"] == "csv" for step in plan["steps"])}


def bind_values(row: Any, values: dict[str, str]) -> dict:
    plan = json.loads(row["plan_json"])
    parameters = set(json.loads(row["parameters_json"]))
    fields = {field["key"]: field["label"] for field in field_specs(plan)}
    if values.keys() - parameters:
        raise work.Clarification("只填写此规则列出的可变参数。")
    missing = [label for key, label in fields.items() if key in parameters and not values.get(key, "").strip()]
    if missing:
        raise work.Clarification("请填写参数：" + "、".join(missing) + "。")
    for key, value in values.items():
        index, field = key.split(".", 1)
        if "{{" in value:
            raise work.Clarification("可变参数请使用本次的实际值。")
        plan["steps"][int(index) - 1]["inputs"][field] = value
    return plan


def parse_assignments(text: str) -> dict[str, str]:
    values = {}
    for part in _ASSIGNMENTS.split(text):
        if not part.strip():
            continue
        key, separator, value = part.partition("=")
        key = key.strip()
        if not separator or not key or key in values:
            raise work.Clarification("请用「参数名=值」逐行填写，每个参数只填一次。")
        values[key] = value.strip()
    return values


def parse_command(goal: str) -> tuple[str, str] | None:
    match = _COMMAND.fullmatch(goal)
    return (match["name"], match["values"] or "") if match else None
