import argparse
import json
import logging
import os
import time
import uuid
from typing import Any, Dict, List

import requests
import dingtalk_stream
from agno.agent import Agent
from agno.models.openai import OpenAILike
from agno.run.agent import RunContentEvent, RunErrorEvent, RunCompletedEvent
from alibabacloud_dingtalk.card_1_0 import models as dingtalkcard_models
from alibabacloud_dingtalk.card_1_0.client import Client as DingTalkCardClient
from alibabacloud_tea_openapi import models as open_api_models
from alibabacloud_tea_util import models as util_models
from alibabacloud_tea_util.client import Client as UtilClient
from dingtalk_stream import AckMessage
from fastapi import FastAPI

agent = Agent(
    model=OpenAILike(
        id="qwen3-coder-plus",
        base_url="https://coding.dashscope.aliyuncs.com/v1",
        api_key=os.getenv("DASHSCOPE_API_KEY"),
    ),
    instructions="You are a helpful assistant.",
    markdown=True,
)

app = FastAPI()
NEW_SESSION_CMD = "新建会话"
MAX_HISTORY_TURNS = 8
SESSION_STORE = {}
APP_KEY = os.getenv("DINGTALK_APP_KEY")
APP_SECRET = os.getenv("DINGTALK_APP_SECRET")
ROBOT_CODE = os.getenv("DINGTALK_ROBOT_CODE") or APP_KEY
TEMPLATE_ID = os.getenv("DINGTALK_TEMPLATE_ID") or "44c1e728-bcb4-43ff-8c1f-97b9efe9264e.schema"
STREAM_CHUNK_SIZE = 80
STREAM_SLEEP_SECONDS = 0.3
TOKEN_CACHE = {"token": None, "expires_at": 0.0}
USE_RICH_TEXT = False
USE_MARKDOWN = False
STREAM_ENABLED = False
MAX_CARD_CHARS = 400


def convert_json_values_to_string(obj: Dict[str, Any]) -> Dict[str, str]:
    result = {}
    for key, value in obj.items():
        if isinstance(value, str):
            result[key] = value
        else:
            try:
                result[key] = json.dumps(value, ensure_ascii=False)
            except (TypeError, ValueError):
                result[key] = ""
    return result


def _to_rich_text(content: str) -> str:
    if not USE_RICH_TEXT:
        return _format_card_text(content)
    rich = {
        "items": [
            {
                "type": "text",
                "data": {"text": _format_card_text(content)},
            }
        ],
        "version": "1.1",
    }
    return json.dumps(rich, ensure_ascii=False)


def _format_card_text(text: str) -> str:
    if USE_MARKDOWN:
        result = text
    else:
        result = _markdown_to_plain_text(text)
    return result[:MAX_CARD_CHARS]


def _markdown_to_plain_text(text: str) -> str:
    if not text:
        return ""
    cleaned = text.replace("\r\n", "\n")
    cleaned = cleaned.replace("```", "")
    cleaned = cleaned.replace("`", "")
    cleaned = cleaned.replace("**", "")
    cleaned = cleaned.replace("__", "")
    cleaned = cleaned.replace("* ", "")
    cleaned = cleaned.replace("- ", "")
    cleaned = cleaned.replace("#", "")
    cleaned = "\n".join(line.strip() for line in cleaned.splitlines())
    return cleaned.strip()


def get_access_token() -> str:
    now = time.time()
    if TOKEN_CACHE["token"] and now < TOKEN_CACHE["expires_at"] - 60:
        return TOKEN_CACHE["token"]

    if not APP_KEY or not APP_SECRET:
        raise RuntimeError("Missing DINGTALK_APP_KEY or DINGTALK_APP_SECRET in environment.")

    resp = requests.post(
        "https://api.dingtalk.com/v1.0/oauth2/accessToken",
        json={"appKey": APP_KEY, "appSecret": APP_SECRET},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("accessToken")
    if not token:
        raise RuntimeError(f"Failed to get access token: {data}")
    expires_in = data.get("expireIn", 7200)
    TOKEN_CACHE["token"] = token
    TOKEN_CACHE["expires_at"] = now + expires_in
    return token


def create_card_client() -> DingTalkCardClient:
    config = open_api_models.Config()
    config.protocol = "https"
    config.region_id = "central"
    return DingTalkCardClient(config)


def _extract_carrier_id(resp) -> str:
    body = getattr(resp, "body", None)
    if body is None:
        return ""
    try:
        data = body.to_map()
    except Exception:
        data = body if isinstance(body, dict) else {}
    try:
        return (
            data.get("result", {})
            .get("deliverResults", [{}])[0]
            .get("carrierId", "")
        )
    except Exception:
        return ""


def _chunk_text(text: str, size: int) -> List[str]:
    return [text[i:i + size] for i in range(0, len(text), size)] or [""]


def start_stream_card(user_id: str):
    access_token = get_access_token()
    client = create_card_client()
    out_track_id = f"agent-{int(time.time())}-{uuid.uuid4().hex[:8]}"

    im_robot_open_deliver_model = dingtalkcard_models.CreateAndDeliverRequestImRobotOpenDeliverModel(
        space_type="IM_ROBOT",
        robot_code=ROBOT_CODE,
    )
    im_robot_open_space_model = dingtalkcard_models.CreateAndDeliverRequestImRobotOpenSpaceModel(
        support_forward=True,
        last_message_i18n={"ZH_CN": "处理中"},
    )
    card_data = dingtalkcard_models.CreateAndDeliverRequestCardData(
        card_param_map=convert_json_values_to_string(
            {"content": _to_rich_text(""), "flowStatus": "2"}
        )
    )
    create_and_deliver_request = dingtalkcard_models.CreateAndDeliverRequest(
        user_id=user_id,
        card_template_id=TEMPLATE_ID,
        out_track_id=out_track_id,
        callback_type="STREAM",
        card_data=card_data,
        open_space_id=f"dtv1.card//im_robot.{user_id}",
        im_robot_open_deliver_model=im_robot_open_deliver_model,
        im_robot_open_space_model=im_robot_open_space_model,
        user_id_type=1,
    )
    create_and_deliver_headers = dingtalkcard_models.CreateAndDeliverHeaders(
        x_acs_dingtalk_access_token=access_token
    )
    resp = client.create_and_deliver_with_options(
        create_and_deliver_request,
        create_and_deliver_headers,
        util_models.RuntimeOptions(),
    )
    logging.getLogger().info("create_and_deliver response=%s", getattr(resp, "body", resp))

    streaming_headers = dingtalkcard_models.StreamingUpdateHeaders(
        x_acs_dingtalk_access_token=access_token
    )
    carrier_id = _extract_carrier_id(resp)
    stream_guid = carrier_id or uuid.uuid4().hex
    try:
        finalize_stream_card(out_track_id, "", flow_status="2")
    except Exception as exc:
        logging.getLogger().error("init flowStatus failed: %s", exc)
    return client, out_track_id, stream_guid, streaming_headers


def stream_update_card(
    client: DingTalkCardClient,
    headers: dingtalkcard_models.StreamingUpdateHeaders,
    out_track_id: str,
    guid: str,
    content: str,
    *,
    is_finalize: bool = False,
    is_error: bool = False,
    is_full: bool = False,
):
    logger = logging.getLogger()
    payload = _to_rich_text(content)
    request = dingtalkcard_models.StreamingUpdateRequest(
        content=payload,
        guid=guid,
        key="content",
        out_track_id=out_track_id,
        is_full=is_full,
        is_finalize=is_finalize,
        is_error=is_error,
    )
    logger.info(
        "stream_update_card out_track_id=%s len=%s finalize=%s error=%s",
        out_track_id,
        len(content),
        is_finalize,
        is_error,
    )
    resp = client.streaming_update_with_options(request, headers, util_models.RuntimeOptions())
    logger.info("stream_update_card response=%s", getattr(resp, "body", resp))


def finalize_stream_card(
    out_track_id: str,
    content: str,
    *,
    flow_status: str = "3",
):
    access_token = get_access_token()
    client = create_card_client()
    update_headers = dingtalkcard_models.UpdateCardHeaders(
        x_acs_dingtalk_access_token=access_token
    )
    update_options = dingtalkcard_models.UpdateCardRequestCardUpdateOptions(
        update_card_data_by_key=True
    )
    card_data = dingtalkcard_models.UpdateCardRequestCardData(
        card_param_map=convert_json_values_to_string(
            {"content": _to_rich_text(content), "flowStatus": flow_status}
        )
    )
    update_request = dingtalkcard_models.UpdateCardRequest(
        out_track_id=out_track_id,
        card_data=card_data,
        card_update_options=update_options,
        user_id_type=1,
    )
    logger = logging.getLogger()
    logger.info(
        "finalize_stream_card out_track_id=%s len=%s flowStatus=%s",
        out_track_id,
        len(content),
        flow_status,
    )
    resp = client.update_card_with_options(update_request, update_headers, util_models.RuntimeOptions())
    logger.info("finalize_stream_card response=%s", getattr(resp, "body", resp))


def stream_agent_reply(user_id: str, prompt: str):
    try:
        client, out_track_id, guid, headers = start_stream_card(user_id)
    except Exception as exc:
        logging.getLogger().error("stream card init failed: %s", exc)
        return "", False

    buffer = ""
    last_flush = time.time()
    last_sent_len = 0
    got_content = False
    stream_ok = True

    logger = logging.getLogger()
    for event in agent.run(prompt, stream=True, stream_events=True):
        logger.info("stream event type=%s", type(event).__name__)
        if isinstance(event, RunContentEvent) and event.content:
            chunk = str(event.content)
            buffer += chunk
            got_content = True
            if (
                len(buffer) - last_sent_len >= STREAM_CHUNK_SIZE
                or time.time() - last_flush >= STREAM_SLEEP_SECONDS
            ):
                try:
                    delta = buffer[last_sent_len:]
                    stream_update_card(
                        client,
                        headers,
                        out_track_id,
                        guid,
                        delta,
                        is_finalize=False,
                        is_full=False,
                    )
                except Exception as exc:
                    logging.getLogger().error("stream update failed: %s", exc)
                    stream_ok = False
                    break
                last_flush = time.time()
                last_sent_len = len(buffer)
        elif isinstance(event, RunCompletedEvent) and event.content:
            buffer += str(event.content)
            got_content = True
        elif isinstance(event, RunErrorEvent):
            error_text = event.content or "Unknown error"
            buffer += f"\n\n[Error] {error_text}"
            try:
                stream_update_card(
                    client,
                    headers,
                    out_track_id,
                    guid,
                    buffer,
                    is_finalize=True,
                    is_error=True,
                    is_full=True,
                )
            except Exception as exc:
                logging.getLogger().error("stream update failed: %s", exc)
                stream_ok = False
            return buffer, stream_ok

    if not got_content:
        response = agent.run(prompt)
        buffer = response.content or ""

    if stream_ok:
        try:
            stream_update_card(
                client,
                headers,
                out_track_id,
                guid,
                buffer,
                is_finalize=True,
                is_full=True,
            )
        except Exception as exc:
            logging.getLogger().error("stream update failed: %s", exc)
            stream_ok = False
    if stream_ok:
        try:
            finalize_stream_card(out_track_id, buffer, flow_status="3")
        except Exception as exc:
            logging.getLogger().error("finalize card failed: %s", exc)
            stream_ok = False
    return buffer, stream_ok


def send_final_card(user_id: str, content: str) -> None:
    env_user_id = os.getenv("DINGTALK_USER_ID")
    user_id = env_user_id or user_id
    access_token = get_access_token()
    client = create_card_client()
    out_track_id = f"agent-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    im_robot_open_deliver_model = dingtalkcard_models.CreateAndDeliverRequestImRobotOpenDeliverModel(
        space_type="IM_ROBOT",
        robot_code=ROBOT_CODE,
    )
    im_robot_open_space_model = dingtalkcard_models.CreateAndDeliverRequestImRobotOpenSpaceModel(
        support_forward=True,
        last_message_i18n={"ZH_CN": "已完成"},
    )
    card_data = dingtalkcard_models.CreateAndDeliverRequestCardData(
        card_param_map=convert_json_values_to_string(
            {"content": _format_card_text(content), "flowStatus": "3"}
        )
    )
    create_and_deliver_request = dingtalkcard_models.CreateAndDeliverRequest(
        user_id=user_id,
        card_template_id=TEMPLATE_ID,
        out_track_id=out_track_id,
        callback_type="",
        card_data=card_data,
        open_space_id=f"dtv1.card//im_robot.{user_id}",
        im_robot_open_deliver_model=im_robot_open_deliver_model,
        im_robot_open_space_model=im_robot_open_space_model,
        user_id_type=1,
    )
    create_and_deliver_headers = dingtalkcard_models.CreateAndDeliverHeaders(
        x_acs_dingtalk_access_token=access_token
    )
    resp = client.create_and_deliver_with_options(
        create_and_deliver_request,
        create_and_deliver_headers,
        util_models.RuntimeOptions(),
    )
    logging.getLogger().info("send_final_card response=%s", getattr(resp, "body", resp))


def setup_logger():
    logger = logging.getLogger()
    log_path = (
        __file__.replace("\\", "/").rsplit("/", 1)[0] + "/dingding_card_debug.log"
    )
    if not logger.handlers:
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(
            logging.Formatter('%(asctime)s %(name)-8s %(levelname)-8s %(message)s [%(filename)s:%(lineno)d]')
        )
        logger.addHandler(stream_handler)
    has_file = any(isinstance(h, logging.FileHandler) for h in logger.handlers)
    if not has_file:
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        file_handler.setFormatter(
            logging.Formatter('%(asctime)s %(name)-8s %(levelname)-8s %(message)s [%(filename)s:%(lineno)d]')
        )
        logger.addHandler(file_handler)
    logger.setLevel(logging.INFO)
    return logger


def define_options():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        '--client_id', dest='client_id', required=True,
        help='app_key or suite_key from https://open-dev.dingtalk.com'
    )
    parser.add_argument(
        '--client_secret', dest='client_secret', required=True,
        help='app_secret or suite_secret from https://open-dev.dingtalk.com'
    )
    options = parser.parse_args()
    return options


class AgentChatbotHandler(dingtalk_stream.ChatbotHandler):
    def __init__(self, logger: logging.Logger = None):
        super().__init__()
        if logger:
            self.logger = logger

    async def process(self, callback: dingtalk_stream.CallbackMessage):
        incoming_message = dingtalk_stream.ChatbotMessage.from_dict(callback.data)
        user_message = (incoming_message.text.content or "").strip()
        if not user_message:
            return AckMessage.STATUS_OK, 'OK'

        session_key = self._get_session_key(incoming_message)
        if user_message == NEW_SESSION_CMD:
            SESSION_STORE[session_key] = []
            self.reply_markdown("Session Reset", "已开启新的会话。", incoming_message)
            return AckMessage.STATUS_OK, 'OK'

        stream_ok = True
        try:
            history = SESSION_STORE.get(session_key, [])
            prompt = self._build_prompt(history, user_message)
            user_id = incoming_message.sender_staff_id or incoming_message.sender_id
            if user_id:
                if STREAM_ENABLED:
                    reply_text, stream_ok = stream_agent_reply(user_id, prompt)
                else:
                    response = agent.run(prompt)
                    reply_text = response.content or ""
                    send_final_card(user_id, reply_text)
            else:
                response = agent.run(prompt)
                reply_text = response.content or ""
        except Exception as e:
            reply_text = 'Error: %s' % e
            stream_ok = False

        history = SESSION_STORE.get(session_key, [])
        history.append(("user", user_message))
        history.append(("assistant", reply_text))
        SESSION_STORE[session_key] = history[-MAX_HISTORY_TURNS * 2:]

        self.logger.info('User: %s', user_message)
        self.logger.info('Reply: %s', reply_text)
        if (not (incoming_message.sender_staff_id or incoming_message.sender_id)) or (user_id and not stream_ok):
            self.reply_markdown("AI Reply", reply_text, incoming_message)
        return AckMessage.STATUS_OK, 'OK'

    @staticmethod
    def _get_session_key(incoming_message: dingtalk_stream.ChatbotMessage) -> str:
        return incoming_message.sender_staff_id or incoming_message.sender_id

    @staticmethod
    def _build_prompt(history, user_message: str) -> str:
        lines = []
        for role, content in history[-MAX_HISTORY_TURNS * 2:]:
            label = "User" if role == "user" else "Assistant"
            lines.append(f"{label}: {content}")
        history_text = "\n".join(lines)
        return (
            "Follow the instructions. Do not reveal chain-of-thought.\n"
            "Conversation history:\n"
            f"{history_text}\n"
            f"User: {user_message}\n"
            "Assistant:"
        )


def main():
    logger = setup_logger()
    credential = dingtalk_stream.Credential(
        "dingpm0td59nixvh7oxc",
        "qrAvzvSP1joYCZokhLXxyZUur8t216uJyvmyYu7unOev41QPEpYeijEjJXqwXsKA",
    )
    client = dingtalk_stream.DingTalkStreamClient(credential)
    client.register_callback_handler(dingtalk_stream.chatbot.ChatbotMessage.TOPIC, AgentChatbotHandler(logger))
    client.start_forever()
    # response = await agent.arun('怎么养猪')
    # print(response.content)

if __name__ == '__main__':
    main()

