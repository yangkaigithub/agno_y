import os
from pathlib import Path

from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.models.dashscope import DashScope
from agno.os import AgentOS

from prd_api import build_api_app

db = SqliteDb(db_file="tmp/prd.db")


summary_agent = Agent(
    name="分段总结助手",
    id="doc_summary_agent",
    model=DashScope(id="qwen3-coder-plus", base_url="https://coding.dashscope.aliyuncs.com/v1"),
    markdown=True,
    db=db,
    instructions=[
        "你是分段总结助手，擅长从片段文本中提炼要点。",
        "输出必须要点化、尽可能抓住关键需求/约束/决策/风险/待澄清。",
        "输出格式：仅使用有序列表（1. 2. 3. ...），不要标题、不要前言。",
    ],
)

prd_agent = Agent(
    id="doc_prd_agent",    name="PRD生成助手",

    model=DashScope(id="qwen3-coder-plus", base_url="https://coding.dashscope.aliyuncs.com/v1"),
    markdown=True,
    db=db,
    instructions=[
        "你是 PRD 文档生成专家，输出“可直接开工”的落地详细版 PRD（Markdown）。",
        "根据上一版 PRD + 新增要点输出最新完整 PRD（覆盖上一版），结构稳定、内容可执行。",
    ],
)


cors_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]

api_app = build_api_app(
    summary_agent=summary_agent,
    prd_agent=prd_agent,
    db_path="tmp/prd.db",
    prd_docs_dir=Path("tmp/prd_docs"),
    cors_origins=cors_origins,
)

agent_os = AgentOS(
    id="doc-agentos",
    teams=[],
    agents=[summary_agent, prd_agent],
    base_app=api_app,
    cors_allowed_origins=cors_origins,
)

app = agent_os.get_app()


if __name__ == "__main__":
    host = os.getenv("PRD_API_HOST", "0.0.0.0")
    port = int(os.getenv("PRD_API_PORT", "80"))
    agent_os.serve(app="run:app", reload=True, host=host, port=port)
