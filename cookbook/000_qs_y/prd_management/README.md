# AI PRD 生成器

一个集成语音识别、实时转写和 AI 分析的工具，将会议录音或即时灵感转化为标准化的产品需求文档 (PRD)。

## ✨ 功能特性

| 功能 | 说明 |
|-----|------|
| 🎤 **实时语音识别** | WebSocket 直连阿里云，支持上下文纠错，边录边识别 |
| 📝 **阶段性总结** | 每 2 分钟增量提取关键内容，避免处理超长文本 |
| 📤 **录音文件识别** | 支持 MP3/WAV/M4A，上传到 OSS 后异步识别，支持说话人分离 |
| 🤖 **AI 需求提炼** | 自动识别痛点、原始诉求和业务场景 |
| 📋 **用户故事生成** | 自动生成 As a... I want to... So that... 格式 |
| 📄 **PRD 自动生成** | 基于阶段性总结生成完整 PRD（非全量文本，更高效） |
| ✏️ **Markdown 编辑** | 支持实时编辑和预览 PRD 内容 |
| 📥 **导出功能** | 支持导出为 PDF 或 Markdown 文件 |

## 🏗️ 技术栈

- **前端**：Next.js 16 (App Router) + TypeScript + Tailwind CSS + Shadcn/UI
- **后端**：Next.js API Routes
- **数据库**：MySQL 8.0+
- **语音识别**：阿里云智能语音交互
  - 实时识别（WebSocket 流式）
  - 录音文件识别（OSS + 异步识别，支持说话人分离）
- **大模型**：DeepSeek Chat / OpenAI GPT-4o
- **存储**：阿里云 OSS / 本地文件系统

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env.local`：

```bash
cp .env.example .env.local
```

编辑 `.env.local`，填写以下配置：

```env
# ============ MySQL 数据库配置 ============
DB_HOST=rm-8vb5896a152wj06x5bo.mysql.zhangbei.rds.aliyuncs.com
DB_PORT=13306
DB_NAME=prd_builder
DB_USER=root
DB_PASSWORD=your_password

# ============ 大模型配置 ============
# DeepSeek（推荐，性价比高）
DEEPSEEK_API_KEY=your_deepseek_api_key

# 或 OpenAI（如果使用 OpenAI）
# OPENAI_API_KEY=your_openai_api_key

# ============ 阿里云语音识别配置 ============
ALIYUN_ACCESS_KEY_ID=your_access_key_id
ALIYUN_ACCESS_KEY_SECRET=your_access_key_secret
ALIYUN_ASR_APP_KEY=your_app_key
ALIYUN_ASR_REGION=cn-shanghai

# ============ 阿里云 OSS 配置（用于录音文件识别）============
ALIYUN_OSS_REGION=oss-cn-hangzhou
ALIYUN_OSS_BUCKET=your_bucket_name
NEXT_PUBLIC_USE_ALIYUN_FILE_TRANSCRIPTION=true

# ============ 其他配置 ============
NEXT_PUBLIC_BASE_URL=http://localhost:3001
```

### 3. 初始化数据库

```bash
# 使用 Docker 启动 MySQL（可选）
docker run --name prd-builder-db \
  -e MYSQL_ROOT_PASSWORD=yourpassword \
  -e MYSQL_DATABASE=prd_builder \
  -p 3306:3306 -d mysql:8.0

# 执行数据库 Schema
mysql -h localhost -u root -p prd_builder < supabase/schema-mysql.sql
```

**阿里云 RDS MySQL 连接示例**：
```bash
mysql -h rm-8vb5896a152wj06x5bo.mysql.zhangbei.rds.aliyuncs.com -P 13306 -u root -p prd_builder < supabase/schema-mysql.sql
```

### 4. 启动开发服务器

```bash
npm run dev
```

访问 [http://localhost:3001](http://localhost:3001)

## 📁 项目结构

```
prd-builder/
├── app/
│   ├── api/                    # API 路由
│   │   ├── aliyun/             # 阿里云相关 API
│   │   │   ├── token/          # Token 生成
│   │   │   ├── upload/         # OSS 上传
│   │   │   └── file-transcribe/# 录音文件识别
│   │   ├── realtime-transcribe/# 实时转写 API
│   │   ├── summarize/          # 阶段性总结 API
│   │   ├── generate-prd/       # PRD 生成 API
│   │   └── projects/           # 项目 CRUD
│   ├── record/                 # 录音页面
│   ├── prd/[id]/               # PRD 详情页
│   └── page.tsx                # Dashboard
├── components/
│   ├── RecordingPanel.tsx      # 录音组件（WebSocket 直连）
│   ├── SummarySidebar.tsx      # 阶段性总结侧边栏
│   └── PRDEditor.tsx           # PRD 编辑器
├── lib/
│   ├── aliyun-token.ts         # 阿里云 Token 生成
│   ├── aliyun-oss.ts           # OSS 操作
│   ├── aliyun-file-transcription.ts  # 录音文件识别
│   ├── openai.ts               # 大模型 API
│   └── db.ts                   # 数据库操作
└── supabase/
    └── schema-postgresql.sql   # 数据库 Schema
```

## 📖 使用说明

### 实时录音识别

1. 点击首页 **"新建项目"** 按钮
2. 输入项目标题
3. 点击 **"开始录音"**
   - 系统会建立 WebSocket 连接到阿里云
   - 边录边识别，支持上下文纠错
   - 每 2 分钟自动生成阶段性总结
4. 点击 **"停止录音"** 结束

### 上传录音文件

1. 点击 **"上传音频"** 按钮
2. 选择 MP3/WAV/M4A 文件
3. 文件会上传到阿里云 OSS
4. 系统自动调用录音文件识别 API
5. 支持 **说话人分离** 和 **时间戳**

### 生成 PRD

1. 完成录音或上传后，点击 **"生成 PRD 文档"**
2. 系统使用 **阶段性总结**（而非全量文本）生成 PRD
3. 自动跳转到 PRD 详情页进行编辑和导出

## 🔧 核心设计

### 增量总结策略

```
会议时长：1 小时
         │
         ▼
┌─────────────────────────────────────────┐
│  每 2 分钟提取增量内容 → 生成阶段性总结    │
│  共产生 30 个阶段性总结                   │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  30 个阶段性总结 → 大模型整合 → 最终 PRD  │
│  （避免处理全量转写文本，节省 Token）      │
└─────────────────────────────────────────┘
```

### WebSocket 流式识别

```
录音开始 → 建立 WebSocket 连接 → 边录边发送音频
                ↓
        持续接收识别结果（支持纠错）
                ↓
录音结束 → 发送停止指令 → 关闭连接
```

## 🧪 Mock 模式

用于测试完整流程，无需配置真实 API：

```env
USE_MOCK=true
NEXT_PUBLIC_USE_MOCK=true
```

启用后：
- ✅ 语音转文本：返回模拟转写文本
- ✅ 阶段性总结：返回模拟总结内容
- ✅ PRD 生成：返回模拟 PRD 内容

## ⚠️ 注意事项

1. **浏览器权限**：首次使用需允许麦克风访问
2. **HTTPS 要求**：录音功能需要 HTTPS 或 localhost
3. **API 配额**：注意阿里云和大模型的调用限制
4. **文件大小**：上传音频建议不超过 100MB
5. **说话人分离**：仅录音文件识别支持，实时识别暂不支持

## 📚 相关文档

- [ALIYUN_ASR_SETUP.md](./ALIYUN_ASR_SETUP.md) - 阿里云实时语音识别配置
- [ALIYUN_OSS_SETUP.md](./ALIYUN_OSS_SETUP.md) - 阿里云 OSS + 录音文件识别配置
- [TRANSCRIBE_PROVIDERS.md](./TRANSCRIBE_PROVIDERS.md) - 语音转文字服务提供商配置

## 📄 许可证

MIT
