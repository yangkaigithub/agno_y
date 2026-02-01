# 从 Supabase 迁移到 PostgreSQL 说明

本文档说明如何将项目从 Supabase 迁移到直接使用 PostgreSQL。

## 已完成的更改

### 1. 数据库连接
- ✅ 创建了 `lib/db.ts`，使用 `pg` 库直接连接 PostgreSQL
- ✅ 支持通过 `DATABASE_URL` 或单独的环境变量配置数据库连接
- ✅ 自动处理 JDBC 格式的连接字符串

### 2. API 路由更新
- ✅ 更新了 `/api/projects` 路由使用新的数据库函数
- ✅ 更新了 `/api/projects/[id]` 路由使用新的数据库函数
- ✅ 创建了 `/api/upload` 路由用于文件上传（使用本地文件系统）
- ✅ 创建了 `/api/mini-summaries` 路由用于阶段性总结的 CRUD 操作

### 3. 文件存储
- ✅ 文件上传改为使用本地文件系统（存储在 `public/uploads/audio`）
- ✅ 文件通过 `/uploads/audio/...` URL 访问

### 4. 依赖更新
- ✅ 添加了 `pg` 和 `@types/pg` 到 `package.json`
- ✅ 保留了 `@supabase/supabase-js`（可选，用于向后兼容）

## 环境变量配置

在 `.env.local` 文件中配置：

```env
# PostgreSQL 数据库配置
DATABASE_URL=postgresql://postgres:Zzh!@7465671@172.16.5.66:5432/boulderai-adp?currentSchema=public

# 或者使用单独的环境变量
# DB_HOST=172.16.5.66
# DB_PORT=5432
# DB_NAME=boulderai-adp
# DB_USER=postgres
# DB_PASSWORD=Zzh!@7465671
# DB_SCHEMA=public

# AI 模型配置
# DeepSeek 配置（用于总结和 PRD 生成，推荐）
DEEPSEEK_API_KEY=sk-e14b5273bae6475385e5ef9ab3adc7fe

# OpenAI 配置（必须配置，用于语音转写，DeepSeek 不支持 Whisper API）
OPENAI_API_KEY=your_openai_api_key

# 文件上传配置（可选）
# UPLOAD_DIR=./public/uploads/audio
# NEXT_PUBLIC_BASE_URL=http://localhost:3001
```

## 数据库 Schema

使用 `supabase/schema-postgresql.sql` 初始化数据库：

```bash
psql -h 172.16.5.66 -U postgres -d boulderai-adp -f supabase/schema-postgresql.sql
```

## 安装依赖

```bash
npm install
```

这将安装 `pg` 和 `@types/pg`。

## 文件上传目录

确保 `public/uploads/audio` 目录存在（应用会自动创建，但建议手动创建）：

```bash
mkdir -p public/uploads/audio
```

## 注意事项

1. **文件存储**：文件现在存储在本地文件系统，而不是 Supabase Storage。确保：
   - `public/uploads/audio` 目录有写入权限
   - 在生产环境中考虑使用对象存储服务（如 S3、OSS）

2. **数据库连接**：确保数据库服务器可访问，并且连接信息正确。

3. **Schema**：如果使用 `currentSchema=public` 参数，确保数据库中存在该 schema。

4. **向后兼容**：`lib/supabase.ts` 文件已更新为重新导出数据库函数，但不再使用 Supabase 客户端。

## 测试

1. 启动开发服务器：
   ```bash
   npm run dev
   ```

2. 测试数据库连接：
   - 访问首页，应该能正常加载项目列表
   - 创建新项目，应该能成功保存到数据库

3. 测试文件上传：
   - 上传音频文件，应该能成功保存到 `public/uploads/audio`

## 回滚到 Supabase

如果需要回滚到 Supabase：
1. 恢复 `lib/supabase.ts` 的原始内容
2. 更新 API 路由使用 Supabase 客户端
3. 移除 `lib/db.ts`
4. 更新环境变量为 Supabase 配置
