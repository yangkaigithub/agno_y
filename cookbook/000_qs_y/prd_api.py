import asyncio
import io
import json
import os
import re
import sqlite3
import threading
import time
import traceback
import uuid
import zipfile
from xml.etree import ElementTree
from datetime import datetime
from pathlib import Path
from queue import Empty, Queue
from typing import List, Optional, Tuple

from agno.agent import Agent
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

MAX_MODEL_INPUT_BYTES = int(os.getenv("PRD_MAX_INPUT_BYTES", os.getenv("PRD_MAX_INPUT_LEN", "800000")))
DEFAULT_DOC_CHUNK_SIZE = int(os.getenv("DOC_CHUNK_SIZE", "2000"))


class DocUploadResponse(BaseModel):
    task_id: int
    session_id: str
    filename: str
    total_chunks: int
    chunk_size: int


class DocStatusResponse(BaseModel):
    task_id: int
    session_id: str
    filename: str
    status: str
    total_chunks: int
    next_chunk_index: int
    completed_chunks: int
    created_at: int
    updated_at: int
    error: Optional[str] = None


class DocTask(BaseModel):
    task_id: int
    session_id: str
    filename: str
    status: str
    total_chunks: int
    completed_chunks: int
    created_at: int
    updated_at: int
    error: Optional[str] = None


class DocTaskListResponse(BaseModel):
    items: List[DocTask]


class DocSummaryItem(BaseModel):
    chunk_index: int
    filename: str
    created_at: int
    content: str


class DocSummaryListResponse(BaseModel):
    session_id: str
    items: List[DocSummaryItem]

class VoiceAppendResponse(BaseModel):
    task_id: int
    session_id: str
    appended_chars: int
    total_chunks: int

class VoiceRefineResponse(BaseModel):
    session_id: str
    refined_text: str

class PrdRecord(BaseModel):
    id: int
    session_id: str
    file_path: str
    title: Optional[str] = None
    summary: Optional[str] = None
    created_at: int
    updated_at: int
    version: int
    status: str


class PrdLatestResponse(BaseModel):
    record: Optional[PrdRecord] = None
    filename: Optional[str] = None
    content: Optional[str] = None


def _utf8_len(text: str) -> int:
    return len(text.encode("utf-8"))


def _trim_to_utf8_bytes(text: str, max_bytes: int, *, from_end: bool = False) -> str:
    if not text or max_bytes <= 0:
        return ""
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    sliced = encoded[-max_bytes:] if from_end else encoded[:max_bytes]
    return sliced.decode("utf-8", errors="ignore")


def _decode_bytes(data: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "gb18030", "gbk"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1", errors="ignore")


async def _read_upload_text(upload: UploadFile) -> str:
    data = await upload.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")

    ext = Path(upload.filename or "").suffix.lower()
    content_type = (upload.content_type or "").lower()
    text_exts = {".txt", ".md", ".markdown", ".csv", ".json", ".log"}

    if ext in text_exts or content_type.startswith("text/"):
        return _decode_bytes(data).strip()

    if ext == ".pdf":
        try:
            from pypdf import PdfReader  # type: ignore
        except Exception as exc:
            raise HTTPException(status_code=400, detail="missing dependency: pypdf") from exc
        reader = PdfReader(io.BytesIO(data))
        text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
        return text.strip()

    if ext == ".docx":
        try:
            return _extract_docx_text(data).strip()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"failed to parse docx: {exc}") from exc

    if content_type in ("application/octet-stream", ""):
        decoded = _decode_bytes(data).strip()
        if decoded:
            return decoded

    raise HTTPException(status_code=400, detail="unsupported file type")


def _extract_docx_text(data: bytes) -> str:
    # Minimal dependency-free docx text extraction.
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid docx file") from exc

    candidates = ["word/document.xml"]
    for name in zf.namelist():
        if name.startswith("word/header") and name.endswith(".xml"):
            candidates.append(name)
        if name.startswith("word/footer") and name.endswith(".xml"):
            candidates.append(name)

    texts: List[str] = []
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

    def extract_from_xml(xml_bytes: bytes) -> None:
        root = ElementTree.fromstring(xml_bytes)
        for paragraph in root.findall(".//w:p", ns):
            runs = []
            for t in paragraph.findall(".//w:t", ns):
                if t.text:
                    runs.append(t.text)
            line = "".join(runs).strip()
            if line:
                texts.append(line)

    for name in candidates:
        try:
            xml_bytes = zf.read(name)
        except KeyError:
            continue
        extract_from_xml(xml_bytes)

    return "\n".join(texts).strip()


def _chunk_text(text: str, max_chars: int) -> List[str]:
    if not text:
        return []
    if max_chars <= 0:
        return [text.strip()]

    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", normalized) if p.strip()]
    if not paragraphs:
        paragraphs = [normalized]

    chunks: List[str] = []
    buffer = ""

    def flush_buffer() -> None:
        nonlocal buffer
        if buffer.strip():
            chunks.append(buffer.strip())
        buffer = ""

    sentence_split = re.compile(r"(?<=[。！？.!?])\s+")

    for paragraph in paragraphs:
        if len(paragraph) <= max_chars:
            if buffer and len(buffer) + 2 + len(paragraph) > max_chars:
                flush_buffer()
            buffer = f"{buffer}\n\n{paragraph}".strip()
            continue

        flush_buffer()
        sentences = [s.strip() for s in sentence_split.split(paragraph) if s.strip()]
        if len(sentences) <= 1:
            for idx in range(0, len(paragraph), max_chars):
                part = paragraph[idx : idx + max_chars].strip()
                if part:
                    chunks.append(part)
            continue

        sentence_buffer = ""
        for sentence in sentences:
            if len(sentence) > max_chars:
                if sentence_buffer:
                    chunks.append(sentence_buffer.strip())
                    sentence_buffer = ""
                for idx in range(0, len(sentence), max_chars):
                    part = sentence[idx : idx + max_chars].strip()
                    if part:
                        chunks.append(part)
                continue

            if sentence_buffer and len(sentence_buffer) + 1 + len(sentence) > max_chars:
                chunks.append(sentence_buffer.strip())
                sentence_buffer = sentence
            else:
                sentence_buffer = f"{sentence_buffer} {sentence}".strip()

        if sentence_buffer:
            chunks.append(sentence_buffer.strip())

    flush_buffer()
    return [c for c in chunks if c.strip()]


def _safe_filename(filename: str) -> str:
    name = Path(filename or "").name.strip()
    return name or "upload"


def _init_doc_task_table(db_path: str) -> None:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS doc_summary_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            chunk_size INTEGER NOT NULL,
            total_chunks INTEGER NOT NULL,
            next_chunk_index INTEGER NOT NULL DEFAULT 1,
            start_chunk_index INTEGER NOT NULL DEFAULT 1,
            end_chunk_index INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'queued',
            error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_doc_summary_tasks_session_id ON doc_summary_tasks(session_id)"
    )
    conn.commit()
    conn.close()


def _ensure_doc_task_columns(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(doc_summary_tasks)")
    cols = {row[1] for row in cursor.fetchall()}
    if "start_chunk_index" not in cols:
        cursor.execute("ALTER TABLE doc_summary_tasks ADD COLUMN start_chunk_index INTEGER NOT NULL DEFAULT 1")
    if "end_chunk_index" not in cols:
        cursor.execute("ALTER TABLE doc_summary_tasks ADD COLUMN end_chunk_index INTEGER NOT NULL DEFAULT 0")
    conn.commit()
    conn.close()


def _init_prd_table(db_path: str) -> None:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS prd_management (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            title TEXT,
            summary TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            version INTEGER DEFAULT 1,
            status TEXT DEFAULT 'running',
            UNIQUE(session_id, version)
        )
        """
    )
    conn.commit()
    conn.close()


def _create_prd_record(
    *,
    db_path: str,
    session_id: str,
    file_path: str,
    title: Optional[str],
    summary: Optional[str],
    status: str,
) -> int:
    now = int(time.time())
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COALESCE(MAX(version), 0) FROM prd_management WHERE session_id = ?",
        (session_id,),
    )
    row = cursor.fetchone()
    version = (int(row[0]) if row and row[0] is not None else 0) + 1
    cursor.execute(
        """
        INSERT OR IGNORE INTO prd_management
        (session_id, file_path, title, summary, created_at, updated_at, version, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (session_id, file_path, title, summary, now, now, version, status),
    )
    record_id = int(cursor.lastrowid)
    conn.commit()
    conn.close()
    return record_id


def _update_prd_record(
    *,
    db_path: str,
    record_id: int,
    file_path: Optional[str] = None,
    title: Optional[str] = None,
    summary: Optional[str] = None,
    status: Optional[str] = None,
) -> None:
    now = int(time.time())
    fields: List[str] = ["updated_at = ?"]
    values: List[object] = [now]
    if file_path is not None:
        fields.append("file_path = ?")
        values.append(file_path)
    if title is not None:
        fields.append("title = ?")
        values.append(title)
    if summary is not None:
        fields.append("summary = ?")
        values.append(summary)
    if status is not None:
        fields.append("status = ?")
        values.append(status)
    values.append(int(record_id))
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(f"UPDATE prd_management SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()


def _list_prd_records(db_path: str) -> List[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, session_id, file_path, title, summary, created_at, updated_at, version, status
        FROM prd_management
        ORDER BY updated_at DESC, id DESC
        """
    )
    rows = cursor.fetchall()
    conn.close()
    return list(rows)


def _get_prd_record(db_path: str, record_id: int) -> Optional[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, session_id, file_path, title, summary, created_at, updated_at, version, status
        FROM prd_management
        WHERE id = ?
        """,
        (int(record_id),),
    )
    row = cursor.fetchone()
    conn.close()
    return row


def _get_latest_prd_record(db_path: str, session_id: str) -> Optional[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, session_id, file_path, title, summary, created_at, updated_at, version, status
        FROM prd_management
        WHERE session_id = ?
        ORDER BY version DESC, id DESC
        LIMIT 1
        """,
        (session_id,),
    )
    row = cursor.fetchone()
    conn.close()
    return row


def _get_session_dirs(base_dir: Path, session_id: str) -> Tuple[Path, Path, Path, Path]:
    session_dir = (base_dir / session_id).resolve()
    if base_dir not in session_dir.parents and session_dir != base_dir:
        raise HTTPException(status_code=400, detail="invalid session path")
    original_dir = session_dir / "original"
    chunks_dir = session_dir / "chunks"
    summaries_dir = session_dir / "summaries"
    original_dir.mkdir(parents=True, exist_ok=True)
    chunks_dir.mkdir(parents=True, exist_ok=True)
    summaries_dir.mkdir(parents=True, exist_ok=True)
    return session_dir, original_dir, chunks_dir, summaries_dir


def _insert_doc_task(
    *,
    db_path: str,
    session_id: str,
    filename: str,
    file_path: str,
    chunk_size: int,
    total_chunks: int,
    start_chunk_index: int,
    end_chunk_index: int,
) -> int:
    now = int(time.time())
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO doc_summary_tasks
        (session_id, filename, file_path, chunk_size, total_chunks, next_chunk_index, start_chunk_index, end_chunk_index, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
        """,
        (
            session_id,
            filename,
            file_path,
            int(chunk_size),
            int(total_chunks),
            int(start_chunk_index),
            int(start_chunk_index),
            int(end_chunk_index),
            now,
            now,
        ),
    )
    task_id = int(cursor.lastrowid)
    conn.commit()
    conn.close()
    return task_id


def _get_task_by_id(db_path: str, task_id: int) -> Optional[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM doc_summary_tasks WHERE id = ?", (int(task_id),))
    row = cursor.fetchone()
    conn.close()
    return row


def _get_latest_task_by_session(db_path: str, session_id: str) -> Optional[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT *
        FROM doc_summary_tasks
        WHERE session_id = ?
        ORDER BY id DESC
        LIMIT 1
        """,
        (session_id,),
    )
    row = cursor.fetchone()
    conn.close()
    return row


def _list_tasks(db_path: str, limit: int = 100) -> List[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT *
        FROM doc_summary_tasks
        ORDER BY id DESC
        LIMIT ?
        """,
        (int(limit),),
    )
    rows = cursor.fetchall()
    conn.close()
    return list(rows)


def _list_pending_tasks(db_path: str) -> List[int]:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id
        FROM doc_summary_tasks
        WHERE status IN ('queued', 'running')
        ORDER BY id ASC
        """
    )
    ids = [int(row[0]) for row in cursor.fetchall()]
    conn.close()
    return ids


def _update_task_progress(
    *,
    db_path: str,
    task_id: int,
    status: Optional[str] = None,
    next_chunk_index: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    now = int(time.time())
    fields: List[str] = ["updated_at = ?"]
    values: List[object] = [now]
    if status is not None:
        fields.append("status = ?")
        values.append(status)
    if next_chunk_index is not None:
        fields.append("next_chunk_index = ?")
        values.append(int(next_chunk_index))
    if error is not None:
        fields.append("error = ?")
        values.append(error)
    values.append(int(task_id))
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(f"UPDATE doc_summary_tasks SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()


def _get_max_chunk_index(chunks_dir: Path) -> int:
    max_index = 0
    for entry in chunks_dir.glob("chunk_*.txt"):
        m = re.match(r"^chunk_(\d{4,})\.txt$", entry.name)
        if not m:
            continue
        try:
            max_index = max(max_index, int(m.group(1)))
        except Exception:
            continue
    return max_index


def _build_chunk_summary_prompt(*, chunk_text: str, max_bytes: int) -> str:
    header = (
        "你是分段总结助手，请对给定文本提炼要点（不超过10条）。\n"
        "要求：\n"
        "1) 尽可能抓住关键需求/约束/决策/风险/指标/范围。\n"
        "2) 不要写 PRD，不要解释，不要前言。\n"
        "3) 输出格式：仅使用有序列表（1. 2. 3. ...），不要标题。\n\n"
        "文本：\n<<<\n"
    )
    tail = "\n>>>\n"
    budget = max_bytes - _utf8_len(header) - _utf8_len(tail)
    if budget <= 0:
        return ""
    chunk_text = (chunk_text or "").strip()
    chunk_text = _trim_to_utf8_bytes(chunk_text, budget, from_end=False)
    return f"{header}{chunk_text}{tail}"


def _build_prd_update_prompt(*, previous_prd: str, summaries_md: str, max_bytes: int) -> str:
    header = (
        "你是 PRD 文档生成专家，请输出“可直接开工”的落地详细版 PRD（Markdown）。\n"
        "请基于【上一版PRD】+【新增要点】产出最新完整 PRD（覆盖上一版），不需要输出冲突检测过程或对比说明，只写最终版本。\n"
        "原则：只写输入中能支撑的事实；任何不确定/缺失/需要业务确认的内容，必须写入【待澄清】并在条目前加前缀：【待澄清N】（N 从 1 开始递增）。\n"
        "格式要求：只输出 Markdown；不要输出任何 HTML 标签（例如 <span>、<table> 等）；表格必须使用 Markdown 管道表格（| a | b |）。\n"
        "PRD 结构要求：至少包含 背景与问题、目标、范围/非目标、用户与场景、功能需求（含流程/异常/字段/验收）、非功能需求、埋点指标、风险与对策、待澄清。\n"
        "写作要求：条理清晰、术语一致、尽量用表格描述字段/状态/接口；每个功能点必须给出可验收的标准（Given-When-Then）。\n"
        "只输出 PRD Markdown，不要解释。\n\n"
        "上一版 PRD（可能为空）：\n<<<\n"
    )
    mid = "\n>>>\n\n新增要点（来自分段总结，可能很多）：\n<<<\n"
    tail = "\n>>>\n"
    budget = max_bytes - _utf8_len(header) - _utf8_len(mid) - _utf8_len(tail)
    if budget <= 0:
        return ""

    previous_prd = (previous_prd or "").strip()
    summaries_md = (summaries_md or "").strip()
    if not summaries_md:
        return ""

    # Give priority to summaries; truncate previous PRD if needed.
    if _utf8_len(summaries_md) >= budget:
        summaries_md = _trim_to_utf8_bytes(summaries_md, budget, from_end=True)
        previous_prd = ""
    else:
        remaining = budget - _utf8_len(summaries_md)
        previous_prd = _trim_to_utf8_bytes(previous_prd, remaining, from_end=True) if remaining > 0 else ""

    return f"{header}{previous_prd}{mid}{summaries_md}{tail}"


def _parse_chunk_index_from_summary_filename(name: str) -> Optional[int]:
    m = re.match(r"^summary_(\d{4})_", name)
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def build_api_app(
    *,
    summary_agent: Agent,
    prd_agent: Agent,
    db_path: str = "tmp/prd.db",
    prd_docs_dir: Optional[Path] = None,
    cors_origins: Optional[List[str]] = None,
) -> FastAPI:
    app = FastAPI(title="Doc Summary API", version="1.0.0")

    if cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["*"],
        )

    base_dir = (prd_docs_dir or (Path(__file__).resolve().parent / "tmp" / "prd_docs")).resolve()
    base_dir.mkdir(parents=True, exist_ok=True)
    _init_doc_task_table(db_path)
    _ensure_doc_task_columns(db_path)
    _init_prd_table(db_path)

    def _ensure_worker_started() -> None:
        if getattr(app.state, "doc_worker_started", False):
            return
        app.state.doc_worker_started = True
        app.state.doc_task_queue = Queue()
        app.state.doc_worker_stop = threading.Event()

        async def _process_task(task_id: int) -> None:
            row = _get_task_by_id(db_path, int(task_id))
            if not row:
                return
            status = str(row["status"] or "")
            if status in ("done", "failed"):
                return

            _update_task_progress(db_path=db_path, task_id=int(task_id), status="running", error=None)

            def _row_int(key: str, default: int) -> int:
                try:
                    if isinstance(row, sqlite3.Row) and key in row.keys():
                        value = row[key]
                    else:
                        value = row[key]  # type: ignore[index]
                    if value is None:
                        return default
                    return int(value)
                except Exception:
                    return default

            session_id = str(row["session_id"])
            _, _, chunks_dir, summaries_dir = _get_session_dirs(base_dir, session_id)
            cumulative_path = summaries_dir / "prd.md"
            cumulative = ""
            if cumulative_path.exists():
                try:
                    cumulative = cumulative_path.read_text(encoding="utf-8")
                except Exception:
                    cumulative = ""

            # Ensure we have a PRD record for this session/task.
            prd_state_path = summaries_dir / "prd_record_id.txt"
            prd_record_id: Optional[int] = None
            if prd_state_path.exists():
                try:
                    prd_record_id = int(prd_state_path.read_text(encoding="utf-8").strip() or "0") or None
                except Exception:
                    prd_record_id = None
            if prd_record_id is None:
                title = f"PRD-{session_id}"
                summary = None
                prd_rel = str(Path(session_id) / "summaries" / "prd.md")
                prd_record_id = _create_prd_record(
                    db_path=db_path,
                    session_id=session_id,
                    file_path=prd_rel,
                    title=title,
                    summary=summary,
                    status="running",
                )
                prd_state_path.write_text(str(prd_record_id), encoding="utf-8")

            total_chunks = _row_int("total_chunks", 0)
            next_index = _row_int("next_chunk_index", 1)
            start_index = _row_int("start_chunk_index", 1)
            end_index = _row_int("end_chunk_index", 0)
            if total_chunks <= 0:
                _update_task_progress(
                    db_path=db_path,
                    task_id=int(task_id),
                    status="failed",
                    error="invalid total_chunks",
                )
                return
            if end_index <= 0:
                # Backward compatibility if old rows exist without proper end index.
                end_index = start_index + total_chunks - 1
            if next_index < start_index:
                next_index = start_index

            summaries_acc: List[str] = []

            while next_index <= end_index and not app.state.doc_worker_stop.is_set():
                chunk_path = chunks_dir / f"chunk_{next_index:04d}.txt"
                try:
                    chunk_text = chunk_path.read_text(encoding="utf-8")
                except Exception as exc:
                    _update_task_progress(
                        db_path=db_path,
                        task_id=int(task_id),
                        status="failed",
                        error=f"failed to read chunk {next_index}: {exc}",
                    )
                    return

                summary_prompt = _build_chunk_summary_prompt(chunk_text=chunk_text, max_bytes=MAX_MODEL_INPUT_BYTES)
                if not summary_prompt:
                    _update_task_progress(db_path=db_path, task_id=int(task_id), status="failed", error="prompt budget too small")
                    return

                run = await summary_agent.arun(summary_prompt, session_id=session_id)
                content = run.content if run and hasattr(run, "content") else ""
                if content is None:
                    chunk_summary = ""
                elif isinstance(content, str):
                    chunk_summary = content
                else:
                    chunk_summary = str(content)
                chunk_summary = (chunk_summary or "").strip()
                if not chunk_summary:
                    chunk_summary = "- （无要点）"

                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                summary_path = summaries_dir / f"summary_{next_index:04d}_{ts}.md"
                summary_path.write_text(chunk_summary.strip() + "\n", encoding="utf-8")
                summaries_acc.append(chunk_summary)

                next_index += 1
                _update_task_progress(
                    db_path=db_path,
                    task_id=int(task_id),
                    status="running",
                    next_chunk_index=next_index,
                )

            if next_index > end_index:
                # Update PRD once per task from aggregated summaries + previous PRD.
                summaries_md = "\n\n".join(summaries_acc).strip()
                prd_prompt = _build_prd_update_prompt(previous_prd=cumulative, summaries_md=summaries_md, max_bytes=MAX_MODEL_INPUT_BYTES)
                if prd_prompt:
                    prd_run = await prd_agent.arun(prd_prompt, session_id=session_id)
                    prd_content = prd_run.content if prd_run and hasattr(prd_run, "content") else ""
                    if prd_content is None:
                        prd_text = ""
                    elif isinstance(prd_content, str):
                        prd_text = prd_content
                    else:
                        prd_text = str(prd_content)
                    prd_text = (prd_text or "").strip()
                    if prd_text:
                        cumulative = prd_text
                        cumulative_path.write_text(cumulative.strip() + "\n", encoding="utf-8")

                if prd_record_id is not None:
                    prd_title = f"PRD-{session_id}"
                    prd_lines = [line.strip() for line in cumulative.splitlines() if line.strip()]
                    if prd_lines and prd_lines[0].startswith("#"):
                        prd_title = prd_lines[0].lstrip("#").strip() or prd_title
                    prd_summary = cumulative.replace("\n", " ").strip()
                    if len(prd_summary) > 200:
                        prd_summary = prd_summary[:200] + "..."
                    _update_prd_record(
                        db_path=db_path,
                        record_id=int(prd_record_id),
                        file_path=str(Path(session_id) / "summaries" / "prd.md"),
                        title=prd_title,
                        summary=prd_summary,
                        status="done",
                    )
                _update_task_progress(
                    db_path=db_path,
                    task_id=int(task_id),
                    status="done",
                    next_chunk_index=next_index,
                )

        async def _worker_loop() -> None:
            for task_id in _list_pending_tasks(db_path):
                app.state.doc_task_queue.put(task_id)

            while not app.state.doc_worker_stop.is_set():
                try:
                    task_id = app.state.doc_task_queue.get(timeout=0.5)
                except Empty:
                    continue
                try:
                    await _process_task(int(task_id))
                except Exception as exc:
                    tb = traceback.format_exc()
                    message = tb.strip() or str(exc)
                    if len(message) > 4000:
                        message = message[:4000] + "\n...truncated..."
                    _update_task_progress(
                        db_path=db_path,
                        task_id=int(task_id),
                        status="failed",
                        error=message,
                    )
                finally:
                    try:
                        app.state.doc_task_queue.task_done()
                    except Exception:
                        pass

        def run_thread() -> None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(_worker_loop())

        app.state._doc_worker_thread = threading.Thread(target=run_thread, daemon=True)
        app.state._doc_worker_thread.start()

    @app.on_event("startup")
    async def _startup() -> None:
        _ensure_worker_started()

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        if hasattr(app.state, "doc_worker_stop"):
            app.state.doc_worker_stop.set()

    @app.post("/api/docs/upload", response_model=DocUploadResponse)
    async def upload_document(
        file: UploadFile = File(...),
        session_id: Optional[str] = Form(default=None),
        chunk_size: int = Form(default=DEFAULT_DOC_CHUNK_SIZE),
    ) -> DocUploadResponse:
        if int(chunk_size) < 200:
            raise HTTPException(status_code=400, detail="chunk_size too small")

        text = await _read_upload_text(file)
        if not text:
            raise HTTPException(status_code=400, detail="empty document content")

        chunks = _chunk_text(text, max_chars=int(chunk_size))
        if not chunks:
            raise HTTPException(status_code=400, detail="failed to chunk document")

        doc_session_id = (session_id or "").strip() or uuid.uuid4().hex
        _, original_dir, chunks_dir, _ = _get_session_dirs(base_dir, doc_session_id)

        safe_name = _safe_filename(file.filename or "upload")
        (original_dir / safe_name).write_text(text.strip() + "\n", encoding="utf-8")

        start_chunk_index = _get_max_chunk_index(chunks_dir) + 1
        end_chunk_index = start_chunk_index + len(chunks) - 1
        for offset, chunk in enumerate(chunks, start=0):
            idx = start_chunk_index + offset
            (chunks_dir / f"chunk_{idx:04d}.txt").write_text(chunk.strip() + "\n", encoding="utf-8")

        original_rel = str(Path(doc_session_id) / "original" / safe_name)
        task_id = _insert_doc_task(
            db_path=db_path,
            session_id=doc_session_id,
            filename=safe_name,
            file_path=original_rel,
            chunk_size=int(chunk_size),
            total_chunks=len(chunks),
            start_chunk_index=start_chunk_index,
            end_chunk_index=end_chunk_index,
        )

        _ensure_worker_started()
        app.state.doc_task_queue.put(int(task_id))

        return DocUploadResponse(
            task_id=int(task_id),
            session_id=doc_session_id,
            filename=safe_name,
            total_chunks=len(chunks),
            chunk_size=int(chunk_size),
        )

    @app.post("/api/voice/append", response_model=VoiceAppendResponse)
    async def append_voice_text(
        session_id: str = Form(...),
        text: str = Form(...),
        chunk_size: int = Form(default=500),
    ) -> VoiceAppendResponse:
        session_id = (session_id or "").strip()
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        text = (text or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="text is required")
        if int(chunk_size) < 200:
            raise HTTPException(status_code=400, detail="chunk_size too small")

        # Save voice raw text snapshot
        _, original_dir, chunks_dir, _ = _get_session_dirs(base_dir, session_id)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        voice_name = f"voice_{ts}.txt"
        (original_dir / voice_name).write_text(text + "\n", encoding="utf-8")

        chunks = _chunk_text(text, max_chars=int(chunk_size))
        if not chunks:
            raise HTTPException(status_code=400, detail="failed to chunk text")

        start_chunk_index = _get_max_chunk_index(chunks_dir) + 1
        end_chunk_index = start_chunk_index + len(chunks) - 1
        for offset, chunk in enumerate(chunks, start=0):
            idx = start_chunk_index + offset
            (chunks_dir / f"chunk_{idx:04d}.txt").write_text(chunk.strip() + "\n", encoding="utf-8")

        original_rel = str(Path(session_id) / "original" / voice_name)
        task_id = _insert_doc_task(
            db_path=db_path,
            session_id=session_id,
            filename=voice_name,
            file_path=original_rel,
            chunk_size=int(chunk_size),
            total_chunks=len(chunks),
            start_chunk_index=start_chunk_index,
            end_chunk_index=end_chunk_index,
        )

        _ensure_worker_started()
        app.state.doc_task_queue.put(int(task_id))

        return VoiceAppendResponse(
            task_id=int(task_id),
            session_id=session_id,
            appended_chars=len(text),
            total_chunks=len(chunks),
        )

    @app.post("/api/voice/refine", response_model=VoiceRefineResponse)
    async def refine_voice_text(
        session_id: str = Form(...),
        context: str = Form(default=""),
        text: str = Form(...),
    ) -> VoiceRefineResponse:
        session_id = (session_id or "").strip()
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        context = (context or "").strip()
        text = (text or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="text is required")

        prompt = (
            "你是中文语音转写修正助手。\n"
            "请根据上下文修正下面的转写文本：纠错别字、补标点、合理断句、去口癖/重复。\n"
            "要求：\n"
            "1) 不要添加不存在的新信息。\n"
            "2) 输出只包含修正后的文本，不要解释。\n\n"
            "已确认上下文（用于术语一致性，可能为空）：\n<<<\n"
            f"{_trim_to_utf8_bytes(context, 4000, from_end=True)}\n"
            ">>>\n\n"
            "待修正文本：\n<<<\n"
            f"{_trim_to_utf8_bytes(text, 12000, from_end=False)}\n"
            ">>>\n"
        )

        run = await summary_agent.arun(prompt, session_id=session_id)
        content = run.content if run and hasattr(run, "content") else ""
        if content is None:
            refined = ""
        elif isinstance(content, str):
            refined = content
        else:
            refined = str(content)
        refined = (refined or "").strip()
        return VoiceRefineResponse(session_id=session_id, refined_text=refined)

    @app.get("/api/docs/status", response_model=DocStatusResponse)
    async def doc_status(task_id: Optional[int] = None, session_id: Optional[str] = None) -> DocStatusResponse:
        row: Optional[sqlite3.Row] = None
        if task_id is not None:
            row = _get_task_by_id(db_path, int(task_id))
        elif session_id:
            row = _get_latest_task_by_session(db_path, session_id)
        else:
            raise HTTPException(status_code=400, detail="task_id or session_id is required")

        if not row:
            raise HTTPException(status_code=404, detail="task not found")

        total_chunks = int(row["total_chunks"] or 0)
        next_chunk_index = int(row["next_chunk_index"] or 1)
        start_chunk_index = int(row["start_chunk_index"] or 1) if "start_chunk_index" in row.keys() else 1
        completed = max(0, min(total_chunks, next_chunk_index - start_chunk_index))
        return DocStatusResponse(
            task_id=int(row["id"]),
            session_id=str(row["session_id"]),
            filename=str(row["filename"]),
            status=str(row["status"]),
            total_chunks=total_chunks,
            next_chunk_index=next_chunk_index,
            completed_chunks=completed,
            created_at=int(row["created_at"]),
            updated_at=int(row["updated_at"]),
            error=(str(row["error"]) if row["error"] is not None else None),
        )

    @app.get("/api/docs/list", response_model=DocTaskListResponse)
    async def docs_list(limit: int = 100) -> DocTaskListResponse:
        rows = _list_tasks(db_path, limit=int(limit))
        items: List[DocTask] = []
        for row in rows:
            total_chunks = int(row["total_chunks"] or 0)
            next_chunk_index = int(row["next_chunk_index"] or 1)
            completed = max(0, min(total_chunks, next_chunk_index - 1))
            items.append(
                DocTask(
                    task_id=int(row["id"]),
                    session_id=str(row["session_id"]),
                    filename=str(row["filename"]),
                    status=str(row["status"]),
                    total_chunks=total_chunks,
                    completed_chunks=completed,
                    created_at=int(row["created_at"]),
                    updated_at=int(row["updated_at"]),
                    error=(str(row["error"]) if row["error"] is not None else None),
                )
            )
        return DocTaskListResponse(items=items)

    @app.get("/api/docs/summaries", response_model=DocSummaryListResponse)
    async def doc_summaries(session_id: str) -> DocSummaryListResponse:
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")

        session_dir, _, _, summaries_dir = _get_session_dirs(base_dir, session_id)
        if not session_dir.exists():
            return DocSummaryListResponse(session_id=session_id, items=[])

        items: List[DocSummaryItem] = []
        for entry in summaries_dir.glob("summary_*.md"):
            if entry.name == "cumulative.md":
                continue
            chunk_index = _parse_chunk_index_from_summary_filename(entry.name)
            if chunk_index is None:
                continue
            try:
                content = entry.read_text(encoding="utf-8")
            except Exception:
                content = ""
            created_at = int(entry.stat().st_mtime)
            items.append(
                DocSummaryItem(
                    chunk_index=chunk_index,
                    filename=entry.name,
                    created_at=created_at,
                    content=content,
                )
            )

        items.sort(key=lambda item: (item.chunk_index, item.created_at))
        return DocSummaryListResponse(session_id=session_id, items=items)

    @app.get("/api/docs/cumulative")
    async def doc_cumulative(session_id: str):
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        _, _, _, summaries_dir = _get_session_dirs(base_dir, session_id)
        path = summaries_dir / "prd.md"
        if not path.exists():
            return {"session_id": session_id, "content": ""}
        try:
            content = path.read_text(encoding="utf-8")
        except Exception:
            content = ""
        return {"session_id": session_id, "content": content}

    @app.get("/api/docs/download/original")
    async def download_original(session_id: str, filename: str):
        if not session_id or not filename:
            raise HTTPException(status_code=400, detail="session_id and filename are required")
        _, original_dir, _, _ = _get_session_dirs(base_dir, session_id)
        path = (original_dir / _safe_filename(filename)).resolve()
        if base_dir not in path.parents and path != base_dir:
            raise HTTPException(status_code=400, detail="invalid path")
        if not path.exists():
            raise HTTPException(status_code=404, detail="file not found")
        return FileResponse(path=str(path), media_type="text/plain", filename=path.name)

    @app.get("/api/docs/download/cumulative")
    async def download_cumulative(session_id: str):
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        _, _, _, summaries_dir = _get_session_dirs(base_dir, session_id)
        path = (summaries_dir / "prd.md").resolve()
        if base_dir not in path.parents and path != base_dir:
            raise HTTPException(status_code=400, detail="invalid path")
        if not path.exists():
            raise HTTPException(status_code=404, detail="file not found")
        return FileResponse(path=str(path), media_type="text/markdown", filename=path.name)

    @app.get("/api/prd/list", response_model=List[PrdRecord])
    async def prd_list() -> List[PrdRecord]:
        rows = _list_prd_records(db_path)
        return [PrdRecord(**dict(row)) for row in rows]

    @app.get("/api/prd/latest", response_model=PrdLatestResponse)
    async def prd_latest(session_id: str) -> PrdLatestResponse:
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")
        row = _get_latest_prd_record(db_path, session_id)
        if not row:
            return PrdLatestResponse(record=None, filename=None, content=None)
        record = PrdRecord(**dict(row))
        file_path = Path(record.file_path)
        if not file_path.is_absolute():
            file_path = base_dir / file_path
        resolved = file_path.resolve()
        content = None
        filename = None
        if (base_dir in resolved.parents or resolved == base_dir) and resolved.exists():
            filename = resolved.name
            try:
                content = resolved.read_text(encoding="utf-8")
            except Exception:
                content = ""
        return PrdLatestResponse(record=record, filename=filename, content=content)

    @app.get("/api/prd/download/{record_id}")
    async def prd_download(record_id: int):
        row = _get_prd_record(db_path, int(record_id))
        if not row:
            raise HTTPException(status_code=404, detail="record not found")
        file_path = Path(row["file_path"])
        if not file_path.is_absolute():
            file_path = base_dir / file_path
        resolved = file_path.resolve()
        if base_dir not in resolved.parents and resolved != base_dir:
            raise HTTPException(status_code=400, detail="invalid path")
        if not resolved.exists():
            raise HTTPException(status_code=404, detail="file not found")
        return FileResponse(path=str(resolved), media_type="text/markdown", filename=resolved.name)

    return app
