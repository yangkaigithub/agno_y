# 阿里云语音识别配置指南

本文档提供详细的阿里云语音识别（ASR）配置步骤。

## 一、准备工作

### 1. 注册阿里云账号

1. 访问 [阿里云官网](https://www.aliyun.com/)
2. 注册并登录账号
3. 完成实名认证（必须）

### 2. 开通智能语音交互服务

1. 登录阿里云控制台
2. 在顶部搜索框输入"智能语音交互"或访问：https://nls-portal.console.aliyun.com/
3. 点击"立即开通"
4. 阅读并同意服务协议
5. 选择计费方式（按量付费或包年包月）

## 二、创建项目和获取 AppKey

### 1. 创建项目

1. 进入智能语音交互控制台
2. 点击左侧菜单"项目管理"
3. 点击"创建项目"
4. 填写项目信息：
   - **项目名称**：例如 "PRD Builder"
   - **项目描述**：可选
5. 点击"确定"创建项目

### 2. 获取 AppKey

1. 在项目列表中，找到刚创建的项目
2. 点击项目名称进入详情页
3. 在"项目信息"中可以看到 **AppKey**（格式类似：`nls-service-xxxxx`）
4. 复制并保存 AppKey

## 三、获取 AccessKey

### 1. 创建 AccessKey

1. 登录阿里云控制台
2. 鼠标悬停在右上角头像，选择"AccessKey 管理"
   或直接访问：https://ram.console.aliyun.com/manage/ak
3. 点击"创建 AccessKey"
4. 完成安全验证（手机验证码或 MFA）
5. 创建成功后，会显示：
   - **AccessKey ID**：例如 `LTAI5txxxxxxxxxxxxx`
   - **AccessKey Secret**：例如 `xxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
6. **重要**：立即复制并保存 AccessKey Secret（只显示一次）

### 2. 安全建议

- 不要将 AccessKey 提交到代码仓库
- 建议创建子账号并授予最小权限
- 定期轮换 AccessKey

## 四、配置项目环境变量

在项目根目录的 `.env.local` 文件中添加以下配置：

```env
# 选择阿里云作为语音转文本服务提供商
TRANSCRIBE_PROVIDER=aliyun

# 阿里云 AccessKey ID（从 AccessKey 管理页面获取）
ALIYUN_ACCESS_KEY_ID=LTAI5txxxxxxxxxxxxx

# 阿里云 AccessKey Secret（从 AccessKey 管理页面获取，只显示一次）
ALIYUN_ACCESS_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 阿里云智能语音交互 AppKey（从项目管理页面获取）
ALIYUN_ASR_APP_KEY=nls-service-xxxxx
```

**配置步骤总结**：

1. ✅ 注册阿里云账号并完成实名认证
2. ✅ 开通智能语音交互服务
3. ✅ 创建项目并获取 AppKey
4. ✅ 创建 AccessKey 并获取 ID 和 Secret
5. ✅ 在 `.env.local` 中配置上述三个值
6. ✅ 设置 `TRANSCRIBE_PROVIDER=aliyun`

## 五、安装依赖

当前实现使用 REST API，**不需要安装额外的 SDK**。

如果需要使用阿里云官方 SDK（可选），可以安装：

```bash
npm install @alicloud/nls-sdk
```

但当前代码已实现 REST API 调用，无需 SDK。

## 六、测试配置

### 1. 启动开发服务器

```bash
npm run dev
```

### 2. 测试 Token 生成

访问：`http://localhost:3001/api/aliyun/token`

如果配置正确，应该返回：
```json
{
  "token": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "expireTime": 1234567890
}
```

如果返回错误，检查：
- 环境变量是否正确设置
- AccessKey 是否有效
- 网络连接是否正常

### 3. 测试语音转写

1. 访问应用：`http://localhost:3001`
2. 点击"新建项目"
3. 上传音频文件或开始录音
4. 查看控制台日志，确认使用的是"阿里云语音识别"
5. 检查转写结果是否正确

## 七、常见问题

### 1. 认证失败

**错误信息**：`InvalidAccessKeyId` 或 `SignatureDoesNotMatch`

**解决方法**：
- ✅ 检查 AccessKey ID 和 Secret 是否正确（注意不要有多余空格）
- ✅ 确认 AccessKey 没有被禁用（在 AccessKey 管理页面检查状态）
- ✅ 检查环境变量是否正确设置（重启开发服务器使环境变量生效）
- ✅ 确认 AccessKey 有智能语音交互服务的权限

### 2. AppKey 错误

**错误信息**：`InvalidAppKey`

**解决方法**：
- 检查 AppKey 是否正确
- 确认 AppKey 对应的项目已开通服务
- 检查 AppKey 是否在正确的区域

### 3. 音频格式不支持

**错误信息**：`InvalidFormat`

**解决方法**：
- 阿里云支持的格式：WAV、MP3、M4A、FLAC、OPUS
- 采样率：8000、16000、44100、48000 Hz
- 建议使用 WAV 格式，16kHz 采样率

### 4. 配额不足

**错误信息**：`QuotaExceeded`

**解决方法**：
- 检查账户余额
- 查看服务使用量
- 考虑升级套餐或充值

## 八、费用说明

阿里云智能语音交互按量计费：

- **实时语音识别**：约 0.006 元/分钟
- **录音文件识别**：约 0.004 元/分钟
- 有免费额度：每月 2 小时实时识别

详细价格请参考：[阿里云智能语音交互价格](https://www.aliyun.com/price/product#/nls/detail)

## 九、API 限制

- 单次请求音频时长：最长 60 分钟
- 文件大小：最大 100MB
- 并发请求：根据套餐不同，有不同限制
- 请求频率：建议不超过 10 QPS

## 十、技术支持

- 官方文档：https://help.aliyun.com/product/30413.html
- API 参考：https://help.aliyun.com/document_detail/84428.html
- 技术支持：在控制台提交工单

## 十一、代码实现说明

当前实现使用阿里云 REST API，主要步骤：

1. **获取 Token**：通过服务端 API `/api/aliyun/token` 获取访问令牌
   - Token 在服务端生成，避免暴露 AccessKey Secret
   - Token 有效期为 24 小时
   
2. **音频处理**：将音频文件转换为 Base64 编码

3. **调用识别接口**：使用 Token 调用阿里云语音识别 API

4. **解析返回结果**：提取识别文本

### API 端点

- **Token 生成**：`GET /api/aliyun/token`
- **语音识别**：直接调用阿里云 API（通过服务端代理或直接调用）

### 支持的音频格式

- WAV（推荐）
- MP3
- M4A
- FLAC
- OPUS
- WebM

### 采样率要求

- 8000 Hz
- 16000 Hz（推荐）
- 44100 Hz
- 48000 Hz
