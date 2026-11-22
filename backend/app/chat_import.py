"""Read visible text from supported chat exports without extracting ZIP files."""

import io
import json
import re
import zipfile
import zlib
from dataclasses import dataclass

MAX_UPLOAD = 64 * 1024 * 1024
MAX_EXPORT_TEXT = 32 * 1024 * 1024
MAX_CHATS = 1000
MAX_MESSAGES = 50_000
MAX_MESSAGE_LENGTH = 64_000


class ImportError(ValueError):
    pass


@dataclass
class Conversation:
    title: str
    provider: str
    messages: list[tuple[str, str]]


def _text(value):
    if not isinstance(value, str):
        return ""
    return re.sub(r"[\x00\ud800-\udfff]", "\ufffd", value).strip()


def _content(value):
    if isinstance(value, str):
        return _text(value)
    if isinstance(value, dict) and value.get("content_type") in ("text", "multimodal_text"):
        value = value.get("parts")
    if not isinstance(value, list):
        return ""
    return "\n\n".join(filter(None, (
        _text(item) if isinstance(item, str) else
        _text(item.get("text")) if isinstance(item, dict) and item.get("type") in ("text", "input_text", "output_text") else ""
        for item in value
    )))


def _branch(nodes, current):
    result = []
    visited = set()
    while current is not None:
        if not isinstance(current, (str, int)) or current in visited or current not in nodes:
            raise ImportError("对话的消息分支损坏。")
        visited.add(current)
        node = nodes[current]
        if not isinstance(node, dict):
            raise ImportError("对话消息格式无效。")
        result.append(node)
        current = node.get("parent", node.get("parent_id"))
    return reversed(result)


def _chatgpt(record):
    nodes = record["mapping"]
    current = record.get("current_node")
    if not isinstance(current, str) or current not in nodes:
        parents = {node.get("parent") for node in nodes.values()
                   if isinstance(node, dict) and isinstance(node.get("parent"), str)}
        current = next((key for key in reversed(nodes) if key not in parents), None)
    for node in _branch(nodes, current):
        message = node.get("message")
        if not isinstance(message, dict):
            continue
        author = message.get("author")
        metadata = message.get("metadata")
        if isinstance(metadata, dict) and metadata.get("is_visually_hidden_from_conversation"):
            continue
        if message.get("recipient", "all") != "all":
            continue
        yield (author.get("role") if isinstance(author, dict) else "", _content(message.get("content")))


def _linear(record):
    messages = [item for item in record["messages"] if isinstance(item, dict)]
    deepseek = any(isinstance(item.get("fragments"), list) for item in messages)
    if deepseek and any("parent_id" in item for item in messages):
        nodes = {item["id"]: item for item in messages if type(item.get("id")) is int}
        if len(nodes) != len(messages):
            raise ImportError("DeepSeek 消息编号无效。")
        current = record.get("current_message_id")
        if type(current) is not int or current not in nodes:
            current = max(nodes)
        messages = list(_branch(nodes, current))
    result = []
    for message in messages:
        role = str(message.get("role", "")).lower()
        if role not in {"user", "assistant"}:
            continue
        if isinstance(message.get("fragments"), list):
            if role == "assistant" and message.get("status") not in (None, "FINISHED"):
                continue
            kind = "REQUEST" if role == "user" else "RESPONSE"
            content = "\n\n".join(filter(None, (
                _text(item.get("content")) for item in message["fragments"]
                if isinstance(item, dict) and item.get("type") == kind
            )))
        else:
            content = _content(message.get("content"))
        result.append((role, content))
    return ("DeepSeek" if deepseek else "外部对话"), result


def _records(value):
    if isinstance(value, dict) and isinstance(value.get("conversations"), list):
        value = value["conversations"]
    if isinstance(value, list):
        if value and all(isinstance(item, dict) and "role" in item for item in value):
            yield {"messages": value}
        else:
            yield from value
    elif isinstance(value, dict):
        yield value


def _from_json(data):
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    return json.loads(data.decode("utf-8"))


def _zip_records(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = [entry for entry in archive.infolist() if re.fullmatch(
            r"(?:[^/]+/)*(?:conversations(?:[-_]\d+)?\.json|chat_sessions/[^/]+\.json)",
            entry.filename, flags=re.I,
        )]
        if not members:
            raise ImportError("ZIP 中没有找到可导入的对话 JSON。")
        if len(members) > MAX_CHATS or sum(entry.file_size for entry in members) > MAX_EXPORT_TEXT:
            raise ImportError("压缩包里的对话过多。请解压后分批导入 JSON。")
        remaining = MAX_EXPORT_TEXT
        for entry in sorted(members, key=lambda item: item.filename):
            with archive.open(entry) as file:
                raw = file.read(remaining + 1)
            remaining -= len(raw)
            if remaining < 0:
                raise ImportError("解压后的对话 JSON 超过 32 MB。")
            yield from _records(_from_json(raw))


def _paste(text):
    pattern = re.compile(
        r"^[ \t]*(?:#{1,6}\s+)?(?:\*\*)?(User|Assistant|ChatGPT|DeepSeek|用户|提问|助手|回答)(?:\*\*)?"
        r"[ \t]*(?:[:：](?:\*\*)?[ \t]*|$)(.*)$", re.I | re.M,
    )
    markers = list(pattern.finditer(text))
    for index, match in enumerate(markers):
        end = markers[index + 1].start() if index + 1 < len(markers) else len(text)
        role = "user" if match[1].lower() in {"user", "用户", "提问"} else "assistant"
        yield role, _text(text[match.start(2):end])


def parse(data: bytes) -> list[Conversation]:
    if not data:
        raise ImportError("请选择导出文件或粘贴对话。")
    results = []
    message_count = 0
    try:
        if data.startswith(b"PK"):
            records = _zip_records(data)
        elif len(data) > MAX_EXPORT_TEXT:
            raise ImportError("对话文本超过 32 MB，请分批导入。")
        elif data.removeprefix(b"\xef\xbb\xbf").lstrip().startswith((b"{", b"[")):
            records = _records(_from_json(data))
        else:
            records = [{"messages": [{"role": role, "content": content}
                                     for role, content in _paste(data.decode("utf-8-sig"))]}]
        for index, record in enumerate(records):
            if index >= MAX_CHATS:
                raise ImportError("每次最多导入 1000 个会话，请分批导入。")
            if not isinstance(record, dict):
                continue
            if isinstance(record.get("mapping"), dict):
                provider, pairs = "ChatGPT", _chatgpt(record)
            elif isinstance(record.get("messages"), list):
                provider, pairs = _linear(record)
            else:
                continue
            messages = []
            for role, content in pairs:
                if not content or role not in ("user", "assistant"):
                    continue
                message_count += 1
                if message_count > MAX_MESSAGES or len(content) > MAX_MESSAGE_LENGTH:
                    raise ImportError("对话文字过多。请分批导入，单条消息最多 64000 字。")
                messages.append((role, content))
            first = next((content for role, content in messages if role == "user"), "")
            if first:
                title = " ".join((_text(record.get("title")) or first).split())[:80]
                results.append(Conversation(title, provider, messages))
    except ImportError:
        raise
    except (ValueError, zipfile.BadZipFile, NotImplementedError, RuntimeError, EOFError, zlib.error) as error:
        raise ImportError("无法读取此文件。请上传有效的 ZIP、UTF-8 JSON 或带用户和助手标签的文本。") from error
    if not results:
        raise ImportError("没有找到可导入的对话。请上传对话导出文件，或用「用户：」「助手：」标记粘贴的内容。")
    return results
