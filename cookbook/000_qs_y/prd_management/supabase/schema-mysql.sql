-- MySQL 版本的 Schema
-- 适用于 MySQL 8.0+

-- 创建数据库（如果需要）
-- CREATE DATABASE IF NOT EXISTS prd_builder DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE prd_builder;

-- 创建 projects 表
CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  title VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  raw_text LONGTEXT,
  summary TEXT,
  prd_content LONGTEXT,
  audio_url VARCHAR(1000),
  user_id VARCHAR(255),
  
  INDEX idx_projects_created_at (created_at DESC),
  INDEX idx_projects_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 创建 mini_summaries 表
CREATE TABLE IF NOT EXISTS mini_summaries (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  project_id CHAR(36) NOT NULL,
  timestamp INT NOT NULL COMMENT '录音时间戳（秒）',
  content TEXT NOT NULL COMMENT '阶段性总结内容',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_mini_summaries_project_id (project_id),
  INDEX idx_mini_summaries_timestamp (timestamp),
  
  CONSTRAINT fk_mini_summaries_project
    FOREIGN KEY (project_id) REFERENCES projects(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 注意：
-- 1. MySQL 8.0+ 支持 UUID() 作为默认值
-- 2. 使用 LONGTEXT 存储可能很长的文本（如完整转写内容、PRD 文档）
-- 3. 使用 utf8mb4 字符集支持完整的 Unicode（包括 emoji）
-- 4. 如果使用 MySQL 5.7，需要在应用层生成 UUID
