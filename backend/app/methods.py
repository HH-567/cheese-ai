import csv
import io
import re
from datetime import date
from decimal import Decimal


METHODS = [
    {"id": "budget", "name": "预算余量", "fields": [
        {"id": "budget", "label": "总预算（元）", "placeholder": "1500"},
        {"id": "spent", "label": "已支出（元）", "placeholder": "638.50"},
    ]},
    {"id": "days", "name": "计算日期间隔", "fields": [
        {"id": "start", "label": "开始日期", "type": "date"},
        {"id": "end", "label": "结束日期", "type": "date"},
    ]},
    {"id": "csv", "name": "汇总 CSV 数值列", "fields": [
        {"id": "csv", "label": "CSV 文件", "type": "file"},
        {"id": "column", "label": "数值列名", "placeholder": "金额"},
    ]},
]


def number(value: str) -> Decimal:
    text = value.strip()
    if not re.fullmatch(r"[+-]?[0-9]{1,12}(?:\.[0-9]{1,6})?", text):
        raise ValueError("请输入有效数字，整数最多 12 位，小数最多 6 位。")
    return Decimal(text)


def display(value: Decimal) -> str:
    return format(value.normalize(), "f") if value else "0"


def run_method(method: str, fields: dict[str, str]) -> list[dict[str, str]]:
    def row(label: str, value: str) -> dict[str, str]:
        return {"label": label, "value": value}

    if method == "budget":
        budget, spent = number(fields["budget"]), number(fields["spent"])
        if min(budget, spent) < 0:
            raise ValueError("总预算和支出不能为负数。")
        return [row("预算余量", f"{display(budget - spent)} 元"),
                row("计算式", f"{display(budget)} − {display(spent)}")]
    if method == "days":
        try:
            start, end = date.fromisoformat(fields["start"]), date.fromisoformat(fields["end"])
        except ValueError as error:
            raise ValueError("请选择有效的开始日期和结束日期。") from error
        delta = (end - start).days
        if delta < 0:
            raise ValueError("结束日期不能早于开始日期。")
        return [row("日期间隔", f"{delta} 天"), row("包含首尾两天", f"{delta + 1} 天"),
                row("日期范围", f"{start.isoformat()} 至 {end.isoformat()}")]

    data, column_name = fields["csv"], fields["column"].strip()
    if len(data.encode("utf-8")) > 512_000:
        raise ValueError("CSV 文件不能超过 500 KB。")
    if not column_name:
        raise ValueError("请填写要汇总的列名。")
    parser = csv.reader(io.StringIO(data.lstrip("\ufeff"), newline=""), strict=True)
    try:
        header = [name.strip() for name in next(parser, [])]
        if header.count(column_name) != 1:
            raise ValueError("表头中需要有且仅有一个该列名。")
        index = header.index(column_name)
        count = empty = 0
        total = Decimal(0)
        for cells in parser:
            if not cells:
                continue
            if len(cells) != len(header):
                raise ValueError(f"CSV 第 {parser.line_num} 行的列数与表头不同。")
            if not cells[index].strip():
                empty += 1
                continue
            try:
                total += number(cells[index])
            except ValueError as error:
                raise ValueError(f"CSV 第 {parser.line_num} 行的「{column_name}」不是有效数字。") from error
            count += 1
    except csv.Error as error:
        raise ValueError(f"CSV 第 {parser.line_num} 行格式有误。") from error
    if not count:
        raise ValueError("这一列没有可汇总的数字。")
    return [row("汇总列", column_name), row("总和", display(total)),
            row("有效数值", str(count)), row("空值", str(empty))]
