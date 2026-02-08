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
from datetime import datetime
from pathlib import Path
from queue import Empty, Queue
from typing import Dict, List, Optional, Tuple
from xml.etree import ElementTree

import httpx
from agno.agent import Agent
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

requirement_store: Dict[str, dict] = {}

async def websocket_voice_realtime_handler(websocket: WebSocket):
    print("[Voice] [DEBUG] websocket_voice_realtime_handler 被调用", flush=True)
    print(f"[Voice] [DEBUG] WebSocket path: {websocket.url.path if hasattr(websocket, 'url') else 'unknown'}", flush=True)

    try:
        await websocket.accept()
        print("[Voice] WebSocket 连接已接受", flush=True)
    except Exception as e:
        print(f"[Voice] accept 错误: {e}", flush=True)
        return

    try:
        import nls
        from aliyunsdkcore.client import AcsClient
        from aliyunsdkcore.request import CommonRequest
    except ImportError as e:
        print(f"[Voice] 导入错误: {e}")
        try:
            await websocket.send_json({"error": f"SDK 导入失败: {e}"})
            await websocket.close()
        except:
            pass
        return

    print(f"[Voice] SDK 导入成功")

    access_key_id = (os.getenv("ALIYUN_ACCESS_KEY_ID") or "").strip()
    access_key_secret = (os.getenv("ALIYUN_ACCESS_KEY_SECRET") or "").strip()
    app_key = (os.getenv("ALIYUN_ASR_APP_KEY") or "").strip()

    if not access_key_id or not access_key_secret:
        await websocket.send_json({"error": "缺少阿里云配置"})
        await websocket.close()
        return

    client = AcsClient(access_key_id, access_key_secret, "cn-shanghai")
    request = CommonRequest()
    request.set_method("POST")
    request.set_domain("nls-meta.cn-shanghai.aliyuncs.com")
    request.set_version("2019-02-28")
    request.set_action_name("CreateToken")

    try:
        response = client.do_action_with_exception(request)
        payload = json.loads(response)
        token_info = payload.get("Token", {})
        token = token_info.get("Id")
        if not token:
            raise RuntimeError(f"CreateToken failed: {payload}")
        print(f"[Voice] Token 获取成功: {token[:20]}...")
    except Exception as e:
        print(f"[Voice] Token 获取失败: {e}")
        await websocket.send_json({"error": f"Token 获取失败: {e}"})
        await websocket.close()
        return

    audio_queue = Queue()
    result_queue = Queue()
    is_transcribing = True

    def on_sentence_begin(message, *args):
        print(f"[Voice] test_on_sentence_begin: {message}")

    def on_sentence_end(message, *args):
        print(f"[Voice] test_on_sentence_end: {message}")

    def on_start(message, *args):
        print(f"[Voice] test_on_start: {message}")

    def on_error(message, *args):
        print(f"[Voice] on_error args=>{args}")

    def on_close(*args):
        print(f"[Voice] on_close: args=>{args}")
        nonlocal is_transcribing
        is_transcribing = False

    def on_result_changed(message, *args):
        print(f"[Voice] test_on_chg: {message}")
        try:
            data = json.loads(message)
            result_text = data.get("result", "")
            if result_text:
                result_queue.put_nowait(("result", result_text))
        except:
            pass

    def on_completed(message, *args):
        print(f"[Voice] on_completed:args=>{args} message=>{message}")
        try:
            data = json.loads(message)
            result_text = data.get("result", "")
            if result_text:
                result_queue.put_nowait(("result", result_text))
        except:
            pass
        result_queue.put_nowait(("completed", ""))

    def audio_sender_thread():
        nonlocal is_transcribing
        print("[Voice] 创建 NlsSpeechTranscriber...")
        try:
            sr = nls.NlsSpeechTranscriber(
                url="wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1",
                token=token,
                appkey=app_key,
                on_sentence_begin=on_sentence_begin,
                on_sentence_end=on_sentence_end,
                on_start=on_start,
                on_result_changed=on_result_changed,
                on_completed=on_completed,
                on_error=on_error,
                on_close=on_close,
                callback_args=[]
            )
            print("[Voice] NlsSpeechTranscriber 创建成功")
        except Exception as e:
            print(f"[Voice] NlsSpeechTranscriber 创建失败: {e}")
            result_queue.put_nowait(("error", f"SDK错误: {e}"))
            is_transcribing = False
            return

        print("[Voice] session start")
        try:
            sr.start(
                aformat="pcm",
                enable_intermediate_result=True,
                enable_punctuation_prediction=True,
                enable_inverse_text_normalization=True
            )
            print("[Voice] Aliyun 会话已启动")
        except Exception as e:
            print(f"[Voice] start 失败: {e}")
            result_queue.put_nowait(("error", str(e)))
            is_transcribing = False
            return

        print("[Voice] 开始发送音频...")
        audio_count = 0
        while is_transcribing:
            try:
                chunk = audio_queue.get(timeout=0.5)
                if chunk is None:
                    print(f"[Voice] 收到 None，结束发送。共发送 {audio_count} 个分片")
                    break
                chunk = bytes(chunk)
                audio_count += 1
                if audio_count % 50 == 0:
                    print(f"[Voice] 已发送 {audio_count} 个分片 ({audio_count * 640} 字节)")
                sr.send_audio(chunk)
            except Empty:
                continue
            except Exception as e:
                print(f"[Voice] 发送音频错误: {e}")
                break

        print(f"[Voice] 发送完成，共 {audio_count} 个分片")

        print("[Voice] 发送停止指令...")
        try:
            sr.stop()
        except Exception as e:
            print(f"[Voice] stop 错误: {e}")

        is_transcribing = False
        print("[Voice] 音频线程结束")

    sender_thread = threading.Thread(target=audio_sender_thread, daemon=True)

    # 先发送 connected 消息，再启动线程
    await websocket.send_json({"type": "connected", "message": "已连接到阿里云语音服务"})
    print("[Voice] 已发送 connected 消息")

    sender_thread.start()
    print("[Voice] 音频线程已启动，等待音频数据...")

    async def receive_audio():
        nonlocal is_transcribing
        try:
            while is_transcribing:
                try:
                    data = await asyncio.wait_for(websocket.receive(), timeout=0.5)
                    if data["type"] == "websocket.receive":
                        if "bytes" in data:
                            audio_queue.put_nowait(data["bytes"])
                        elif "text" in data:
                            try:
                                msg = json.loads(data["text"])
                                if msg.get("type") == "stop":
                                    print("[Voice] 收到停止指令")
                                    is_transcribing = False
                                    audio_queue.put_nowait(None)
                            except:
                                pass
                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    print(f"[Voice] 接收错误: {e}")
                    break
        except Exception as e:
            print(f"[Voice] 接收循环错误: {e}")
        finally:
            is_transcribing = False
            audio_queue.put_nowait(None)

    async def send_results():
        try:
            while True:
                try:
                    result_type, data = await asyncio.wait_for(result_queue.get(), timeout=0.5)
                    if result_type == "result":
                        await websocket.send_json({"type": "result", "text": data})
                        print(f"[Voice] 发送结果: {data[:50]}...")
                    elif result_type == "completed":
                        print("[Voice] 识别完成")
                        break
                    elif result_type == "error":
                        await websocket.send_json({"type": "error", "message": data})
                        break
                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    print(f"[Voice] 发送结果错误: {e}")
                    break
        except Exception as e:
            print(f"[Voice] 结果发送循环错误: {e}")

    await asyncio.gather(receive_audio(), send_results())
    print("[Voice] WebSocket 处理完成")

# Fixed WebSocket handler
# -----------------------
# The earlier `websocket_voice_realtime_handler` mixes `queue.Queue` with `await`,
# which can block the event loop. The last definition wins, so we redefine it here.
async def websocket_voice_realtime_handler(websocket: WebSocket):
    await websocket.accept()

    try:
        import nls
        from aliyunsdkcore.client import AcsClient
        from aliyunsdkcore.request import CommonRequest
    except ImportError as exc:
        await websocket.send_json({"type": "error", "message": f"SDK import failed: {exc}"})
        await websocket.close()
        return

    access_key_id = (os.getenv("ALIYUN_ACCESS_KEY_ID") or "").strip()
    access_key_secret = (os.getenv("ALIYUN_ACCESS_KEY_SECRET") or "").strip()
    app_key = (os.getenv("ALIYUN_ASR_APP_KEY") or "").strip()
    region_id = (os.getenv("ALIYUN_ASR_REGION") or "cn-shanghai").strip()
    sample_rate = int(os.getenv("ALIYUN_ASR_SAMPLE_RATE", "16000"))
    emit_intermediate = (os.getenv("ALIYUN_ASR_INTERMEDIATE", "true").lower() in ("1", "true", "yes"))
    enable_vad = (os.getenv("ALIYUN_ASR_VAD", "true").lower() in ("1", "true", "yes"))
    max_start_silence = int(os.getenv("ALIYUN_ASR_MAX_START_SILENCE", "5000"))
    max_end_silence = int(os.getenv("ALIYUN_ASR_MAX_END_SILENCE", "500"))
    if not access_key_id or not access_key_secret or not app_key:
        await websocket.send_json(
            {
                "type": "error",
                "message": "Missing ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET / ALIYUN_ASR_APP_KEY",
            }
        )
        await websocket.close()
        return

    client = AcsClient(access_key_id, access_key_secret, region_id)
    request = CommonRequest()
    request.set_method("POST")
    request.set_domain(f"nls-meta.{region_id}.aliyuncs.com")
    request.set_version("2019-02-28")
    request.set_action_name("CreateToken")

    try:
        response = client.do_action_with_exception(request)
        payload = json.loads(response)
        token_info = payload.get("Token", {})
        token = token_info.get("Id")
        if not token:
            raise RuntimeError(f"CreateToken failed: {payload}")
    except Exception as exc:
        await websocket.send_json({"type": "error", "message": f"Token create failed: {exc}"})
        await websocket.close()
        return

    loop = asyncio.get_running_loop()
    audio_queue: "Queue[bytes | None]" = Queue()
    result_queue: "asyncio.Queue[dict]" = asyncio.Queue()
    stop_event = threading.Event()

    def _emit(message: dict) -> None:
        loop.call_soon_threadsafe(result_queue.put_nowait, message)

    def _emit_result(result_text: str, index: int | None, *, final: bool) -> None:
        payload: dict = {"type": "result", "text": result_text, "final": bool(final)}
        if index is not None:
            payload["index"] = int(index)
        _emit(payload)

    def _parse_result(message: str) -> tuple[int | None, str]:
        try:
            data = json.loads(message)
        except Exception:
            return None, ""
        if not isinstance(data, dict):
            return None, ""
        payload = data.get("payload", {})
        if not isinstance(payload, dict):
            payload = {}
        index = payload.get("index")
        try:
            index_value = int(index) if index is not None else None
        except Exception:
            index_value = None
        result_text = payload.get("fixed_result") or payload.get("result") or data.get("result") or ""
        return index_value, (result_text or "").strip()

    def on_result_changed(message, *_):
        if not emit_intermediate:
            return
        index_value, result_text = _parse_result(message)
        if result_text:
            _emit_result(result_text, index_value, final=False)

    def on_sentence_end(message, *_):
        index_value, result_text = _parse_result(message)
        if result_text:
            _emit_result(result_text, index_value, final=True)

    def on_completed(message, *_):
        index_value, result_text = _parse_result(message)
        if result_text:
            _emit_result(result_text, index_value, final=True)
        _emit({"type": "completed"})

    def on_error(message, *_):
        _emit({"type": "error", "message": str(message)})

    def on_close(*_):
        stop_event.set()
        try:
            audio_queue.put_nowait(None)
        except Exception:
            pass
        _emit({"type": "completed"})

    def audio_sender_thread():
        try:
            sr = nls.NlsSpeechTranscriber(
                url=f"wss://nls-gateway.{region_id}.aliyuncs.com/ws/v1",
                token=token,
                appkey=app_key,
                on_result_changed=on_result_changed,
                on_sentence_end=on_sentence_end,
                on_completed=on_completed,
                on_error=on_error,
                on_close=on_close,
                callback_args=[],
            )
            sr.start(
                aformat="pcm",
                sample_rate=sample_rate,
                enable_intermediate_result=True,
                enable_punctuation_prediction=True,
                enable_inverse_text_normalization=True,
                enable_voice_detection=enable_vad,
                max_start_silence=max_start_silence,
                max_end_silence=max_end_silence,
            )
        except Exception as exc:
            _emit({"type": "error", "message": f"Transcriber start failed: {exc}"})
            _emit({"type": "completed"})
            return

        try:
            while not stop_event.is_set():
                try:
                    chunk = audio_queue.get(timeout=0.5)
                except Empty:
                    continue
                if chunk is None:
                    break
                payload = bytes(chunk)
                if not payload:
                    continue

                frame_size = 640
                for offset in range(0, len(payload), frame_size):
                    frame = payload[offset : offset + frame_size]
                    if not frame:
                        continue
                    sr.send_audio(frame)
                    if sample_rate > 0:
                        time.sleep(len(frame) / 2 / sample_rate)
        except Exception as exc:
            _emit({"type": "error", "message": f"Audio send failed: {exc}"})
        finally:
            try:
                sr.stop()
            except Exception:
                pass

    sender_thread = threading.Thread(target=audio_sender_thread, daemon=True)
    sender_thread.start()
    await websocket.send_json({"type": "connected", "message": "connected"})

    async def receive_audio() -> None:
        try:
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message["type"] != "websocket.receive":
                    continue
                if message.get("bytes") is not None:
                    audio_queue.put_nowait(message["bytes"])
                    continue
                text = message.get("text")
                if not text:
                    continue
                try:
                    payload = json.loads(text)
                except Exception:
                    continue
                if isinstance(payload, dict) and payload.get("type") == "stop":
                    break
        except WebSocketDisconnect:
            pass
        finally:
            stop_event.set()
            try:
                audio_queue.put_nowait(None)
            except Exception:
                pass

    async def send_results() -> None:
        while True:
            try:
                message = await asyncio.wait_for(result_queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                if stop_event.is_set():
                    break
                continue
            if not isinstance(message, dict):
                continue
            message_type = message.get("type")
            if message_type == "completed":
                break
            await websocket.send_json(message)
            if message_type == "error":
                break

    await asyncio.gather(receive_audio(), send_results())
    try:
        await websocket.close()
    except Exception:
        pass


def _fallback_chunk_summary(chunk_text: str, max_chars: int = 400) -> str:
    snippet = " ".join((chunk_text or "").strip().split())
    if len(snippet) > max_chars:
        snippet = snippet[:max_chars].rstrip() + "..."
    return f"- (mock) {snippet}" if snippet else "- (mock) (empty)"


def _summaries_to_bullets(summaries_md: str) -> str:
    summaries_md = (summaries_md or "").strip()
    if not summaries_md:
        return "- (mock) no summaries"
    lines = [line.strip() for line in summaries_md.splitlines() if line.strip()]
    bullets: List[str] = []
    for line in lines:
        if line.startswith(("-", "*", "1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9.")):
            bullets.append(line)
        else:
            bullets.append(f"- {line}")
    return "\n".join(bullets)


def _fallback_prd(previous_prd: str, summaries_md: str) -> str:
    previous_prd = (previous_prd or "").strip()
    summaries_md = _summaries_to_bullets(summaries_md)
    template = (
        "# PRD\n\n"
        "## 背景与问题\n\n"
        "- 待澄清1：业务背景/现状\n\n"
        "## 目标\n\n"
        "- 待澄清2：核心目标与成功标准\n\n"
        "## 范围 / 非目标\n\n"
        "- 范围：待澄清\n"
        "- 非目标：待澄清\n\n"
        "## 用户与场景\n\n"
        "- 目标用户：待澄清\n"
        "- 典型场景：待澄清\n\n"
        "## 功能需求（含流程/异常/字段/验收）\n\n"
        "- 待澄清3：功能清单与流程细节\n\n"
        "## 非功能需求\n\n"
        "- 待澄清4：性能/安全/合规/可用性\n\n"
        "## 埋点指标\n\n"
        "- 待澄清5：核心指标与口径\n\n"
        "## 风险与对策\n\n"
        "- 待澄清6：关键风险与应对\n\n"
        "## 关键信息（来自分段摘要）\n\n"
        f"{summaries_md}\n\n"
        "## 待澄清\n\n"
        "- [待澄清7] 业务规则/边界条件\n"
        "- [待澄清8] 现有系统与接口依赖\n"
        "- [待澄清9] 交付里程碑\n"
    )
    if not previous_prd:
        return template
    if not summaries_md:
        return previous_prd + "\n"
    return previous_prd + "\n\n## 新增要点\n\n" + summaries_md + "\n"


def _is_prd_like(text: str) -> bool:
    text = (text or "").strip()
    if not text:
        return False
    if text.lstrip().startswith("#"):
        return True
    heading_count = sum(1 for line in text.splitlines() if line.strip().startswith(("## ", "### ")))
    if heading_count >= 3:
        return True
    keywords = ("背景", "目标", "功能", "需求", "范围", "风险", "待澄清")
    hit = sum(1 for key in keywords if key in text)
    return hit >= 3 and len(text) > 400


def _append_prd_notes(previous_prd: str, summaries_md: str) -> str:
    previous_prd = (previous_prd or "").strip()
    summaries_md = _summaries_to_bullets(summaries_md)
    if not previous_prd:
        return _fallback_prd(previous_prd="", summaries_md=summaries_md)
    return previous_prd + "\n\n## 新增要点\n\n" + summaries_md + "\n"


def _collect_session_summaries(summaries_dir: Path) -> str:
    items: List[Tuple[int, int, str]] = []
    for entry in summaries_dir.glob("summary_*.md"):
        chunk_index = _parse_chunk_index_from_summary_filename(entry.name)
        if chunk_index is None:
            continue
        try:
            content = entry.read_text(encoding="utf-8")
        except Exception:
            content = ""
        created_at = int(entry.stat().st_mtime)
        items.append((chunk_index, created_at, content))
    items.sort(key=lambda item: (item[0], item[1]))
    return "\n\n".join([content.strip() for _, _, content in items if content.strip()])


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
            client_name TEXT,
            budget TEXT,
            description TEXT,
            contact TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            version INTEGER DEFAULT 1,
            status TEXT DEFAULT 'running',
            imagicma_project_id TEXT,
            imagicma_project_name TEXT,
            UNIQUE(session_id, version)
        )
        """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_prd_management_session_id ON prd_management(session_id)")
    conn.commit()
    conn.close()


def _ensure_prd_columns(db_path: str) -> None:
    """确保 prd_management 表有客户相关字段"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(prd_management)")
    cols = {row[1] for row in cursor.fetchall()}

    if "client_name" not in cols:
        cursor.execute("ALTER TABLE prd_management ADD COLUMN client_name TEXT")
    if "budget" not in cols:
        cursor.execute("ALTER TABLE prd_management ADD COLUMN budget TEXT")
    if "description" not in cols:
        cursor.execute("ALTER TABLE prd_management ADD COLUMN description TEXT")
    if "contact" not in cols:
        cursor.execute("ALTER TABLE prd_management ADD COLUMN contact TEXT")

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


def _update_imagicma_project(
    db_path: str,
    record_id: int,
    imagicma_project_id: str,
    imagicma_project_name: str,
) -> None:
    now = int(time.time())
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE prd_management
        SET imagicma_project_id = ?, imagicma_project_name = ?, updated_at = ?
        WHERE id = ?
        """,
        (imagicma_project_id, imagicma_project_name, now, int(record_id)),
    )
    conn.commit()
    conn.close()


def _get_imagicma_project(db_path: str, session_id: str) -> Optional[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, imagicma_project_id, imagicma_project_name, project_path
        FROM prd_management
        WHERE session_id = ? AND imagicma_project_id IS NOT NULL
        ORDER BY updated_at DESC
        LIMIT 1
        """,
        (session_id,),
    )
    row = cursor.fetchone()
    conn.close()
    return row


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
        WHERE status IN ('queued', 'running', 'summarizing', 'generating_prd')
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
        "3) 输出格式：仅使用有序列表（1. 2. 3. ...），不要标题。\n"
        "4) 每条要点的子标题（冒号前面的内容）需要加粗，使用 **子标题** 格式。\n\n"
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
        '你是 PRD 文档生成专家，请输出“可直接开工”的落地详细版 PRD（Markdown）。\n'
        '请基于【上一版PRD】+【新增要点】产出最新完整 PRD（覆盖上一版），不需要输出对比说明，只写最终版本。\n'
        '原则：只写输入中能支撑的事实；任何不确定/缺失/需要业务确认的内容，必须写入【待澄清】并在条目前加前缀：【待澄清N】（N 从 1 开始递增）。\n'
        '格式要求：只输出 Markdown；不要输出 HTML；表格使用 Markdown 管道表格（| a | b |）。\n'
        '必须使用以下结构与标题，并填充内容（允许在功能需求下按模块拆分）：\n'
        '# PRD\n'
        '## 背景与问题\n'
        '## 目标\n'
        '## 范围\n'
        '## 非目标\n'
        '## 用户与场景\n'
        '## 功能需求（含流程/异常/字段/验收）\n'
        '## 非功能需求\n'
        '## 埋点指标\n'
        '## 风险与对策\n'
        '## 待澄清\n'
        '写作要求：条理清晰、术语一致、尽量用表格描述字段/状态/接口；每个功能点必须给出可验收标准（Given-When-Then）。\n'
        '只输出 PRD Markdown，不要解释。\n'
        '\n'
        '上一版 PRD（可能为空）：\n'
        '<<<\n'
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
    summary_agent: Optional[Agent],
    prd_agent: Optional[Agent],
    db_path: str = "tmp/prd.db",
    prd_docs_dir: Optional[Path] = None,
    cors_origins: Optional[List[str]] = None,
) -> FastAPI:
    print("[Debug] build_api_app called")
    app = FastAPI(title="Doc Summary API", version="1.0.0")
    print("[Debug] Created FastAPI app")
    app.state.summary_agent = summary_agent
    app.state.prd_agent = prd_agent

    # 添加语音处理路由
    app.add_websocket_route("/ws/voice/realtime", websocket_voice_realtime_handler)
    print("[Debug] WebSocket 路由已添加: /ws/voice/realtime")
    print(f"[Debug] Handler function id: {id(websocket_voice_realtime_handler)}")

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
        app.state.doc_task_inflight = set()

        async def _process_task(task_id: int) -> None:
            try:
                row = _get_task_by_id(db_path, int(task_id))
                if not row:
                    return
                status = str(row["status"] or "")
                if status in ("done", "failed"):
                    return

                _update_task_progress(db_path=db_path, task_id=int(task_id), status="summarizing", error=None)

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

                while next_index <= end_index:
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

                    summary_agent_local = app.state.summary_agent
                    if summary_agent_local is None:
                        chunk_summary = _fallback_chunk_summary(chunk_text)
                    else:
                        try:
                            run = await asyncio.wait_for(summary_agent_local.arun(summary_prompt, session_id=session_id), timeout=1000)
                            content = run.content if run and hasattr(run, "content") else ""
                        except Exception:
                            content = ""
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
                        status="summarizing",
                        next_chunk_index=next_index,
                    )

                if next_index > end_index:
                    filename_value = str(row["filename"] or "")
                    if filename_value.startswith("voice_"):
                        _update_task_progress(
                            db_path=db_path,
                            task_id=int(task_id),
                            status="done",
                            next_chunk_index=next_index,
                        )
                        return
                    _update_task_progress(
                        db_path=db_path,
                        task_id=int(task_id),
                        status="generating_prd",
                        next_chunk_index=next_index,
                    )
                    # Update PRD once per task from aggregated summaries + previous PRD.
                    summaries_md = "\n\n".join(summaries_acc).strip()
                    prd_prompt = _build_prd_update_prompt(previous_prd=cumulative, summaries_md=summaries_md, max_bytes=MAX_MODEL_INPUT_BYTES)
                    if prd_prompt:
                        prd_agent_local = app.state.prd_agent
                        if prd_agent_local is None:
                            prd_text = _fallback_prd(previous_prd=cumulative, summaries_md=summaries_md).strip()
                        else:
                            try:
                                prd_run = await asyncio.wait_for(prd_agent_local.arun(prd_prompt, session_id=session_id), timeout=3000)
                                prd_content = prd_run.content if prd_run and hasattr(prd_run, "content") else ""
                            except Exception:
                                prd_content = ""
                            if prd_content is None:
                                prd_text = ""
                            elif isinstance(prd_content, str):
                                prd_text = prd_content
                            else:
                                prd_text = str(prd_content)
                            prd_text = (prd_text or "").strip()
                        if not prd_text or not _is_prd_like(prd_text):
                            if cumulative.strip():
                                prd_text = _append_prd_notes(previous_prd=cumulative, summaries_md=summaries_md).strip()
                            else:
                                prd_text = _fallback_prd(previous_prd=cumulative, summaries_md=summaries_md).strip()
                    else:
                        prd_text = _fallback_prd(previous_prd=cumulative, summaries_md=summaries_md).strip()

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
                inflight = getattr(app.state, "doc_task_inflight", None)
                if isinstance(inflight, set):
                    inflight.discard(int(task_id))

        def _schedule_task(task_id: int) -> None:
            inflight = app.state.doc_task_inflight
            if int(task_id) in inflight:
                return
            inflight.add(int(task_id))
            loop = asyncio.get_running_loop()
            loop.create_task(_process_task(int(task_id)))

        app.state._doc_process_task = _process_task
        app.state._doc_schedule_task = _schedule_task

    @app.on_event("startup")
    async def _startup() -> None:
        _ensure_worker_started()
        _ensure_prd_columns(db_path)
        for task_id in _list_pending_tasks(db_path):
            try:
                app.state._doc_schedule_task(int(task_id))
            except Exception:
                pass

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        if hasattr(app.state, "doc_task_inflight"):
            app.state.doc_task_inflight.clear()

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
        app.state._doc_schedule_task(int(task_id))

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
        app.state._doc_schedule_task(int(task_id))

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

        summary_agent_local = app.state.summary_agent
        if summary_agent_local is None:
            refined = " ".join(text.split()).strip()
            return VoiceRefineResponse(session_id=session_id, refined_text=refined)

        run = await summary_agent_local.arun(prompt, session_id=session_id)
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

    @app.post("/api/prd/sync-to-imagicma")
    async def sync_prd_to_imagicma(session_id: str = "default", project_name: str = None):
        """
        将 PRD 文档同步到 imagicma 项目，并启动 design 模式执行
        - 如果已有关联项目，直接使用
        - 否则创建新项目并保存关联
        - 保存 PRD 文件到项目目录
        - 调用 design 模式执行项目
        """

        try:
            if not session_id:
                raise HTTPException(status_code=400, detail="session_id is required")

            row = _get_latest_prd_record(db_path, session_id)
            if not row:
                raise HTTPException(status_code=404, detail="PRD record not found")

            record_id = row["id"]

            file_path = Path(row["file_path"])
            if not file_path.is_absolute():
                file_path = base_dir / file_path
            resolved = file_path.resolve()

            if not resolved.exists():
                raise HTTPException(status_code=404, detail="PRD file not found")

            prd_content = resolved.read_text(encoding="utf-8")

            imagicma_base_url = os.getenv("IMAGICMA_API_URL", "http://localhost:9000")
            imagicma_api_key = os.getenv("IMAGICMA_API_KEY", "")

            if not project_name:
                project_name = f"prd-{session_id}"

            headers = {"X-API-KEY": imagicma_api_key} if imagicma_api_key else {}

            client = httpx.AsyncClient(timeout=60.0)

            project_id = None
            project_path = None

            existing_project = _get_imagicma_project(db_path, session_id)
            if existing_project and existing_project.get("imagicma_project_id"):
                project_id = existing_project["imagicma_project_id"]
                project_path = existing_project.get("project_path") or f"projects/{project_name}"
                print(f"[Sync] Found existing project关联: {project_id}")
            else:
                print(f"[Sync] No existing project found for session {session_id}, creating new one...")
                create_project_url = f"{imagicma_base_url}/api/projects"
                create_project_data = {"name": project_name}

                try:
                    resp = await client.post(create_project_url, json=create_project_data, headers=headers)
                    if resp.status_code == 200:
                        project_data = resp.json()
                        if project_data.get("success") and project_data.get("data"):
                            project_id = project_data["data"].get("id")
                            project_path = project_data["data"].get("path")
                            print(f"[Sync] Created new project: {project_name} (id: {project_id})")
                    elif resp.status_code == 409:
                        print(f"[Sync] Project {project_name} already exists, getting project list...")
                        list_resp = await client.get(f"{imagicma_base_url}/api/projects", headers=headers)
                        if list_resp.status_code == 200:
                            projects = list_resp.json().get("data", [])
                            for p in projects:
                                if p.get("name") == project_name:
                                    project_id = p.get("id")
                                    project_path = p.get("path")
                                    print(f"[Sync] Found existing project: {project_name} (id: {project_id})")
                                    break
                except Exception as e:
                    print(f"[Sync] Project creation/check warning: {e}")

            if not project_id:
                raise HTTPException(status_code=500, detail="Failed to get project ID from imagicma")

            if project_path is None:
                project_path = f"projects/{project_name}"

            target_path = f"{project_path}/prd/{session_id}.md"
            save_url = f"{imagicma_base_url}/api/files/save"
            save_data = {"filePath": target_path, "content": prd_content}

            save_resp = await client.post(save_url, json=save_data, headers=headers)
            if save_resp.status_code >= 400:
                raise HTTPException(
                    status_code=save_resp.status_code,
                    detail=f"Failed to save PRD to imagicma: {save_resp.text}"
                )
            print(f"[Sync] PRD saved to: {target_path}")

            _update_imagicma_project(db_path, record_id, project_id, project_name)
            print(f"[Sync] Updated PRD record {record_id} with project_id: {project_id}")

            opencode_url = os.getenv("OPENCODE_API_URL", "http://localhost:8000")
            design_session_dir = f"{project_path}/imagic_ma_desiger"

            design_prompt = f"""请基于以下 PRD 文档进行产品设计：

{prd_content}

请完成以下设计任务：
1. 分析 PRD 文档中的功能需求
2. 创建或更新用户画像文件 (personas/)
3. 创建或更新用户流程图 (user_flows/)
4. 创建或更新样式指南 (style_guide/)
5. 创建或更新功能规划 (feature_plan/)
6. 生成设计稿预览

请开始执行设计任务。"""

            session_resp = await client.post(
                f"{opencode_url}/session?directory={design_session_dir}",
                json={},
                headers={"x-opencode-directory": design_session_dir}
            )

            if session_resp.status_code >= 400:
                raise HTTPException(
                    status_code=session_resp.status_code,
                    detail=f"Failed to create design session: {session_resp.text}"
                )

            session_data = session_resp.json()
            session_id_design = session_data.get("id")
            print(f"[Sync] Created design session: {session_id_design} in {design_session_dir}")

            message_resp = await client.post(
                f"{opencode_url}/session/{session_id_design}/message",
                json={
                    "agent": "general",
                    "parts": [{"type": "text", "text": design_prompt}],
                    "variant": "medium"
                },
                headers={"x-opencode-directory": design_session_dir}
            )

            if message_resp.status_code >= 400:
                raise HTTPException(
                    status_code=message_resp.status_code,
                    detail=f"Failed to send design prompt: {message_resp.text}"
                )

            print(f"[Sync] Design mode started for project: {project_name}")

            await client.aclose()

            return {
                "success": True,
                "message": "PRD synced and design mode started",
                "project_name": project_name,
                "project_id": project_id,
                "project_path": project_path,
                "prd_path": target_path,
                "design_session_id": session_id_design,
                "design_directory": design_session_dir,
                "is_reused": existing_project is not None
            }

        except HTTPException:
            raise
        except Exception as e:
            print(f"[Sync] Failed to sync PRD to imagicma: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Failed to sync PRD: {str(e)}")

    @app.post("/api/prd/finalize")
    async def finalize_prd(session_id: str = Form(...)) -> Dict[str, object]:
        session_id = (session_id or "").strip()
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required")

        _, _, _, summaries_dir = _get_session_dirs(base_dir, session_id)
        summaries_md = _collect_session_summaries(summaries_dir)
        if not summaries_md:
            raise HTTPException(status_code=400, detail="no summaries")

        cumulative_path = summaries_dir / "prd.md"
        previous_prd = ""
        if cumulative_path.exists():
            try:
                previous_prd = cumulative_path.read_text(encoding="utf-8")
            except Exception:
                previous_prd = ""

        prd_prompt = _build_prd_update_prompt(
            previous_prd=previous_prd,
            summaries_md=summaries_md,
            max_bytes=MAX_MODEL_INPUT_BYTES,
        )

        prd_agent_local = app.state.prd_agent
        if prd_agent_local is None or not prd_prompt:
            prd_text = _fallback_prd(previous_prd=previous_prd, summaries_md=summaries_md).strip()
        else:
            try:
                prd_run = await asyncio.wait_for(prd_agent_local.arun(prd_prompt, session_id=session_id), timeout=3000)
                prd_content = prd_run.content if prd_run and hasattr(prd_run, "content") else ""
            except Exception:
                prd_content = ""
            if prd_content is None:
                prd_text = ""
            elif isinstance(prd_content, str):
                prd_text = prd_content
            else:
                prd_text = str(prd_content)
            prd_text = (prd_text or "").strip()
            if not prd_text or not _is_prd_like(prd_text):
                prd_text = _fallback_prd(previous_prd=previous_prd, summaries_md=summaries_md).strip()

        if prd_text:
            cumulative_path.write_text(prd_text.strip() + "\n", encoding="utf-8")

        prd_state_path = summaries_dir / "prd_record_id.txt"
        prd_record_id: Optional[int] = None
        if prd_state_path.exists():
            try:
                prd_record_id = int(prd_state_path.read_text(encoding="utf-8").strip() or "0") or None
            except Exception:
                prd_record_id = None
        if prd_record_id is None:
            title = f"PRD-{session_id}"
            prd_rel = str(Path(session_id) / "summaries" / "prd.md")
            prd_record_id = _create_prd_record(
                db_path=db_path,
                session_id=session_id,
                file_path=prd_rel,
                title=title,
                summary=None,
                status="running",
            )
            prd_state_path.write_text(str(prd_record_id), encoding="utf-8")

        if prd_record_id is not None:
            prd_title = f"PRD-{session_id}"
            prd_lines = [line.strip() for line in prd_text.splitlines() if line.strip()]
            if prd_lines and prd_lines[0].startswith("#"):
                prd_title = prd_lines[0].lstrip("#").strip() or prd_title
            prd_summary = prd_text.replace("\n", " ").strip()
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

        return {"session_id": session_id, "content": prd_text}

    @app.get("/api/aliyun/token")
    async def get_aliyun_token():
        try:
            from aliyunsdkcore.client import AcsClient
            from aliyunsdkcore.request import CommonRequest
            access_key_id = os.getenv("ALIYUN_ACCESS_KEY_ID", "")
            access_key_secret = os.getenv("ALIYUN_ACCESS_KEY_SECRET", "")
            app_key = os.getenv("ALIYUN_ASR_APP_KEY", "")
            region = os.getenv("ALIYUN_ASR_REGION", "cn-shanghai")
            if not access_key_id or not access_key_secret:
                raise HTTPException(status_code=400, detail="Aliyun credentials not configured")
            if not app_key:
                raise HTTPException(status_code=400, detail="Aliyun AppKey not configured")

            print(f"[Token] 使用 SDK 获取 Token...")
            client = AcsClient(access_key_id, access_key_secret, region)
            request = CommonRequest()
            request.set_method("POST")
            request.set_domain(f"nls-meta.{region}.aliyuncs.com")
            request.set_version("2019-02-28")
            request.set_action_name("CreateToken")

            response = client.do_action_with_exception(request)
            data = json.loads(response)
            print(f"[Token] SDK 响应: {data}")

            if "Token" in data and "Id" in data["Token"]:
                token = data["Token"]["Id"]
                print(f"[Token] 成功: {token[:20]}...")
                ws_url = f"wss://nls-gateway.{region}.aliyuncs.com/ws/v1"
                return {
                    "token": token,
                    "expireTime": data["Token"]["ExpireTime"],
                    "appKey": app_key,
                    "wsUrl": ws_url,
                }
            else:
                raise HTTPException(status_code=500, detail=f"Failed to get token: {data}")
        except ImportError as e:
            print(f"[Token] SDK 导入失败: {e}")
            raise HTTPException(status_code=500, detail="Aliyun SDK not installed")
        except Exception as e:
            print(f"[Token] 错误: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to connect Aliyun: {str(e)}")

    @app.get("/api/aliyun/asr/config")
    async def get_asr_config():
        app_key = os.getenv("ALIYUN_ASR_APP_KEY", "")
        if not app_key:
            raise HTTPException(status_code=400, detail="Aliyun AppKey not configured")
        return {"appKey": app_key}

    @app.post("/api/requirement/save")
    async def save_requirement(
        session_id: str = Form(...),
        client_name: str = Form(...),
        budget: str = Form(...),
        description: str = Form(...),
        contact: str = Form("")
    ):
        try:
            now = int(time.time())
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()

            # 查找是否已有该 session_id 的记录
            cursor.execute("SELECT id, version FROM prd_management WHERE session_id = ? ORDER BY version DESC LIMIT 1", (session_id,))
            existing = cursor.fetchone()

            if existing:
                record_id, version = existing
                cursor.execute("""
                    UPDATE prd_management SET
                        client_name=?, budget=?, description=?, contact=?, updated_at=?
                    WHERE id=?
                """, (client_name, budget, description, contact, now, record_id))
            else:
                # 创建新记录
                file_path = f"requirements/{session_id}.md"
                cursor.execute("""
                    INSERT INTO prd_management (
                        session_id, file_path, title, client_name, budget, description, contact,
                        created_at, updated_at, version, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'draft')
                """, (session_id, file_path, f"需求-{session_id[:8]}", client_name, budget, description, contact, now, now))
                record_id = cursor.lastrowid

            conn.commit()
            conn.close()
            return {"success": True, "id": record_id}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/api/requirement/list")
    async def list_requirements(limit: int = 100) -> dict:
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, session_id, client_name, budget, description, contact, created_at, updated_at
                FROM prd_management
                ORDER BY created_at DESC
                LIMIT ?
            """, (limit,))
            rows = cursor.fetchall()
            conn.close()

            records = []
            for row in rows:
                records.append({
                    "id": row[0],
                    "session_id": row[1],
                    "client_name": row[2] or "",
                    "budget": row[3] or "",
                    "description": row[4] or "",
                    "contact": row[5] or "",
                    "created_at": row[6],
                })
            return {"items": records}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/api/requirement/{session_id}")
    async def get_requirement(session_id: str) -> dict:
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, session_id, client_name, budget, description, contact, created_at, updated_at
                FROM prd_management
                WHERE session_id = ?
                ORDER BY version DESC
                LIMIT 1
            """, (session_id,))
            row = cursor.fetchone()
            conn.close()

            if row:
                return {
                    "id": row[0],
                    "session_id": row[1],
                    "client_name": row[2] or "",
                    "budget": row[3] or "",
                    "description": row[4] or "",
                    "contact": row[5] or "",
                    "created_at": row[6],
                }
            else:
                return {
                    "id": None,
                    "session_id": session_id,
                    "client_name": "",
                    "budget": "",
                    "description": "",
                    "contact": "",
                }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    async def get_requirement(session_id: str) -> dict:
        try:
            req_key = f"requirement:{session_id}"
            data = await redis_client.get(req_key)
            if data:
                return json.loads(data)
            else:
                return {
                    "id": None,
                    "session_id": session_id,
                    "client_name": "",
                    "budget": "",
                    "description": "",
                    "contact": "",
                }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    print(f"[Debug] build_api_app 完成 - WebSocket 路由已在第 906 行注册")
    return app
