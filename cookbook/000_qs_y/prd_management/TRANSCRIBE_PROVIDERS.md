# 语音转文本服务提供商配置指南

本项目支持多个语音转文本服务提供商，您可以根据需求选择合适的服务。

## 支持的服务提供商

### 1. OpenAI Whisper（默认）

**优点**：
- 识别准确率高
- 支持多种语言
- API 简单易用

**缺点**：
- 需要 OpenAI 账户和 API Key
- 有配额限制
- 可能产生费用

**配置**：
```env
TRANSCRIBE_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key
```

**获取 API Key**：
1. 访问 [OpenAI Platform](https://platform.openai.com/)
2. 注册/登录账户
3. 进入 API Keys 页面创建新的 API Key

---

### 2. 阿里云语音识别

**优点**：
- 国内服务，访问速度快
- 支持多种方言
- 价格相对较低

**缺点**：
- 需要阿里云账户
- 配置相对复杂

**配置**：
```env
TRANSCRIBE_PROVIDER=aliyun
ALIYUN_ACCESS_KEY_ID=your_access_key_id
ALIYUN_ACCESS_KEY_SECRET=your_access_key_secret
ALIYUN_ASR_APP_KEY=your_app_key
```

**获取配置信息**：
1. 访问 [阿里云控制台](https://ecs.console.aliyun.com/)
2. 开通智能语音交互服务
3. 创建 AccessKey 和 AppKey
4. 参考 [阿里云文档](https://help.aliyun.com/product/30413.html)

**注意**：当前实现为基本框架，需要根据阿里云实际 API 文档完善实现。

---

### 3. 腾讯云语音识别

**优点**：
- 国内服务，访问速度快
- 支持多种语言和方言
- 识别准确率高

**缺点**：
- 需要腾讯云账户
- 配置相对复杂

**配置**：
```env
TRANSCRIBE_PROVIDER=tencent
TENCENT_SECRET_ID=your_secret_id
TENCENT_SECRET_KEY=your_secret_key
TENCENT_ASR_APP_ID=your_app_id
```

**获取配置信息**：
1. 访问 [腾讯云控制台](https://console.cloud.tencent.com/)
2. 开通语音识别服务
3. 创建 SecretId 和 SecretKey
4. 参考 [腾讯云文档](https://cloud.tencent.com/document/product/1093)

**注意**：当前实现为基本框架，需要根据腾讯云实际 API 文档完善实现。

---

### 4. 百度语音识别

**优点**：
- 国内服务，访问速度快
- 支持多种语言和方言
- 免费额度较高

**缺点**：
- 需要百度账户
- 需要配置 API Key 和 Secret Key

**配置**：
```env
TRANSCRIBE_PROVIDER=baidu
BAIDU_ASR_API_KEY=your_api_key
BAIDU_ASR_SECRET_KEY=your_secret_key
```

**获取配置信息**：
1. 访问 [百度智能云](https://cloud.baidu.com/)
2. 开通语音识别服务
3. 创建应用获取 API Key 和 Secret Key
4. 参考 [百度文档](https://cloud.baidu.com/doc/SPEECH/index.html)

---

## 切换服务提供商

1. 在 `.env.local` 文件中设置 `TRANSCRIBE_PROVIDER` 环境变量
2. 配置对应服务提供商的 API 密钥
3. 重启开发服务器

**示例**：
```env
# 切换到阿里云
TRANSCRIBE_PROVIDER=aliyun
ALIYUN_ACCESS_KEY_ID=xxx
ALIYUN_ACCESS_KEY_SECRET=xxx
ALIYUN_ASR_APP_KEY=xxx
```

## 服务提供商对比

| 服务商 | 准确率 | 速度 | 价格 | 国内访问 | 支持方言 |
|--------|--------|------|------|----------|----------|
| OpenAI Whisper | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| 阿里云 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 腾讯云 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 百度 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

## 故障排除

### OpenAI 配额不足
如果遇到 OpenAI 配额不足错误，可以：
1. 切换到其他服务提供商（阿里云、腾讯云、百度）
2. 检查 OpenAI 账户余额并充值
3. 检查 API 使用限制

### 服务配置错误
如果遇到配置错误：
1. 检查环境变量是否正确设置
2. 确认 API 密钥是否有效
3. 查看服务提供商的文档确认配置格式

### 实现不完整
注意：阿里云、腾讯云、百度的实现目前为基本框架，需要根据各服务商的实际 API 文档完善实现。建议：
1. 参考各服务商的官方 SDK
2. 根据实际 API 文档调整实现
3. 测试确保功能正常

## 添加新的服务提供商

如果需要添加新的服务提供商：

1. 在 `lib/transcribe.ts` 中创建新的 Provider 类，实现 `TranscriptionProvider` 接口
2. 在 `createTranscriptionProvider()` 函数中添加新的 case
3. 更新本文档添加新服务提供商的说明
