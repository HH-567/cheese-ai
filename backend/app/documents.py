from __future__ import annotations

import io
import re
import unicodedata
from collections import Counter
from pathlib import PurePosixPath
from typing import TypedDict
from zipfile import ZipFile

from defusedxml.ElementTree import fromstring
from pypdf import PdfReader, apply_configuration


MAX_UPLOAD = 5 * 1024 * 1024
MAX_TEXT = 200_000
MAX_DOCUMENTS = 8
CHUNK_SIZE = 950
WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class DocumentError(ValueError):
    pass


class Chunk(TypedDict):
    location: str
    excerpt: str


def document_name(name: str) -> str:
    safe = PurePosixPath(name.replace("\\", "/")).name.strip()
    if not safe or len(safe) > 180 or any(unicodedata.category(char).startswith("C") for char in safe):
        raise DocumentError("文件名无效。")
    if PurePosixPath(safe).suffix.lower() not in {".pdf", ".docx", ".txt", ".md", ".csv"}:
        raise DocumentError("请选择 PDF、DOCX、TXT、Markdown 或 CSV 文件。")
    return safe


def _pdf_pages(data: bytes) -> list[str]:
    if not data.startswith(b"%PDF-"):
        raise DocumentError("文件内容不是 PDF。")
    reader = PdfReader(io.BytesIO(data), xref_stream_maximum_entries=100_000)
    if reader.is_encrypted:
        raise DocumentError("请先解锁这份 PDF，再上传。")
    pages = reader.pages
    if len(pages) > 60:
        raise DocumentError("PDF 最多支持 60 页。")
    output = []
    for page in pages:
        stream = page.get_contents()
        if stream is not None and len(stream.get_data()) > 2 * 1024 * 1024:
            raise DocumentError("PDF 中有页面内容过大。请拆分或导出为文本后上传。")
        output.append(page.extract_text() or "")
        if sum(map(len, output)) > MAX_TEXT:
            raise DocumentError("文档文字超过 20 万字符。请拆分后上传。")
    return output


def _word_paragraphs(data: bytes) -> list[str]:
    with ZipFile(io.BytesIO(data)) as archive:
        member = archive.getinfo("word/document.xml")
        if member.file_size > 2 * 1024 * 1024:
            raise DocumentError("Word 文档内容过大。请拆分后上传。")
        xml = fromstring(archive.read(member), forbid_dtd=True, forbid_entities=True, forbid_external=True)
    return ["".join(part.text or "" for part in paragraph.iter(WORD_NS + "t"))
            for paragraph in xml.iter(WORD_NS + "p")]


def _text_lines(data: bytes) -> list[str]:
    encodings = ("utf-16",) if data.startswith((b"\xff\xfe", b"\xfe\xff")) else ("utf-8-sig", "gb18030")
    for encoding in encodings:
        try:
            text = data.decode(encoding)
        except UnicodeError:
            continue
        if not any(ord(char) < 32 and char not in "\r\n\t" for char in text):
            return text.splitlines()
    raise DocumentError("无法读取文本，请另存为 UTF-8 或 GB18030 格式后上传。")


def _sections(parts: list[str], unit: str) -> list[Chunk]:
    if sum(map(len, parts)) > MAX_TEXT:
        raise DocumentError("文档文字超过 20 万字符。请拆分后上传。")
    chunks: list[Chunk] = []
    lines: list[str] = []
    start = end = size = 0

    def flush():
        if lines:
            position = f"第 {start} {unit}" if start == end else f"第 {start}–{end} {unit}"
            chunks.append({"location": position, "excerpt": "\n".join(lines)})
            lines.clear()

    for index, raw in enumerate(parts, 1):
        line = raw.strip()
        if not line:
            continue
        for offset in range(0, len(line), CHUNK_SIZE):
            piece = line[offset:offset + CHUNK_SIZE]
            if size + len(piece) + 1 > CHUNK_SIZE:
                flush()
                size = 0
            if not lines:
                start = index
            lines.append(piece)
            end = index
            size += len(piece) + 1
    flush()
    return chunks


def extract_document(name: str, data: bytes) -> list[Chunk]:
    extension = PurePosixPath(name).suffix.lower()
    try:
        if extension == ".pdf":
            with apply_configuration(
                zlib_maximum_output_length=4 * 1024 * 1024,
                lzw_maximum_output_length=4 * 1024 * 1024,
                array_based_stream_maximum_output_length=4 * 1024 * 1024,
                run_length_maximum_output_length=4 * 1024 * 1024,
                page_tree_maximum_entries=1_000,
                xform_maximum_invocations_per_extraction=100,
                jbig2dec_binary=None,
            ):
                pages = _pdf_pages(data)
            chunks = []
            for page, text in enumerate(pages, 1):
                for chunk in _sections(text.splitlines(), "行"):
                    chunks.append({"location": f"第 {page} 页 · {chunk['location']}（提取文本）",
                                   "excerpt": chunk["excerpt"]})
        elif extension == ".docx":
            chunks = _sections(_word_paragraphs(data), "段")
        else:
            chunks = _sections(_text_lines(data), "行")
    except DocumentError:
        raise
    except Exception as error:
        raise DocumentError("无法解析文件。请检查文件格式，或另存为文本后上传。") from error
    if not chunks:
        raise DocumentError("文件中没有可读取的文字。扫描件需先做文字识别。")
    return chunks


def search_terms(text: str) -> set[str]:
    pieces = re.findall(r"[a-z0-9]+|[\u3400-\u9fff]+", unicodedata.normalize("NFKC", text).casefold())
    terms = set()
    for piece in pieces:
        if re.match(r"[\u3400-\u9fff]", piece):
            terms.update(piece[index:index + 2] for index in range(max(1, len(piece) - 1)))
        else:
            terms.add(piece)
    return terms


def relevant_chunks(chunks: list[Chunk], query: str, earlier_query: str = "") -> list[Chunk]:
    current, earlier = search_terms(query), search_terms(earlier_query)
    query_terms = current | earlier
    weighted = [search_terms(chunk["excerpt"]) & query_terms for chunk in chunks]
    counts = Counter(term for terms in weighted for term in terms)
    scores = [sum((2 if term in current else 1) / counts[term] for term in terms) for terms in weighted]
    indices = sorted(range(len(chunks)), key=lambda index: (-scores[index], index))
    selected = [index for index in indices if scores[index] > 0][:5] or indices[:3]
    return [chunks[index] for index in sorted(selected)]


