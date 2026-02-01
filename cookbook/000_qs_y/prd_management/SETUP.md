# 设置指南

## 1. 环境变量配置

在项目根目录创建 `.env.local` 文件，内容如下：

```env
# Supabase 配置
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# AI 模型配置
# DeepSeek 配置（用于总结和 PRD 生成）
DEEPSEEK_API_KEY=sk-e14b5273bae6475385e5ef9ab3adc7fe

# OpenAI 配置（必须配置，用于语音转写）
OPENAI_API_KEY=sk-your_openai_api_key
```

### 获取 Supabase 配置

1. 访问 [Supabase](https://supabase.com) 并登录
2. 创建新项目或选择现有项目
3. 进入项目设置 (Settings) > API
4. 复制 `Project URL` 作为 `NEXT_PUBLIC_SUPABASE_URL`
5. 复制 `anon public` key 作为 `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 获取 API Keys

**DeepSeek API Key（用于总结和 PRD 生成）：**
- 已配置：`sk-e14b5273bae6475385e5ef9ab3adc7fe`
- 或访问 [DeepSeek Platform](https://platform.deepseek.com/) 获取新的 API Key

**OpenAI API Key（用于语音转写，必须配置）：**
1. 访问 [OpenAI Platform](https://platform.openai.com/)
2. 登录并进入 API Keys 页面
3. 创建新的 API Key
4. 复制 API Key 作为 `OPENAI_API_KEY`

**注意**：DeepSeek 不支持语音转写，必须配置 OpenAI API Key 用于 Whisper API。

## 2. 数据库设置

### 在 Supabase 中执行 SQL

1. 登录 Supabase 项目
2. 进入 SQL Editor
3. 打开 `supabase/schema.sql` 文件
4. 复制所有 SQL 语句
5. 在 SQL Editor 中粘贴并执行

### 创建 Storage Bucket（如果 SQL 未自动创建）

1. 进入 Storage 页面
2. 点击 "New bucket"
3. 名称填写：`audio-files`
4. 设置为 Public bucket
5. 创建 bucket

## 3. 安装依赖

```bash
npm install
```

## 4. 运行开发服务器

```bash
npm run dev
```

访问 [http://localhost:3001](http://localhost:3001)

## 5. 测试功能

1. **测试录音功能**：
   - 点击"新建项目"
   - 输入项目标题
   - 点击"开始录音"
   - 允许浏览器访问麦克风
   - 说话测试实时转写

2. **测试文件上传**：
   - 准备一个 MP3/WAV/M4A 文件
   - 点击"上传音频"
   - 选择文件并等待转写完成

3. **测试 PRD 生成**：
   - 完成转写后，点击"生成 PRD 文档"
   - 等待 AI 生成 PRD
   - 在详情页查看和编辑 PRD

## 常见问题

### 1. 录音功能无法使用

- 检查浏览器是否允许麦克风权限
- 确保使用 HTTPS 或 localhost（某些浏览器要求）
- 检查浏览器控制台是否有错误信息

### 2. AI API 错误

**DeepSeek API 错误：**
- 检查 `DEEPSEEK_API_KEY` 是否正确
- 确认账户有足够的配额
- 检查网络连接

**OpenAI API 错误（语音转写）：**
- 检查 `OPENAI_API_KEY` 是否正确配置
- 确认账户有足够的配额
- 检查网络连接
- 注意：即使使用 DeepSeek 作为主模型，也必须配置 OpenAI API Key 用于语音转写

### 3. Supabase 连接错误

- 检查环境变量是否正确配置
- 确认 Supabase 项目状态正常
- 检查数据库表是否已创建

### 4. 文件上传失败

- 检查文件大小（建议 < 25MB）
- 确认文件格式支持（MP3/WAV/M4A）
- 检查 Supabase Storage bucket 是否已创建

## 生产环境部署

### Vercel 部署

1. 将代码推送到 GitHub
2. 在 Vercel 中导入项目
3. 配置环境变量
4. 部署

### 环境变量配置

在 Vercel 项目设置中添加以下环境变量：
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
