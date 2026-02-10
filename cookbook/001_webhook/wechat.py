#!/usr/bin/env python
# coding=utf-8
from agno.tools.baidusearch import BaiduSearchTools
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import Response
import base64
import hashlib
import json
import logging
import os
import random
import string
import tempfile
import time

import requests
from Crypto.Cipher import AES

import WXBizJsonMsgCrypt
from agno.agent import Agent
from agno.models.openai import OpenAILike

app = FastAPI()

agent = Agent(
    model=OpenAILike(
        id="qwen-image-max",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        api_key=os.getenv("DASHSCOPE_IMAGE_API_KEY"),
    ),
    # tools=[BaiduSearchTools()],
    instructions="You are a helpful assistant.",
    add_datetime_to_context=True,  # 启用日期时间上下文
    timezone_identifier="Asia/Shanghai",  # 设置时区
    markdown=True,
    debug_mode= True
)

CACHE_DIR = os.path.join(tempfile.gettempdir(), "wechat_agent_cache")
STREAM_CHUNK_SIZE = 400

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def _generate_random_string(length: int) -> str:
    letters = string.ascii_letters + string.digits
    return ''.join(random.choice(letters) for _ in range(length))


def _process_encrypted_image(image_url, aes_key_base64):
    """
    Download and decrypt encrypted image.
    """
    try:
        logger.info("Downloading encrypted image: %s", image_url)
        response = requests.get(image_url, timeout=15)
        response.raise_for_status()
        encrypted_data = response.content
        logger.info("Image downloaded, size: %d bytes", len(encrypted_data))

        if not aes_key_base64:
            raise ValueError("Missing AES key")

        aes_key = base64.b64decode(aes_key_base64 + "=" * (-len(aes_key_base64) % 4))
        if len(aes_key) != 32:
            raise ValueError("Invalid AES key length: expected 32 bytes")

        iv = aes_key[:16]
        cipher = AES.new(aes_key, AES.MODE_CBC, iv)
        decrypted_data = cipher.decrypt(encrypted_data)

        pad_len = decrypted_data[-1]
        if pad_len > 32:
            raise ValueError("Invalid padding length")

        decrypted_data = decrypted_data[:-pad_len]
        logger.info("Image decrypted, size: %d bytes", len(decrypted_data))
        return True, decrypted_data
    except requests.exceptions.RequestException as exc:
        error_msg = f"Image download failed: {exc}"
        logger.error(error_msg)
        return False, error_msg
    except ValueError as exc:
        error_msg = f"Parameter error: {exc}"
        logger.error(error_msg)
        return False, error_msg
    except Exception as exc:
        error_msg = f"Image processing error: {exc}"
        logger.error(error_msg)
        return False, error_msg


def _ensure_cache_dir() -> None:
    if not os.path.exists(CACHE_DIR):
        os.makedirs(CACHE_DIR, exist_ok=True)


class WeChatAgentCache:
    def __init__(self, cache_dir: str = CACHE_DIR, chunk_size: int = STREAM_CHUNK_SIZE):
        self.cache_dir = cache_dir
        self.chunk_size = chunk_size
        _ensure_cache_dir()

    def start(self, question: str) -> str:
        stream_id = _generate_random_string(10)
        response = agent.run(question)
        answer = response.content or ""
        cache_file = os.path.join(self.cache_dir, f"{stream_id}.json")
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump({
                "question": question,
                "answer": answer,
                "created_time": time.time(),
                "current_offset": 0,
                "chunk_size": self.chunk_size,
            }, f)
        return stream_id

    def next_chunk(self, stream_id: str):
        cache_file = os.path.join(self.cache_dir, f"{stream_id}.json")
        if not os.path.exists(cache_file):
            return "task not found", True

        with open(cache_file, 'r', encoding='utf-8') as f:
            task_data = json.load(f)

        answer = task_data.get("answer", "")
        offset = int(task_data.get("current_offset", 0))
        chunk_size = int(task_data.get("chunk_size", self.chunk_size))

        next_offset = min(len(answer), offset + chunk_size)
        chunk = answer[offset:next_offset]
        task_data["current_offset"] = next_offset

        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(task_data, f)

        finish = next_offset >= len(answer)
        return chunk, finish


def MakeTextStream(stream_id, content, finish):
    plain = {
        "msgtype": "stream",
        "stream": {
            "id": stream_id,
            "finish": finish,
            "content": content
        }
    }
    return json.dumps(plain, ensure_ascii=False)


def MakeImageStream(stream_id, image_data, finish):
    image_md5 = hashlib.md5(image_data).hexdigest()
    image_base64 = base64.b64encode(image_data).decode('utf-8')

    plain = {
        "msgtype": "stream",
        "stream": {
            "id": stream_id,
            "finish": finish,
            "msg_item": [
                {
                    "msgtype": "image",
                    "image": {
                        "base64": image_base64,
                        "md5": image_md5
                    }
                }
            ]
        }
    }
    return json.dumps(plain)


def EncryptMessage(receiveid, nonce, timestamp, stream):
    logger.info("Encrypting message, receiveid=%s, nonce=%s, timestamp=%s", receiveid, nonce, timestamp)
    wxcpt = WXBizJsonMsgCrypt.WXBizJsonMsgCrypt(os.getenv('Token', ''), os.getenv('EncodingAESKey', ''), receiveid)
    ret, resp = wxcpt.EncryptMsg(stream, nonce, timestamp)
    if ret != 0:
        logger.error("Encryption failed, code: %d", ret)
        return None
    return resp


@app.get("/ai-bot/callback/demo/{botid}")
async def verify_url(
    request: Request,
    botid: str,
    msg_signature: str,
    timestamp: str,
    nonce: str,
    echostr: str
):
    receiveid = ''
    wxcpt = WXBizJsonMsgCrypt.WXBizJsonMsgCrypt(os.getenv('Token', ''), os.getenv('EncodingAESKey', ''), receiveid)
    ret, echostr = wxcpt.VerifyURL(msg_signature, timestamp, nonce, echostr)
    if ret != 0:
        echostr = "verify fail"
    return Response(content=echostr, media_type="text/plain")


@app.post("/ai-bot/callback/demo/{botid}")
async def handle_message(
    request: Request,
    botid: str,
    msg_signature: str = None,
    timestamp: str = None,
    nonce: str = None
):
    if not all([msg_signature, timestamp, nonce]):
        raise HTTPException(status_code=400, detail="Missing required parameters")

    logger.info(
        "Incoming message botid=%s msg_signature=%s timestamp=%s nonce=%s",
        botid,
        msg_signature,
        timestamp,
        nonce,
    )

    post_data = await request.body()

    receiveid = ''
    wxcpt = WXBizJsonMsgCrypt.WXBizJsonMsgCrypt(os.getenv('Token', ''), os.getenv('EncodingAESKey', ''), receiveid)
    ret, msg = wxcpt.DecryptMsg(post_data, msg_signature, timestamp, nonce)
    if ret != 0:
        raise HTTPException(status_code=400, detail="Decrypt failed")

    data = json.loads(msg)
    logger.debug("Decrypted data: %s", data)
    if 'msgtype' not in data:
        logger.info("Unknown event: %s", data)
        return Response(content="success", media_type="text/plain")

    msgtype = data['msgtype']
    cache = WeChatAgentCache()

    if msgtype == 'text':
        content = data['text']['content']
        stream_id = cache.start(content)
        answer, finish = cache.next_chunk(stream_id)
        stream = MakeTextStream(stream_id, answer, finish)
        resp = EncryptMessage(receiveid, nonce, timestamp, stream)
        if resp is None:
            raise HTTPException(status_code=500, detail="Encrypt failed")
        return Response(content=resp, media_type="text/plain")
    if msgtype == 'stream':
        stream_id = data['stream']['id']
        answer, finish = cache.next_chunk(stream_id)
        stream = MakeTextStream(stream_id, answer, finish)
        resp = EncryptMessage(receiveid, nonce, timestamp, stream)
        if resp is None:
            raise HTTPException(status_code=500, detail="Encrypt failed")
        return Response(content=resp, media_type="text/plain")
    if msgtype == 'image':
        aes_key = os.getenv('EncodingAESKey', '')
        success, result = _process_encrypted_image(data['image']['url'], aes_key)
        if not success:
            logger.error("Image processing failed: %s", result)
            return Response(content="success", media_type="text/plain")

        decrypted_data = result
        stream_id = _generate_random_string(10)
        finish = True

        stream = MakeImageStream(stream_id, decrypted_data, finish)
        resp = EncryptMessage(receiveid, nonce, timestamp, stream)
        if resp is None:
            raise HTTPException(status_code=500, detail="Encrypt failed")
        return Response(content=resp, media_type="text/plain")
    if msgtype == 'mixed':
        logger.warning("mixed message type not supported yet")
        return Response(content="success", media_type="text/plain")
    if msgtype == 'event':
        logger.warning("event message type not supported: %s", data)
        return Response(content="success", media_type="text/plain")

    logger.warning("Unsupported message type: %s", msgtype)
    return Response(content="success", media_type="text/plain")


import httpx
from agno.agent import Agent
from agno.models.dashscope import DashScope
from agno.tools import tool


@tool(show_result=True)
def generate_image(prompt: str) -> str:
    """使用阿里云生成图片

    Args:
        prompt: 图片描述
    Returns:
        生成的图片 URL
    """
    api_key = os.getenv("DASHSCOPE_IMAGE_API_KEY")

    # 1. 提交任务
    url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    data = {
        "model": "qwen-image-max",
         "input": {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "text": prompt
                        }
                    ]
                }
            ]
        },
        "parameters": {"n": 1, "size": "1024*1024"}
    }

    response = httpx.post(url, headers=headers, json=data)
    result = response.json()
    task_id = result.get("output", {}).get("task_id")

    if not task_id:
        return f"任务创建失败: {result}"

    # 2. 轮询获取结果
    status_url = f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"
    headers = {"Authorization": f"Bearer {api_key}"}

    for _ in range(30):  # 最多等待 30 次
        time.sleep(2)  # 每 2 秒查询一次
        status_response = httpx.get(status_url, headers=headers)
        status_result = status_response.json()

        task_status = status_result.get("output", {}).get("task_status")

        if task_status == "SUCCEEDED":
            # 获取图片 URL
            results = status_result.get("output", {}).get("results", [])
            if results:
                image_url = results[0].get("url")
                return f"图片生成成功: {image_url}"
            return "图片生成成功但未找到 URL"

        elif task_status == "FAILED":
            return f"图片生成失败: {status_result}"

    return "图片生成超时"


# 创建 Agent
agent2 = Agent(
    model=OpenAILike(
        id="qwen-plus",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        api_key=os.getenv("DASHSCOPE_IMAGE_API_KEY"),
    ),
    tools=[generate_image],
    markdown=True,
    debug_mode=True,
)

# agent.print_response("生成一只可爱的猫咪图片")
if __name__ == "__main__":
    # import uvicorn
    # uvicorn.run(app, host="0.0.0.0", port=9080)
    res = agent2.run("画一只猫")
    if res.images:
        for img in res.images:
            print(img.url)
