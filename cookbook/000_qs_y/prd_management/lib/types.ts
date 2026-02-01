// 鏁版嵁搴撶被鍨嬪畾涔夛紙涓?Supabase 琛ㄧ粨鏋勪竴鑷达級
export interface Project {
  id: string;
  title: string;
  created_at: string | Date;
  raw_text: string | null;        // 鍏ㄦ枃杞瘧鏂囨湰
  summary: string | null;         // AI 鍏ㄦ枃鎬荤粨
  prd_content: string | null;    // Markdown 鏍煎紡鐨?PRD
  audio_url: string | null;       // 瀛樺偍鍦?Supabase Storage 鐨勮矾寰?  user_id?: string | null;        // 鐢ㄦ埛 ID锛堝鏋滄湁澶氱敤鎴锋敮鎸侊級
}

export interface MiniSummary {
  id: string;
  project_id: string;
  timestamp: number;       // 褰曢煶鏃堕棿鐐癸紙绉掞級
  content: string;         // 10绉掑畾鏃舵€荤粨鍐呭
  created_at: string | Date;
}

// API 鍝嶅簲绫诲瀷
export interface TranscriptionResponse {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export interface PRDContent {
  background: string;
  objectives: string[];
  painPoints: string[];
  userStories: Array<{
    as: string;
    want: string;
    soThat: string;
  }>;
  features: Array<{
    name: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  flows: string;
}
