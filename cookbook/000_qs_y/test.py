import json
import os
import time
import threading

import nls
from aliyunsdkcore.client import AcsClient
from aliyunsdkcore.request import CommonRequest

URL = "wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1"
TOKEN = None
APPKEY = None
AK_ID = None
AK_SECRET = None
DEFAULT_APPKEY = None


def _get_env(*names):
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


def _create_token(ak_id, ak_secret, region_id="cn-shanghai"):
    client = AcsClient(ak_id, ak_secret, region_id)
    request = CommonRequest()
    request.set_method("POST")
    request.set_domain("nls-meta.cn-shanghai.aliyuncs.com")
    request.set_version("2019-02-28")
    request.set_action_name("CreateToken")

    response = client.do_action_with_exception(request)
    payload = json.loads(response)
    token_info = payload.get("Token", {})
    token = token_info.get("Id")
    if not token:
        raise RuntimeError("CreateToken failed: {}".format(payload))
    return token, token_info.get("ExpireTime")


def _resolve_auth():
    appkey = _get_env("ALIYUN_ASR_APP_KEY", "ALIYUN_APP_KEY", "APPKEY") or DEFAULT_APPKEY
    if not appkey:
        raise RuntimeError("Missing appkey. Set ALIYUN_ASR_APP_KEY.")

    token = _get_env("ALIYUN_NLS_TOKEN", "NLS_TOKEN")
    if token:
        return token, appkey

    ak_id = _get_env("ALIYUN_ACCESS_KEY_ID", "ALIYUN_AK_ID") or AK_ID
    ak_secret = _get_env("ALIYUN_ACCESS_KEY_SECRET", "ALIYUN_AK_SECRET") or AK_SECRET
    if not ak_id or not ak_secret:
        raise RuntimeError("Missing access keys. Set ALIYUN_ACCESS_KEY_ID/ALIYUN_ACCESS_KEY_SECRET.")

    token, expire_time = _create_token(ak_id, ak_secret)
    if expire_time:
        print("token expireTime = {}".format(expire_time))
    return token, appkey


# 以下代码会根据音频文件内容反复进行实时语音识别（文件转写）
class TestSt:
    def __init__(self, tid, test_file):
        self.__th = threading.Thread(target=self.__test_run)
        self.__id = tid
        self.__test_file = test_file

    def loadfile(self, filename):
        with open(filename, "rb") as f:
            self.__data = f.read()

    def start(self):
        self.loadfile(self.__test_file)
        self.__th.start()

    def test_on_sentence_begin(self, message, *args):
        print("test_on_sentence_begin:{}".format(message))

    def test_on_sentence_end(self, message, *args):
        print("test_on_sentence_end:{}".format(message))

    def test_on_start(self, message, *args):
        print("test_on_start:{}".format(message))

    def test_on_error(self, message, *args):
        print("on_error args=>{}".format(args))

    def test_on_close(self, *args):
        print("on_close: args=>{}".format(args))

    def test_on_result_chg(self, message, *args):
        print("test_on_chg:{}".format(message))

    def test_on_completed(self, message, *args):
        print("on_completed:args=>{} message=>{}".format(args, message))

    def __test_run(self):
        print("thread:{} start..".format(self.__id))
        sr = nls.NlsSpeechTranscriber(
            url=URL,
            token=TOKEN,
            appkey=APPKEY,
            on_sentence_begin=self.test_on_sentence_begin,
            on_sentence_end=self.test_on_sentence_end,
            on_start=self.test_on_start,
            on_result_changed=self.test_on_result_chg,
            on_completed=self.test_on_completed,
            on_error=self.test_on_error,
            on_close=self.test_on_close,
            callback_args=[self.__id]
        )

        print("{}: session start".format(self.__id))
        r = sr.start(aformat="pcm",
                     enable_intermediate_result=True,
                     enable_punctuation_prediction=True,
                     enable_inverse_text_normalization=True)

        self.__slices = zip(*(iter(self.__data),) * 640)
        for i in self.__slices:
            sr.send_audio(bytes(i))
            time.sleep(0.01)

        sr.ctrl(ex={"test": "tttt"})
        time.sleep(1)

        r = sr.stop()
        print("{}: sr stopped:{}".format(self.__id, r))
        time.sleep(1)


def multiruntest(num=500):
    for i in range(0, num):
        name = "thread" + str(i)
        t = TestSt(name, "tests/test1.pcm")
        t.start()

if __name__ == "__main__":
    TOKEN, APPKEY = _resolve_auth()
    nls.enableTrace(False)
    multiruntest(1)
