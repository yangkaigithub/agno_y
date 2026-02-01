'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Loader2, RefreshCw } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type PrdRecord = {
  id: number;
  session_id: string;
  title?: string | null;
  summary?: string | null;
  created_at: number;
  updated_at: number;
  version: number;
  status: string;
};

const API_BASE = 'http://127.0.0.1';
const LIST_API_URL = `${API_BASE}/api/prd/list`;
const DOWNLOAD_BASE_URL = `${API_BASE}/api/prd/download`;

function formatTimestamp(timestamp: number) {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

export default function RequirementList() {
  const [items, setItems] = useState<PrdRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  async function loadItems() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(LIST_API_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        setItems(data);
      } else {
        setItems([]);
      }
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
        <Badge variant="secondary">共 {items.length} 份 PRD</Badge>
        <Badge variant="outline">来源：prd_management</Badge>
      </>
    ),
    [items.length]
  );

  const sidePanel = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          列表概览
        </CardTitle>
        <CardDescription>查看已保存的 PRD 文档，支持下载。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
        <div className="rounded-lg border border-slate-200/70 bg-slate-50/80 p-3 dark:border-slate-800/70 dark:bg-slate-950/70">
          {items.length === 0
            ? '当前暂无文档。'
            : `已存 ${items.length} 份需求文档。`}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">接口：{LIST_API_URL}</div>
        <Button variant="outline" size="sm" className="w-full gap-2" onClick={loadItems}>
          <RefreshCw className="h-4 w-4" />
          刷新列表
        </Button>
      </CardContent>
    </Card>
  );

  const footer = (
    <>
      <div>
        更新时间：{lastUpdated ? new Date(lastUpdated).toLocaleTimeString('zh-CN') : '-'}
      </div>
      <Button variant="outline" size="sm" className="w-full gap-2" onClick={loadItems}>
        <RefreshCw className="h-4 w-4" />
        重新加载
      </Button>
    </>
  );

  return (
    <AppShell
      title="需求列表"
      description="来自 prd_management 的 PRD 文档记录。"
      active="list"
      badges={badges}
      side={sidePanel}
      footer={footer}
    >
      <Card className="min-h-[70vh]">
        <CardHeader className="border-b border-slate-200/70 dark:border-slate-800/70">
          <CardTitle>PRD 文档</CardTitle>
          <CardDescription>点击下载可获得 Markdown 文件。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-amber-200/70 bg-amber-50/80 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100">
              加载失败：{error}
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-200/70 p-6 text-center text-sm text-slate-500 dark:border-slate-800/70 dark:text-slate-400">
              暂无 PRD 记录。
            </div>
          )}

          {!loading && !error && items.length > 0 && (
            <div className="space-y-3">
              {items.map((item) => {
                const title = item.title || `PRD-${item.session_id.slice(0, 8)}`;
                const summary = item.summary || '暂无摘要';
                const createdAt = formatTimestamp(item.created_at);
                const updatedAt = formatTimestamp(item.updated_at);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'flex flex-col gap-3 rounded-xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/70',
                      'md:flex-row md:items-center md:justify-between'
                    )}
                  >
                    <div className="space-y-2">
                      <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        {title}
                      </div>
                      <div className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">
                        {summary}
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>创建：{createdAt}</span>
                        <span>更新：{updatedAt}</span>
                        <span>版本：v{item.version}</span>
                        <span>状态：{item.status}</span>
                      </div>
                    </div>
                    <Button asChild variant="outline" className="gap-2">
                      <a
                        href={`${DOWNLOAD_BASE_URL}/${item.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Download className="h-4 w-4" />
                        下载 PRD
                      </a>
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
