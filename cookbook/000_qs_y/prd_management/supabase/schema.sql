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

-- 启用 Row Level Security (RLS)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE mini_summaries ENABLE ROW LEVEL SECURITY;

-- 创建策略：允许所有人读取和写入（可以根据需要修改为基于用户的策略）
CREATE POLICY "Allow all operations on projects" ON projects
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on mini_summaries" ON mini_summaries
  FOR ALL USING (true) WITH CHECK (true);

-- 创建 Storage Bucket 用于存储音频文件
INSERT INTO storage.buckets (id, name, public)
VALUES ('audio-files', 'audio-files', true)
ON CONFLICT (id) DO NOTHING;

-- 设置 Storage 策略
CREATE POLICY "Allow public uploads" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'audio-files');

CREATE POLICY "Allow public access" ON storage.objects
  FOR SELECT USING (bucket_id = 'audio-files');
