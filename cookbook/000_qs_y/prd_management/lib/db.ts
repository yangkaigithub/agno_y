import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import type { Project, MiniSummary } from './types';

// 浠庣幆澧冨彉閲忚幏鍙栨暟鎹簱杩炴帴淇℃伅
function getDbConfig(): mysql.PoolOptions {
  return {
    host: process.env.DB_HOST || 'rm-8vb5896a152wj06x5bo.mysql.zhangbei.rds.aliyuncs.com',
    port: parseInt(process.env.DB_PORT || '13306'),
    database: process.env.DB_NAME || 'prd_builder',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Kxcneyt228',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  };
}

// 鍒涘缓杩炴帴姹?const pool = mysql.createPool(getDbConfig());

// 鏁版嵁搴撴搷浣滃嚱鏁?export async function createProject(project: Omit<Project, 'id' | 'created_at'>): Promise<Project | null> {
  const connection = await pool.getConnection();
  try {
    const id = uuidv4();
    await connection.execute(
      `INSERT INTO projects (id, title, raw_text, summary, prd_content, audio_url, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        project.title,
        project.raw_text || null,
        project.summary || null,
        project.prd_content || null,
        project.audio_url || null,
        project.user_id || null,
      ]
    );
    
    // 鑾峰彇鍒氬垱寤虹殑椤圭洰
    const [rows] = await connection.execute(
      'SELECT * FROM projects WHERE id = ?',
      [id]
    );
    return (rows as Project[])[0] || null;
  } catch (error) {
    console.error('鍒涘缓椤圭洰澶辫触:', error);
    return null;
  } finally {
    connection.release();
  }
}

export async function getProjects(): Promise<Project[]> {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(
      'SELECT * FROM projects ORDER BY created_at DESC'
    );
    return rows as Project[];
  } catch (error) {
    console.error('鑾峰彇椤圭洰鍒楄〃澶辫触:', error);
    return [];
  } finally {
    connection.release();
  }
}

export async function getProject(id: string): Promise<Project | null> {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(
      'SELECT * FROM projects WHERE id = ?',
      [id]
    );
    return (rows as Project[])[0] || null;
  } catch (error) {
    console.error('鑾峰彇椤圭洰澶辫触:', error);
    return null;
  } finally {
    connection.release();
  }
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<Project | null> {
  const connection = await pool.getConnection();
  try {
    const updateFields: string[] = [];
    const values: any[] = [];

    if (updates.title !== undefined) {
      updateFields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.raw_text !== undefined) {
      updateFields.push('raw_text = ?');
      values.push(updates.raw_text);
    }
    if (updates.summary !== undefined) {
      updateFields.push('summary = ?');
      values.push(updates.summary);
    }
    if (updates.prd_content !== undefined) {
      updateFields.push('prd_content = ?');
      values.push(updates.prd_content);
    }
    if (updates.audio_url !== undefined) {
      updateFields.push('audio_url = ?');
      values.push(updates.audio_url);
    }
    if (updates.user_id !== undefined) {
      updateFields.push('user_id = ?');
      values.push(updates.user_id);
    }

    if (updateFields.length === 0) {
      return await getProject(id);
    }

    values.push(id);
    await connection.execute(
      `UPDATE projects SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );
    
    return await getProject(id);
  } catch (error) {
    console.error('鏇存柊椤圭洰澶辫触:', error);
    return null;
  } finally {
    connection.release();
  }
}

export async function createMiniSummary(summary: Omit<MiniSummary, 'id' | 'created_at'>): Promise<MiniSummary | null> {
  const connection = await pool.getConnection();
  try {
    const id = uuidv4();
    await connection.execute(
      `INSERT INTO mini_summaries (id, project_id, timestamp, content)
       VALUES (?, ?, ?, ?)`,
      [id, summary.project_id, summary.timestamp, summary.content]
    );
    
    // 鑾峰彇鍒氬垱寤虹殑璁板綍
    const [rows] = await connection.execute(
      'SELECT * FROM mini_summaries WHERE id = ?',
      [id]
    );
    return (rows as MiniSummary[])[0] || null;
  } catch (error) {
    console.error('鍒涘缓闃舵鎬ф€荤粨澶辫触:', error);
    return null;
  } finally {
    connection.release();
  }
}

export async function getMiniSummaries(projectId: string): Promise<MiniSummary[]> {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(
      'SELECT * FROM mini_summaries WHERE project_id = ? ORDER BY timestamp ASC',
      [projectId]
    );
    return rows as MiniSummary[];
  } catch (error) {
    console.error('鑾峰彇闃舵鎬ф€荤粨澶辫触:', error);
    return [];
  } finally {
    connection.release();
  }
}

// 鍏抽棴杩炴帴姹狅紙鐢ㄤ簬浼橀泤鍏抽棴锛?export async function closePool() {
  await pool.end();
}
