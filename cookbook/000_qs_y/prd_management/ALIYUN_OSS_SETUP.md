# 阿里云 OSS + 录音文件识别配置指南

本文档提供详细的阿里云 OSS 和录音文件识别配置步骤。

## 一、准备工作

### 1. 开通阿里云 OSS 服务

1. 登录阿里云控制台
2. 在顶部搜索框输入"对象存储 OSS"或访问：https://oss.console.aliyun.com/
3. 点击"立即开通"
4. 阅读并同意服务协议
5. 选择计费方式（按量付费或包年包月）

### 2. 创建 OSS Bucket

1. 进入 OSS 控制台
2. 点击左侧菜单"Bucket 列表"
3. 点击"创建 Bucket"
4. 填写 Bucket 信息：
   - **Bucket 名称**：例如 "prd-builder-audio"
   - **地域**：选择与智能语音交互服务相同的地域（推荐：华东1-杭州 或 华东2-上海）
   - **存储类型**：标准存储
   - **读写权限**：私有（推荐）或公共读（如果需要在外部访问）
5. 点击"确定"创建 Bucket

### 3. 获取 OSS 配置信息

1. 在 Bucket 列表中，找到刚创建的 Bucket
2. 点击 Bucket 名称进入详情页
3. 在"概览"页面可以看到：
   - **地域**：例如 `oss-cn-shanghai`
   - **Bucket 名称**：例如 `prd-builder-audio`

### 4. 配置 Bucket 跨域（如果需要）

如果前端直接上传到 OSS，需要配置跨域：

1. 进入 Bucket 详情页
2. 点击左侧菜单"数据安全" -> "跨域设置"
3. 点击"创建规则"
4. 配置跨域规则：
   - **来源**：`*` 或您的域名
   - **允许 Methods**：`GET`、`POST`、`PUT`
   - **允许 Headers**：`*`
   - **暴露 Headers**：`ETag`、`x-oss-request-id`
   - **缓存时间**：`3600`

## 二、环境变量配置

在项目根目录的 `.env.local` 文件中添加以下环境变量：

```bash
# 阿里云 AccessKey（与智能语音交互使用相同的 AccessKey）
ALIYUN_ACCESS_KEY_ID=your_access_key_id
ALIYUN_ACCESS_KEY_SECRET=your_access_key_secret

# 阿里云 OSS 配置
ALIYUN_OSS_REGION=oss-cn-shanghai  # OSS 地域，例如：oss-cn-shanghai, oss-cn-hangzhou
ALIYUN_OSS_BUCKET=prd-builder-audio  # OSS Bucket 名称

# 阿里云智能语音交互 AppKey（与实时识别使用相同的 AppKey）
ALIYUN_ASR_APP_KEY=your_app_key

# 启用阿里云录音文件识别（前端环境变量）
NEXT_PUBLIC_USE_ALIYUN_FILE_TRANSCRIPTION=true
```

## 三、安装依赖

运行以下命令安装阿里云 OSS SDK：

```bash
npm install ali-oss
```

## 四、使用说明

### 1. 上传音频文件到 OSS

前端组件会自动检测 `NEXT_PUBLIC_USE_ALIYUN_FILE_TRANSCRIPTION` 环境变量：

- 如果设置为 `true`，文件将上传到 OSS，然后调用录音文件识别接口
- 如果未设置或为 `false`，将使用原有的转写接口（OpenAI 或其他）

### 2. 录音文件识别流程

1. **上传文件到 OSS**
   - 前端调用 `/api/aliyun/upload` 接口
   - 文件上传到 OSS，返回文件 URL

2. **提交识别任务**
   - 前端调用 `/api/aliyun/file-transcribe` 接口（POST）
   - 传入文件 URL，返回任务 ID

3. **轮询获取识别结果**
   - 前端调用 `/api/aliyun/file-transcribe` 接口（PUT）
   - 传入任务 ID 和 `waitForResult: true`
   - 使用 SSE 流式返回识别进度和结果

### 3. API 接口说明

#### 上传文件到 OSS

```typescript
POST /api/aliyun/upload
Content-Type: multipart/form-data

FormData:
- file: File (音频文件)
- projectId?: string (可选，项目 ID)

Response:
{
  "url": "https://prd-builder-audio.oss-cn-shanghai.aliyuncs.com/audio/xxx.wav",
  "objectName": "audio/xxx.wav",
  "fileName": "recording.wav"
}
```

#### 提交识别任务

```typescript
POST /api/aliyun/file-transcribe
Content-Type: application/json

Body:
{
  "fileUrl": "https://prd-builder-audio.oss-cn-shanghai.aliyuncs.com/audio/xxx.wav"
}

Response:
{
  "taskId": "xxx-xxx-xxx",
  "message": "识别任务已提交"
}
```

#### 查询任务状态

```typescript
GET /api/aliyun/file-transcribe?taskId=xxx-xxx-xxx

Response:
{
  "taskId": "xxx-xxx-xxx",
  "status": "SUCCESS" | "RUNNING" | "QUEUING" | "FAILED",
  "result": "识别结果文本",  // 仅当 status 为 SUCCESS 时存在
  "error": "错误信息"  // 仅当 status 为 FAILED 时存在
}
```

#### 轮询获取识别结果（SSE）

```typescript
PUT /api/aliyun/file-transcribe
Content-Type: application/json

Body:
{
  "taskId": "xxx-xxx-xxx",
  "waitForResult": true
}

Response (SSE Stream):
data: {"type":"progress","status":"RUNNING"}
data: {"type":"progress","status":"RUNNING"}
data: {"type":"complete","result":"识别结果文本"}
```

## 五、注意事项

1. **文件格式支持**
   - 支持格式：MP3、WAV、M4A、WebM
   - 推荐格式：WAV（16kHz, 16bit, 单声道）

2. **文件大小限制**
   - 单个文件最大 500MB
   - 建议文件大小 < 100MB 以获得更好的性能

3. **识别时长**
   - 识别时间取决于音频文件长度
   - 通常为音频时长的 1/10 到 1/5（例如：10 分钟音频，识别时间约 2-5 分钟）

4. **费用说明**
   - OSS 存储费用：按实际存储量计费
   - OSS 流量费用：按实际下载流量计费
   - 录音文件识别费用：按音频时长计费（参考阿里云智能语音交互定价）

5. **安全性**
   - 建议将 OSS Bucket 设置为私有
   - 使用预签名 URL 或服务端代理访问文件
   - 定期清理不需要的音频文件以节省存储费用

## 六、故障排查

### 1. 上传失败

- 检查 OSS 配置是否正确（地域、Bucket 名称）
- 检查 AccessKey 是否有 OSS 写入权限
- 检查网络连接是否正常

### 2. 识别任务提交失败

- 检查 AppKey 是否正确
- 检查文件 URL 是否可访问
- 检查文件格式是否支持

### 3. 识别结果获取失败

- 检查任务 ID 是否正确
- 检查任务是否超时（默认 5 分钟）
- 查看服务端日志获取详细错误信息

## 七、参考文档

- [阿里云 OSS 官方文档](https://help.aliyun.com/product/31815.html)
- [阿里云智能语音交互 - 录音文件识别](https://help.aliyun.com/document_detail/84428.html)
- [ali-oss Node.js SDK](https://github.com/ali-sdk/ali-oss)
