import asyncio
import os
import time
import sqlite3
from datetime import datetime
from pathlib import Path


from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.models.dashscope import DashScope
from agno.os import AgentOS
from agno.run import RunContext
from agno.team import Team
from prd_api import build_api_app

from libs.agno.agno.db.base import SessionType

# 创建数据库
db = SqliteDb(db_file="tmp/prd.db")

# ========== 自定义 PRD 文档表 ==========
def init_prd_table():
    """初始化 PRD 文档表"""
    conn = sqlite3.connect("tmp/prd.db")
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS prd_management (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            title TEXT,
            summary TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            version INTEGER DEFAULT 1,
            status TEXT DEFAULT 'collecting',
            UNIQUE(session_id, version)
        )
    """)
    conn.commit()
    conn.close()


def insert_prd_record(
    session_id: str,
    file_path: str,
    title: str = None,
    summary: str = None,
    version: int = None,
) -> int:
    """插入 PRD 文档记录"""
    conn = sqlite3.connect("tmp/prd.db")
    cursor = conn.cursor()

    now_timestamp = int(time.time())

    if version is None:
        cursor.execute(
            "SELECT COALESCE(MAX(version), 0) FROM prd_management WHERE session_id = ?",
            (session_id,),
        )
        row = cursor.fetchone()
        version = (row[0] if row and row[0] is not None else 0) + 1

    # prd_management 判断session是否存在，如果存在，就不插入

    cursor.execute("""
                   INSERT OR IGNORE INTO prd_management (session_id, file_path, title, summary, created_at, updated_at, version)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   """, (session_id, file_path, title, summary, now_timestamp, now_timestamp, version))


    conn.commit()
    inserted = (cursor.rowcount == 1)
    if inserted == 1:
        print(f"[{session_id}] prd新增")

    record_id = cursor.lastrowid
    conn.close()
    return record_id

# 启动时初始化表
init_prd_table()

# PRD 完备度维度
PRD_DIMENSIONS = {
    "background": "背景",
    "goals_vision": "目标&愿景",
    "user_stories": "用户故事",
    "key_modules": "关键模块/特征",
    "core_flow": "核心流程",
    "competitive_analysis": "竞品分析"
}

MAX_INPUT_BYTES = int(os.getenv("PRD_MAX_INPUT_BYTES", os.getenv("PRD_MAX_INPUT_LEN", "800000")))


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


def _build_summary_prompt(history_text: str, interval: int, max_bytes: int) -> str:
    header = (
        f"请根据最近 {interval} 秒内的对话生成简明总结（要点化，不超过10条）。\n"
        "只输出总结内容，不要输出 PRD。\n\n"
        "对话记录:\n"
    )
    footer = "\n"
    budget = max_bytes - _utf8_len(header) - _utf8_len(footer)
    if budget <= 0:
        return ""

    trimmed_history = history_text.strip()
    if not trimmed_history:
        return ""
    trimmed_history = _trim_to_utf8_bytes(trimmed_history, budget, from_end=True)
    if not trimmed_history.strip():
        return ""
    return f"{header}{trimmed_history}{footer}"


def _build_prd_prompt(previous_prd: str, summary_text: str, interval: int, max_bytes: int) -> str:
    header = (
        "你是PRD文档生成专家，请输出完整 PRD markdown 文档。\n"
        "PRD应包含：背景、目标&愿景、用户故事、关键模块/特征、核心流程、竞品分析。\n\n"
        "上一版PRD（可能为空）:\n"
    )
    mid = f"\n\n最近 {interval} 秒总结:\n"
    tail = (
        "\n\n要求：\n"
        "1) 在上一版PRD基础上融合新增信息，生成完整PRD。\n"
        "2) 对不明确/待澄清事项，请在条目前加前缀：【待澄清】。\n"
        "3) 输出完整PRD markdown，不要解释说明。\n"
    )

    summary_text = summary_text.strip()
    if not summary_text:
        return ""

    budget = max_bytes - _utf8_len(header) - _utf8_len(mid) - _utf8_len(tail)
    if budget <= 0:
        return ""

    previous_prd = previous_prd.strip()
    if _utf8_len(summary_text) >= budget:
        trimmed_summary = _trim_to_utf8_bytes(summary_text, budget, from_end=True)
        trimmed_prd = ""
    else:
        trimmed_summary = summary_text
        remaining = budget - _utf8_len(trimmed_summary)
        trimmed_prd = _trim_to_utf8_bytes(previous_prd, remaining, from_end=False) if remaining > 0 else ""

    return f"{header}{trimmed_prd}{mid}{trimmed_summary}{tail}"


def get_session_dir(session_id: str) -> Path:
    base_dir = Path("tmp/prd_docs")
    session_dir = base_dir / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


def save_summary_content(session_id: str, content: str, timestamp: str = None) -> Path:
    timestamp = timestamp or datetime.now().strftime("%Y%m%d_%H%M%S")
    session_dir = get_session_dir(session_id)
    filename = f"{timestamp}.md"
    filepath = session_dir / filename
    filepath.write_text(content, encoding="utf-8")
    return filepath


def save_prd_content(session_id: str, content: str, timestamp: str = None) -> Path:
    timestamp = timestamp or datetime.now().strftime("%Y%m%d_%H%M%S")
    session_dir = get_session_dir(session_id)
    filename = f"prd_{timestamp}.md"
    filepath = session_dir / filename
    filepath.write_text(content, encoding="utf-8")

    summary = content[:200].replace('\n', ' ') + "..." if len(content) > 200 else content
    lines = content.strip().split('\n')
    title = lines[0].lstrip('#').strip() if lines and lines[0].startswith('#') else f"PRD-{session_id}"
    insert_prd_record(
        session_id=session_id,
        file_path=str(filepath),
        title=title,
        summary=summary,
    )
    return filepath


# 工具：保存 PRD 文件
def save_prd_file(run_context: RunContext, content: str, filename: str = None) -> str:
    """保存 PRD 文档到文件"""

    filepath = save_prd_content(run_context.session_id, content)
    # 更新 session_state
    run_context.session_state["last_prd_file"] = str(filepath)
    print(f"[{datetime.now()}] PRD 已保存到: {filepath}")
    return f"PRD 已保存到: {filepath}"


# Agent 1: 需求聊天 Agent
chat_agent = Agent(
    name="PRD聊天助手",
    id="prd_chat_agent",
    model=DashScope(id="qwen3-coder-plus", base_url='https://coding.dashscope.aliyuncs.com/v1'),
    markdown=True,
    db=db,
    add_history_to_context=True,
    add_session_state_to_context=True,
    enable_agentic_state=True,
    instructions=[
        "你是一个PRD录入助手，帮助用户整理和生成需求文档",
        "当用户提供的需求不够清晰时，提出问题让用户输入,最好是1个1个的问",
        "PRD应包含：背景、目标&愿景、用户故事、关键模块/特征、核心流程、竞品分析",
        "当前已收集的PRD内容: {prd_content}",
        "上次总结: {last_summary}",
    ],
)



# Agent 2: 总结 Agent
summarizer_agent = Agent(
    name="PRD总结助手",
    id="prd_summarizer_agent",
    model=DashScope(id="qwen3-coder-plus", base_url='https://coding.dashscope.aliyuncs.com/v1'),
    markdown=True,
    db=db,
    instructions=[
        "你是一个PRD文档生成专家",
        "根据提供的对话历史，整理成完整的PRD markdown文档",
        "上次总结内容: {last_summary}",
        "",
    ],
)

# 创建 Team
prd_team = Team(
    name="PRD Team",
    id="prd-team",
    model=DashScope(id="qwen3-coder-plus", base_url='https://coding.dashscope.aliyuncs.com/v1'),
    members=[chat_agent, summarizer_agent],
    db=db,
    session_state={
        "prd_content": {},
        "last_summary": "",
        "last_prd_file": "",
        "last_summary_file": "",
        "last_summary_at": 0,
    },
    add_session_state_to_context=True,
    enable_agentic_state=True,
    share_member_interactions=True,
    add_history_to_context=True,
    instructions=[
        "你是PRD团队的协调者",
        "用户聊天请求交给 PRD聊天助手",
        "总结请求交给 PRD总结助手",
    ],
)

# ======== FastAPI App (Custom Routes) ========
cors_origins = [
    "http://172.16.20.88",
    "http://172.16.20.88:3000",
    "http://172.16.20.88:3001",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]
api_app = build_api_app(
    chat_agent=chat_agent,
    db_path="tmp/prd.db",
    prd_docs_dir=Path("tmp/prd_docs"),
    cors_origins=cors_origins,
)

# 创建 AgentOS
agent_os = AgentOS(
    id="prd-agentos",
    teams=[prd_team],
    agents=[chat_agent, summarizer_agent],
    base_app=api_app,
    cors_allowed_origins=cors_origins,
)
app = agent_os.get_app()


# ========== 定时总结逻辑 ==========
async def periodic_summary( interval: int):
    """每隔 interval 秒执行一次 PRD 总结"""
    while True:
        await asyncio.sleep(interval)

        try:
            sessions = db.get_sessions(component_id='prd_chat_agent', session_type=SessionType.AGENT)
            now_timestamp = int(time.time())

            for _session in sessions:
                session_id = _session.session_id
                state = prd_team.get_session_state(session_id=session_id)
                window_start = now_timestamp - interval

                chat_history = chat_agent.get_chat_history(
                    session_id=session_id,
                    last_n_runs=200
                )

                window_messages = []
                for msg in chat_history:
                    msg_time = getattr(msg, 'created_at', None)
                    if msg_time and msg_time > window_start:
                        window_messages.append(msg)

                if not window_messages:
                    continue

                history_text = "\n".join(
                    [f"{msg.role}: {msg.content}" for msg in window_messages]
                ).strip()
                if not history_text:
                    continue

                summary_prompt = _build_summary_prompt(history_text, interval, MAX_INPUT_BYTES)
                if not summary_prompt:
                    continue

                summary_response = await summarizer_agent.arun(
                    summary_prompt,
                    session_id=session_id,
                )
                summary_content = summary_response.content if summary_response and hasattr(summary_response, "content") else ""
                if summary_content is None:
                    summary_text = ""
                elif isinstance(summary_content, str):
                    summary_text = summary_content
                else:
                    summary_text = str(summary_content)

                if not summary_text.strip():
                    continue

                timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
                summary_path = save_summary_content(session_id, summary_text, timestamp_str)

                last_prd_file = state.get("last_prd_file", "")
                previous_prd = ""
                if last_prd_file:
                    try:
                        prd_path = Path(last_prd_file)
                        if not prd_path.is_absolute():
                            prd_path = Path(__file__).resolve().parent / prd_path
                        previous_prd = prd_path.read_text(encoding="utf-8")
                    except Exception:
                        previous_prd = ""

                prd_prompt = _build_prd_prompt(previous_prd, summary_text, interval, MAX_INPUT_BYTES)
                if not prd_prompt:
                    continue
                prd_response = await summarizer_agent.arun(
                    prd_prompt,
                    session_id=session_id,
                    session_state={"last_summary": summary_text}
                )
                prd_content = prd_response.content if prd_response and hasattr(prd_response, "content") else ""
                if prd_content is None:
                    prd_text = ""
                elif isinstance(prd_content, str):
                    prd_text = prd_content
                else:
                    prd_text = str(prd_content)

                if prd_text.strip():
                    prd_path = save_prd_content(session_id, prd_text, timestamp_str)
                else:
                    prd_path = ""

                prd_team.update_session_state(
                    {
                        "last_summary": summary_text,
                        "last_summary_file": str(summary_path),
                        "last_summary_at": now_timestamp,
                        "last_prd_file": str(prd_path) if prd_path else last_prd_file,
                    },
                    session_id=session_id,
                )
                print(f"[{datetime.now()}] Session {session_id} 总结与 PRD 已更新")

        except Exception as e:
            print(f"总结出错: {e}")


# 启动定时任务的后台线程
def start_periodic_summary(interval: int):
    """在后台启动定时总结"""
    import threading

    def run_async():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(periodic_summary( interval))

    thread = threading.Thread(target=run_async, daemon=True)
    thread.start()
    return thread


if __name__ == "__main__":
    start_periodic_summary(interval=120)
    host = os.getenv("PRD_API_HOST", "0.0.0.0")
    port = int(os.getenv("PRD_API_PORT", "80"))
    agent_os.serve(app="run:app", reload=True, host=host, port=port)
