-- 纯 PostgreSQL 版本的 Schema（不包含 Supabase 特定功能）
-- 适用于直接使用 PostgreSQL 数据库的场景

-- 创建 projects 表
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  raw_text TEXT,
  summary TEXT,
  prd_content TEXT,
  audio_url TEXT,
  user_id TEXT
);

-- 创建 mini_summaries 表
CREATE TABLE IF NOT EXISTS mini_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_mini_summaries_project_id ON mini_summaries(project_id);
CREATE INDEX IF NOT EXISTS idx_mini_summaries_timestamp ON mini_summaries(timestamp);

-- 注意：
-- 1. 此版本移除了 Supabase 的 Row Level Security (RLS) 策略
-- 2. 移除了 Supabase Storage 相关的配置
-- 3. 文件存储需要使用其他方案（本地文件系统、S3 等）
-- 4. 权限控制需要在应用层实现
