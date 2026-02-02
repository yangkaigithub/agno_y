'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type PrdRecord = {
  id: number;
  session_id: string;
  file_path: string;
  title?: string | null;
  summary?: string | null;
  created_at: number;
  updated_at: number;
  version: number;
  status: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1';
const LIST_API_URL = `${API_BASE}/api/prd/list`;
const DOWNLOAD_BASE_URL = `${API_BASE}/api/prd/download`;

const STORAGE_TASK_ID = 'doc-summary-task-id';
const STORAGE_SESSION_ID = 'doc-summary-session-id';
const STORAGE_FILENAME = 'doc-summary-filename';

function formatTimestamp(timestamp: number) {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp * 1000));
}

export default function PrdList() {
  const [items, setItems] = useState<PrdRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const panelClass =
    'card-surface rounded-3xl border border-white/60 shadow-[0_18px_60px_-45px_rgba(15,23,42,0.5)]';

  async function loadItems() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(LIST_API_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as PrdRecord[];
      setItems(Array.isArray(data) ? data : []);
      setLastUpdated(Date.now());
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems();
  }, []);

  const badges = useMemo(
    () => (
      <>
        <Badge variant="secondary">{items.length}</Badge>
        <Badge variant="outline" className="uppercase text-[10px] tracking-wider">
          list
        </Badge>
      </>
    ),
    [items.length]
  );

  const sidePanel = (
    <Card className={cn(panelClass, 'ui-reveal')}>
      <CardHeader className="pb-2">
        <CardTitle className="font-display text-lg text-slate-900 dark:text-slate-50">概览</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-[0.3em] text-slate-400">PRD</span>
          <span className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{items.length}</span>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          更新 {lastUpdated ? new Date(lastUpdated).toLocaleTimeString('zh-CN') : '-'}
        </div>
        <Button variant="outline" size="sm" className="w-full gap-2 rounded-2xl" onClick={loadItems}>
          <RefreshCw className="h-4 w-4" />
          刷新
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <AppShell title="PRD 列表" description="全部 PRD" active="list" badges={badges} side={sidePanel}>
      <Card className={cn(panelClass, 'ui-reveal ui-reveal-delay-1')}>
        <CardHeader>
          <CardTitle className="font-display text-lg">最近</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中...
            </div>
          )}
          {!loading && error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-200">
              {error}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="text-sm text-slate-500">暂无</div>
          )}
          {!loading && !error && items.length > 0 && (
            <div className="space-y-4">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'card-surface rounded-2xl p-4 text-slate-700 dark:text-slate-200'
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {item.title || `PRD-${item.session_id}`}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono">{item.session_id.slice(0, 8)}</span>
                        <span>v{item.version}</span>
                        <span>{item.status}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 rounded-2xl"
                        onClick={() => {
                          window.localStorage.setItem(STORAGE_SESSION_ID, item.session_id);
                          window.localStorage.removeItem(STORAGE_TASK_ID);
                          window.localStorage.removeItem(STORAGE_FILENAME);
                          window.location.href = '/';
                        }}
                      >
                        <ExternalLink className="h-4 w-4" />
                        打开
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 rounded-2xl"
                        onClick={() => window.open(`${DOWNLOAD_BASE_URL}/${item.id}`, '_blank')}
                      >
                        <Download className="h-4 w-4" />
                        下载
                      </Button>
                    </div>
                  </div>
                  {item.summary && (
                    <div className="mt-3 rounded-2xl border border-slate-200/70 bg-white/60 p-3 text-xs text-slate-700 dark:border-slate-800/70 dark:bg-slate-950/40 dark:text-slate-200 line-clamp-3">
                      {item.summary}
                    </div>
                  )}
                  <div className="mt-3 grid gap-2 text-xs text-slate-500 dark:text-slate-400 md:grid-cols-2">
                    <div>创建：{formatTimestamp(item.created_at)}</div>
                    <div>更新：{formatTimestamp(item.updated_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
