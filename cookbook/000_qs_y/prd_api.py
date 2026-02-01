from __future__ import annotations

import io
import os
import re
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from agno.agent import Agent
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    session_id: str
    content: str
    created_at: int


class ImportResponse(BaseModel):
    session_id: str
    total_chunks: int
    chunks: List[str]
    replies: List[str]


class PrdRecord(BaseModel):
    id: int
    session_id: str
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


class SummaryItem(BaseModel):
    filename: str
    timestamp: int
    content: str


class SummaryListResponse(BaseModel):
    session_id: str
    items: List[SummaryItem]

MAX_MODEL_INPUT_BYTES = int(os.getenv("PRD_MAX_INPUT_BYTES", os.getenv("PRD_MAX_INPUT_LEN", "800000")))
MAX_CHAT_INPUT_BYTES = int(os.getenv("PRD_MAX_CHAT_INPUT_BYTES", "100000"))
CHAT_HISTORY_MESSAGES = int(os.getenv("PRD_CHAT_HISTORY_MESSAGES", "6"))


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


def _ensure_message_size(message: str, max_bytes: int) -> str:
    message = message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")
    if _utf8_len(message) > max_bytes:
        # Keep the most recent part to avoid exceeding model input limits.
        message = _trim_to_utf8_bytes(message, max_bytes, from_end=True)
    return message


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
            raise HTTPException(
                status_code=400,
                detail="PDF 瑙ｆ瀽闇€瑕佸畨瑁?pypdf",
            ) from exc
        reader = PdfReader(io.BytesIO(data))
        text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
        return text.strip()

    if ext == ".docx":
        try:
            from docx import Document  # type: ignore
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail="DOCX 瑙ｆ瀽闇€瑕佸畨瑁?python-docx",
            ) from exc
        doc = Document(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs).strip()

    if content_type in ("application/octet-stream", ""):
        decoded = _decode_bytes(data).strip()
        if decoded:
            return decoded

    raise HTTPException(status_code=400, detail="涓嶆敮鎸佺殑鏂囦欢绫诲瀷")


def _chunk_text(text: str, max_chars: int) -> List[str]:
    if not text:
        return []

    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", normalized) if p.strip()]
    if not paragraphs:
        paragraphs = [normalized]

    chunks: List[str] = []
    buffer = ""

    def flush_buffer() -> None:
        nonlocal buffer
        if buffer:
            chunks.append(buffer.strip())
            buffer = ""

    for paragraph in paragraphs:
        if len(paragraph) <= max_chars:
            if buffer and len(buffer) + 2 + len(paragraph) > max_chars:
                flush_buffer()
            buffer = f"{buffer}\n\n{paragraph}".strip()
            continue

        flush_buffer()
        sentences = [s.strip() for s in re.split(r"(?<=[銆傦紒锛?!?])\\s+", paragraph) if s.strip()]
        if len(sentences) == 1:
            for idx in range(0, len(paragraph), max_chars):
                part = paragraph[idx:idx + max_chars].strip()
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
                    part = sentence[idx:idx + max_chars].strip()
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
    return [chunk for chunk in chunks if chunk]


def _parse_summary_timestamp(name: str) -> Optional[int]:
    stem = Path(name).stem
    try:
        dt = datetime.strptime(stem, "%Y%m%d_%H%M%S")
    except ValueError:
        return None
    return int(dt.timestamp())


def build_api_app(
    *,
    chat_agent: Agent,
    db_path: str = "tmp/prd.db",
    prd_docs_dir: Optional[Path] = None,
    cors_origins: Optional[List[str]] = None,
) -> FastAPI:
    app = FastAPI(title="PRD Chat API", version="1.0.0")

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

    @app.post("/api/chat", response_model=ChatResponse)
    async def chat_endpoint(payload: ChatRequest) -> ChatResponse:
        message = _ensure_message_size(payload.message, MAX_CHAT_INPUT_BYTES)

        run = await chat_agent.arun(
            message,
            session_id=payload.session_id,
            num_history_messages=CHAT_HISTORY_MESSAGES,
        )
        content = run.content if run and hasattr(run, "content") else ""
        if content is None:
            content_text = ""
        elif isinstance(content, str):
            content_text = content
        else:
            content_text = str(content)

        session_id = run.session_id or payload.session_id or ""
        return ChatResponse(
            session_id=session_id,
            content=content_text,
            created_at=run.created_at if run else int(time.time()),
        )

    @app.post("/api/chat/import", response_model=ImportResponse)
    async def import_document(
        file: UploadFile = File(...),
        session_id: Optional[str] = Form(default=None),
        chunk_size: int = Form(default=1000),
    ) -> ImportResponse:
        if chunk_size < 200:
            raise HTTPException(status_code=400, detail="chunk_size 澶皬")

        text = await _read_upload_text(file)
        if not text:
            raise HTTPException(status_code=400, detail="鏂囦欢鍐呭涓虹┖")

        chunks = _chunk_text(text, max_chars=chunk_size)
        if not chunks:
            raise HTTPException(status_code=400, detail="鏃犳硶鎷嗗垎鏂囨。鍐呭")

        replies: List[str] = []
        current_session_id = session_id
        total = len(chunks)
        for index, chunk in enumerate(chunks, start=1):
            prompt = f"这是导入文档的第 {index}/{total} 部分：\n{chunk}"
            if _utf8_len(prompt) > MAX_CHAT_INPUT_BYTES:
                prompt = _trim_to_utf8_bytes(prompt, MAX_CHAT_INPUT_BYTES, from_end=True)
                if not prompt.strip():
                    raise HTTPException(status_code=400, detail="导入内容过长，请缩小文件或分段上传")
            run = await chat_agent.arun(
                prompt,
                session_id=current_session_id,
                num_history_messages=CHAT_HISTORY_MESSAGES,
            )
            content = run.content if run and hasattr(run, "content") else ""
            if content is None:
                content_text = ""
            elif isinstance(content, str):
                content_text = content
            else:
                content_text = str(content)
            replies.append(content_text)
            current_session_id = run.session_id or current_session_id

        return ImportResponse(
            session_id=current_session_id or "",
            total_chunks=len(chunks),
            chunks=chunks,
            replies=replies,
        )

    @app.get("/api/prd/list", response_model=List[PrdRecord])
    async def list_prd_records() -> List[PrdRecord]:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, session_id, title, summary, created_at, updated_at, version, status
            FROM prd_management
            ORDER BY created_at DESC, id DESC
            """
        )
        rows = cursor.fetchall()
        conn.close()
        return [PrdRecord(**dict(row)) for row in rows]

    @app.get("/api/prd/download/{record_id}")
    async def download_prd(record_id: int):
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT file_path FROM prd_management WHERE id = ?",
            (record_id,),
        )
        row = cursor.fetchone()
        conn.close()

        if not row or not row[0]:
            raise HTTPException(status_code=404, detail="鏂囦欢涓嶅瓨鍦?")

        file_path = Path(row[0])
        if not file_path.is_absolute():
            file_path = Path(__file__).resolve().parent / file_path

        resolved = file_path.resolve()
        if base_dir not in resolved.parents and resolved != base_dir:
            raise HTTPException(status_code=400, detail="鏃犳晥鐨勬枃浠惰矾寰?")
        if not resolved.exists():
            raise HTTPException(status_code=404, detail="鏂囦欢涓嶅瓨鍦?")

        return FileResponse(
            path=str(resolved),
            media_type="text/markdown",
            filename=resolved.name,
        )

    @app.get("/api/prd/latest", response_model=PrdLatestResponse)
    async def latest_prd(session_id: str):
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, session_id, title, summary, created_at, updated_at, version, status, file_path
            FROM prd_management
            WHERE session_id = ?
            ORDER BY version DESC, id DESC
            LIMIT 1
            """,
            (session_id,),
        )
        row = cursor.fetchone()
        conn.close()

        if not row:
            return PrdLatestResponse(record=None, filename=None, content=None)

        record = PrdRecord(
            id=row["id"],
            session_id=row["session_id"],
            title=row["title"],
            summary=row["summary"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            version=row["version"],
            status=row["status"],
        )
        file_path = Path(row["file_path"]) if row["file_path"] else None
        content = None
        filename = None
        if file_path:
            if not file_path.is_absolute():
                file_path = Path(__file__).resolve().parent / file_path
            resolved = file_path.resolve()
            if base_dir in resolved.parents or resolved == base_dir:
                if resolved.exists():
                    content = resolved.read_text(encoding="utf-8")
                    filename = resolved.name

        return PrdLatestResponse(record=record, filename=filename, content=content)

    @app.get("/api/prd/summaries", response_model=SummaryListResponse)
    async def prd_summaries(session_id: str):
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")

        session_dir = (base_dir / session_id).resolve()
        if base_dir not in session_dir.parents and session_dir != base_dir:
            raise HTTPException(status_code=400, detail="invalid session path")
        if not session_dir.exists():
            return SummaryListResponse(session_id=session_id, items=[])

        items: List[SummaryItem] = []
        for entry in session_dir.glob("*.md"):
            if entry.name.startswith("prd_"):
                continue
            ts = _parse_summary_timestamp(entry.name)
            if not ts:
                continue
            try:
                content = entry.read_text(encoding="utf-8")
            except Exception:
                content = ""
            items.append(
                SummaryItem(
                    filename=entry.name,
                    timestamp=ts,
                    content=content,
                )
            )

        items.sort(key=lambda item: item.timestamp)
        return SummaryListResponse(session_id=session_id, items=items)

    return app
