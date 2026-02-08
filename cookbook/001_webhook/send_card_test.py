import json
import os
import time
from typing import Any, Dict

import requests
from alibabacloud_dingtalk.card_1_0 import models as dingtalkcard_models
from alibabacloud_dingtalk.card_1_0.client import Client as DingTalkCardClient
from alibabacloud_tea_openapi import models as open_api_models
from alibabacloud_tea_util import models as util_models

APP_KEY = os.getenv("DINGTALK_APP_KEY")
APP_SECRET = os.getenv("DINGTALK_APP_SECRET")
ROBOT_CODE = os.getenv("DINGTALK_ROBOT_CODE") or APP_KEY
USER_ID = os.getenv("DINGTALK_USER_ID")
TEMPLATE_ID = os.getenv("DINGTALK_TEMPLATE_ID") or "44c1e728-bcb4-43ff-8c1f-97b9efe9264e.schema"

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


def get_access_token() -> str:
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
    return token


def create_client() -> DingTalkCardClient:
    config = open_api_models.Config()
    config.protocol = "https"
    config.region_id = "central"
    return DingTalkCardClient(config)


def send_test_card() -> None:
    if not USER_ID:
        raise RuntimeError("Missing DINGTALK_USER_ID in environment.")
    access_token = get_access_token()
    client = create_client()

    headers = dingtalkcard_models.CreateAndDeliverHeaders(
        x_acs_dingtalk_access_token=access_token
    )
    im_robot_open_deliver_model = dingtalkcard_models.CreateAndDeliverRequestImRobotOpenDeliverModel(
        space_type="IM_ROBOT",
        robot_code=ROBOT_CODE,
    )
    im_robot_open_space_model = dingtalkcard_models.CreateAndDeliverRequestImRobotOpenSpaceModel(
        support_forward=True,
        last_message_i18n={"ZH_CN": "Test card"},
    )

    card_data = dingtalkcard_models.CreateAndDeliverRequestCardData(
        card_param_map=convert_json_values_to_string(
            {
                "content": "# Test card content\n\nThis is a direct card test.",
                "flowStatus": "3",
            }
        )
    )
    request = dingtalkcard_models.CreateAndDeliverRequest(
        user_id=USER_ID,
        card_template_id=TEMPLATE_ID,
        out_track_id=f"test-card-{int(time.time())}",
        callback_type="",
        card_data=card_data,
        open_space_id=f"dtv1.card//im_robot.{USER_ID}",
        im_robot_open_deliver_model=im_robot_open_deliver_model,
        im_robot_open_space_model=im_robot_open_space_model,
        user_id_type=1,
    )

    resp = client.create_and_deliver_with_options(
        request,
        headers,
        util_models.RuntimeOptions(),
    )
    print(getattr(resp, "body", resp))


if __name__ == "__main__":
    send_test_card()
