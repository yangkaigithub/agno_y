'use client';

import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, FileUp, Loader2, Mic, MicOff, Plus, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AppShell from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

function highlightClarification(nodes: React.ReactNode): React.ReactNode {
  const token = '【待澄清】';

  const pattern = /【待澄清[^】]*】/g;

  const walk = (node: React.ReactNode): React.ReactNode => {
    if (typeof node === 'string') {
      const matches = [...node.matchAll(pattern)];
      if (matches.length === 0) return node;

      const out: React.ReactNode[] = [];
      let lastIndex = 0;
      matches.forEach((match, index) => {
        const start = match.index ?? 0;
        const value = match[0] ?? '';
        if (start > lastIndex) out.push(node.slice(lastIndex, start));
        out.push(
          <span key={`clarify-${index}-${start}`} className="font-semibold text-red-600 dark:text-red-400">
            {value}
          </span>
        );
        lastIndex = start + value.length;
      });
      if (lastIndex < node.length) out.push(node.slice(lastIndex));
      return out.length === 1 ? out[0] : out;
    }

    if (Array.isArray(node)) return node.map(walk);

    if (isValidElement(node)) {
      const element = node as any;
      const children = element.props?.children;
      if (children == null) return node;
      return cloneElement(element, { ...element.props }, walk(children));
    }

    return node;
  };

  return Children.map(nodes, walk);
}

function stripHtml(text: string) {
  return (text || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function normalizePrdMarkdown(input: string) {
  if (!input) return '';

  let out = input;

  // Backward compatibility for older PRD outputs that used HTML.
  out = out.replace(/<span[^>]*color\s*:\s*red[^>]*>/gi, '').replace(/<\/span>/gi, '');

  out = out.replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
    const parsed = rows
      .map((row) => {
        const cells = [...row.matchAll(/<(t[hd])[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => stripHtml(m[2]));
        return cells;
      })
      .filter((cells) => cells.length > 0);

    if (parsed.length === 0) return stripHtml(table);

    const header = parsed[0];
    const body = parsed.slice(1);
    const sep = header.map(() => '---');
    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${sep.join(' | ')} |`,
      ...body.map((r) => `| ${r.join(' | ')} |`),
    ];
    return `\n\n${lines.join('\n')}\n\n`;
  });

  return out;
}

type DocStatus = {
  task_id: number;
  session_id: string;
  filename: string;
  status: string;
  total_chunks: number;
  next_chunk_index: number;
  completed_chunks: number;
  created_at: number;
  updated_at: number;
  error?: string | null;
};

type DocSummaryItem = {
  chunk_index: number;
  filename: string;
  created_at: number;
  content: string;
};

type PrdRecord = {
  id: number;
  session_id: string;
  title?: string | null;
  updated_at: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1';
const UPLOAD_URL = `${API_BASE}/api/docs/upload`;
const STATUS_URL = `${API_BASE}/api/docs/status`;
const SUMMARIES_URL = `${API_BASE}/api/docs/summaries`;
const PRD_URL = `${API_BASE}/api/docs/cumulative`;
const DOWNLOAD_ORIGINAL_URL = `${API_BASE}/api/docs/download/original`;
const DOWNLOAD_CUMULATIVE_URL = `${API_BASE}/api/docs/download/cumulative`;
const PRD_LIST_URL = `${API_BASE}/api/prd/list`;
const VOICE_APPEND_URL = `${API_BASE}/api/voice/append`;
const VOICE_REFINE_URL = `${API_BASE}/api/voice/refine`;

const STORAGE_TASK_ID = 'doc-summary-task-id';
const STORAGE_SESSION_ID = 'doc-summary-session-id';
const STORAGE_FILENAME = 'doc-summary-filename';

function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replaceAll('-', '');
  }
  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function formatDateTime(tsSeconds: number) {
  if (!tsSeconds) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(tsSeconds * 1000));
}

export default function DocWorkspace() {
  const [taskId, setTaskId] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [status, setStatus] = useState<DocStatus | null>(null);
  const [summaries, setSummaries] = useState<DocSummaryItem[]>([]);
  const [prd, setPrd] = useState('');
  const prdMarkdown = useMemo(() => normalizePrdMarkdown(prd), [prd]);
  const [sessions, setSessions] = useState<PrdRecord[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const [isMicOn, setIsMicOn] = useState(false);
  const [voiceRaw, setVoiceRaw] = useState('');
  const [voiceRefined, setVoiceRefined] = useState('');
  const [voiceHistory, setVoiceHistory] = useState('');
  const flushTimerRef = useRef<number | null>(null);
  const refineTimerRef = useRef<number | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  useEffect(() => {
    const storedTaskId = window.localStorage.getItem(STORAGE_TASK_ID);
    const storedSessionId = window.localStorage.getItem(STORAGE_SESSION_ID);
    const storedFilename = window.localStorage.getItem(STORAGE_FILENAME);
    if (storedTaskId) setTaskId(Number(storedTaskId));
    if (storedSessionId) setSessionId(storedSessionId);
    if (storedFilename) setFilename(storedFilename);
  }, []);

  useEffect(() => {
    if (taskId != null) window.localStorage.setItem(STORAGE_TASK_ID, String(taskId));
  }, [taskId]);

  useEffect(() => {
    if (sessionId) window.localStorage.setItem(STORAGE_SESSION_ID, sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (filename) window.localStorage.setItem(STORAGE_FILENAME, filename);
  }, [filename]);

  useEffect(() => {
    if (!sessionId) {
      setStatus(null);
      setSummaries([]);
      setPrd('');
      return;
    }

    let active = true;

    const fetchAll = async () => {
      try {
        let resolvedTaskId = taskId;
        if (!resolvedTaskId) {
          const statusRes = await fetch(`${STATUS_URL}?session_id=${encodeURIComponent(sessionId)}`);
          if (statusRes.ok) {
            const statusData = (await statusRes.json()) as DocStatus;
            resolvedTaskId = statusData.task_id;
            if (active) {
              setTaskId(statusData.task_id);
              setFilename(statusData.filename);
            }
          } else {
            // Session exists but no tasks yet.
            if (active) {
              setStatus(null);
              setSummaries([]);
              setPrd('');
            }
            return;
          }
        }

        const [statusRes, summariesRes, cumulativeRes] = await Promise.all([
          fetch(`${STATUS_URL}?task_id=${encodeURIComponent(String(resolvedTaskId))}`),
          fetch(`${SUMMARIES_URL}?session_id=${encodeURIComponent(sessionId)}`),
          fetch(`${PRD_URL}?session_id=${encodeURIComponent(sessionId)}`),
        ]);

        if (!statusRes.ok) throw new Error(`status HTTP ${statusRes.status}`);
        if (!summariesRes.ok) throw new Error(`summaries HTTP ${summariesRes.status}`);
        if (!cumulativeRes.ok) throw new Error(`cumulative HTTP ${cumulativeRes.status}`);

        const statusData = (await statusRes.json()) as DocStatus;
        const summariesData = (await summariesRes.json()) as { session_id: string; items: DocSummaryItem[] };
        const prdData = (await cumulativeRes.json()) as { session_id: string; content: string };

        if (!active) return;
        setStatus(statusData);
        setSummaries(Array.isArray(summariesData.items) ? summariesData.items : []);
        setPrd(typeof prdData.content === 'string' ? prdData.content : '');
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : '加载失败';
        setError(message);
      }
    };

    void fetchAll();
    const timer = window.setInterval(fetchAll, 2000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [taskId, sessionId]);

  useEffect(() => {
    let active = true;
    const fetchSessions = async () => {
      try {
        const res = await fetch(PRD_LIST_URL);
        if (!res.ok) return;
        const data = (await res.json()) as PrdRecord[];
        if (!active) return;
        if (!Array.isArray(data)) return;
        // Keep latest record per session_id
        const map = new Map<string, PrdRecord>();
        data.forEach((item) => {
          const current = map.get(item.session_id);
          if (!current || (item.updated_at ?? 0) > (current.updated_at ?? 0)) {
            map.set(item.session_id, item);
          }
        });
        const list = Array.from(map.values()).sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
        setSessions(list);
      } catch {
        // ignore
      }
    };
    void fetchSessions();
    return () => {
      active = false;
    };
  }, [sessionId]);

  const speechSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }, []);

  const badges = useMemo(() => {
    const total = status?.total_chunks ?? 0;
    const done = status?.completed_chunks ?? 0;
    const state = status?.status ?? 'idle';
    return (
      <>
        <Badge variant="secondary">分段：{done}/{total}</Badge>
        <Badge variant="outline">状态：{state}</Badge>
      </>
    );
  }, [status?.completed_chunks, status?.status, status?.total_chunks]);

  async function uploadFile(file: File) {
    setIsUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('chunk_size', '2000');
      if (sessionId) form.append('session_id', sessionId);

      const response = await fetch(UPLOAD_URL, {
        method: 'POST',
        body: form,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        task_id: number;
        session_id: string;
        filename: string;
        total_chunks: number;
        chunk_size: number;
      };
      setTaskId(data.task_id);
      setSessionId(data.session_id);
      setFilename(data.filename);
    } finally {
      setIsUploading(false);
    }
  }

  function newSession() {
    const id = createSessionId();
    window.localStorage.setItem(STORAGE_SESSION_ID, id);
    window.localStorage.removeItem(STORAGE_TASK_ID);
    window.localStorage.removeItem(STORAGE_FILENAME);
    setTaskId(null);
    setFilename(null);
    setSessionId(id);
    setStatus(null);
    setSummaries([]);
    setPrd('');
    setError(null);
    setVoiceRaw('');
    setVoiceRefined('');
    setVoiceHistory('');
    setVoiceError(null);
  }

  async function selectSession(nextSessionId: string) {
    const clean = (nextSessionId || '').trim();
    if (!clean) return;
    window.localStorage.setItem(STORAGE_SESSION_ID, clean);
    window.localStorage.removeItem(STORAGE_TASK_ID);
    window.localStorage.removeItem(STORAGE_FILENAME);
    setSessionId(clean);
    setTaskId(null);
    setFilename(null);
    setStatus(null);
    setSummaries([]);
    setPrd('');
    setError(null);
  }

  function reset() {
    window.localStorage.removeItem(STORAGE_TASK_ID);
    window.localStorage.removeItem(STORAGE_SESSION_ID);
    window.localStorage.removeItem(STORAGE_FILENAME);
    setTaskId(null);
    setSessionId(null);
    setFilename(null);
    setStatus(null);
    setSummaries([]);
    setPrd('');
    setError(null);
    setVoiceRaw('');
    setVoiceRefined('');
    setVoiceHistory('');
    setVoiceError(null);
  }

  async function flushVoiceWindow() {
    if (!sessionId) return;
    const textToSend = (voiceRefined || voiceRaw).trim();
    if (!textToSend) return;
    try {
      const form = new FormData();
      form.append('session_id', sessionId);
      form.append('text', textToSend);
      form.append('chunk_size', '500');
      const res = await fetch(VOICE_APPEND_URL, { method: 'POST', body: form });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      setVoiceHistory((prev) => (prev ? `${prev}\n${textToSend}` : textToSend));
      setVoiceRaw('');
      setVoiceRefined('');
    } catch (e) {
      const message = e instanceof Error ? e.message : '语音上传失败';
      setVoiceError(message);
    }
  }

  async function refineVoiceNow(rawText: string) {
    if (!sessionId) return;
    const clean = (rawText || '').trim();
    if (!clean) {
      setVoiceRefined('');
      return;
    }
    try {
      const form = new FormData();
      form.append('session_id', sessionId);
      form.append('context', voiceHistory.slice(-2000));
      form.append('text', clean);
      const res = await fetch(VOICE_REFINE_URL, { method: 'POST', body: form });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { refined_text?: string };
      setVoiceRefined((data.refined_text ?? '').toString());
    } catch (e) {
      const message = e instanceof Error ? e.message : '语音修正失败';
      setVoiceError(message);
    }
  }

  function startMic() {
    if (!speechSupported) {
      setVoiceError('当前浏览器不支持语音识别（SpeechRecognition）');
      return;
    }
    if (!sessionId) {
      setVoiceError('请先选择或新建 session');
      return;
    }
    setVoiceError(null);
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'zh-CN';

    rec.onresult = (event: any) => {
      let appended = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript ?? '';
        if (result.isFinal && transcript) {
          appended += transcript.trim() + '\n';
        }
      }
      if (appended) {
        setVoiceRaw((prev) => prev + appended);
      }
    };

    rec.onerror = (event: any) => {
      setVoiceError(event?.error ? String(event.error) : '语音识别错误');
      setIsMicOn(false);
    };

    rec.onend = () => {
      // Some browsers stop automatically; restart unless the user stopped it.
      if (recognitionRef.current === rec && flushTimerRef.current) {
        try {
          rec.start();
        } catch {
          // ignore
        }
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setIsMicOn(true);
      if (flushTimerRef.current) window.clearInterval(flushTimerRef.current);
      flushTimerRef.current = window.setInterval(() => void flushVoiceWindow(), 120000);
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : '无法启动麦克风');
    }
  }

  async function stopMic() {
    setIsMicOn(false);
    if (flushTimerRef.current) {
      window.clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    try {
      recognitionRef.current?.stop?.();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
    await flushVoiceWindow();
  }

  useEffect(() => {
    if (!sessionId) return;
    if (!voiceRaw.trim()) {
      if (refineTimerRef.current) window.clearTimeout(refineTimerRef.current);
      refineTimerRef.current = null;
      setVoiceRefined('');
      return;
    }
    if (refineTimerRef.current) window.clearTimeout(refineTimerRef.current);
    refineTimerRef.current = window.setTimeout(() => void refineVoiceNow(voiceRaw), 1200);
  }, [voiceRaw, sessionId, voiceHistory]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) window.clearInterval(flushTimerRef.current);
      if (refineTimerRef.current) window.clearTimeout(refineTimerRef.current);
      try {
        recognitionRef.current?.stop?.();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sidePanel = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">文档上传</CardTitle>
        <CardDescription>上传后立即启动分段总结（文件 chunk_size=2000；语音 chunk_size=500）</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label>选择 session</Label>
          <select
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50"
            value={sessionId ?? ''}
            onChange={(event) => void selectSession(event.target.value)}
          >
            <option value="" disabled>
              请选择或点击“新建session”
            </option>
            {sessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {(s.title || `PRD-${s.session_id}`).slice(0, 40)} · {s.session_id.slice(0, 8)}
              </option>
            ))}
          </select>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            当前 session：{sessionId ?? '-'}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.markdown,.pdf,.docx"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
            event.target.value = '';
          }}
        />
        <Button
          className="w-full gap-2"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          选择文件并上传
        </Button>

        <div className="rounded-lg border border-slate-200/70 bg-slate-50/80 p-3 text-sm text-slate-600 dark:border-slate-800/70 dark:bg-slate-950/70 dark:text-slate-300">
          <div className="font-medium text-slate-800 dark:text-slate-100">当前任务</div>
          <div className="mt-2 space-y-1 text-xs">
            <div>task_id：{taskId ?? '-'}</div>
            <div>session_id：{sessionId ?? '-'}</div>
            <div>文件：{filename ?? '-'}</div>
            <div>更新时间：{status?.updated_at ? formatDateTime(status.updated_at) : '-'}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            onClick={() => {
              if (!sessionId || !filename) return;
              window.open(
                `${DOWNLOAD_ORIGINAL_URL}?session_id=${encodeURIComponent(sessionId)}&filename=${encodeURIComponent(
                  filename
                )}`,
                '_blank'
              );
            }}
            disabled={!sessionId || !filename}
          >
            <FileDown className="h-4 w-4" />
            原文
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-2"
            onClick={() => {
              if (!sessionId) return;
              window.open(`${DOWNLOAD_CUMULATIVE_URL}?session_id=${encodeURIComponent(sessionId)}`, '_blank');
            }}
            disabled={!sessionId}
          >
            <FileDown className="h-4 w-4" />
            累计总结
          </Button>
        </div>

        <Button variant="outline" size="sm" className="w-full gap-2" onClick={reset}>
          <RotateCcw className="h-4 w-4" />
          重置
        </Button>

        <Button variant="outline" size="sm" className="w-full gap-2" onClick={newSession}>
          <Plus className="h-4 w-4" />
          新建session
        </Button>

        <div className="rounded-xl border border-slate-200/70 bg-white/70 p-3 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">语音输入</div>
            {isMicOn ? (
              <Button size="sm" variant="outline" className="gap-2" onClick={() => void stopMic()}>
                <MicOff className="h-4 w-4" />
                停止
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="gap-2" onClick={startMic} disabled={!speechSupported}>
                <Mic className="h-4 w-4" />
                开始
              </Button>
            )}
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            每 2 分钟自动把新增语音文本发送到后端并按 500 字符分块总结。
          </div>
          <div className="mt-3">
            <Textarea
              value={(voiceHistory ? `${voiceHistory}\n\n` : '') + (voiceRefined || voiceRaw)}
              readOnly
              placeholder="语音转文字（已自动修正）会显示在这里。"
              className="min-h-[140px] resize-none"
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => void flushVoiceWindow()} disabled={!sessionId}>
              立即同步
            </Button>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              未同步字符：{(voiceRefined || voiceRaw).length}
            </div>
          </div>
          {voiceError && (
            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-200">
              {voiceError}
            </div>
          )}
        </div>

        {error && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200">
            {error}
          </p>
        )}

        {status?.error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-200">
            {status.error}
          </p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <AppShell
      title="文档分段总结"
      description="上传文档后，后台会将文档拆分为多段，并逐段生成总结，持续追加到列表中。"
      active="docs"
      badges={badges}
      side={sidePanel}
    >
      <div className="grid min-h-0 grid-cols-1 gap-4">
        <Card className="flex min-h-[320px] max-h-[520px] flex-col overflow-hidden">
          <CardHeader className="border-b border-slate-200/70 dark:border-slate-800/70">
            <CardTitle>PRD（累计）</CardTitle>
            <CardDescription>每完成一段会更新一次 PRD</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 overflow-y-auto">
            {prd ? (
              <div className={cn('prose max-w-none text-sm dark:text-slate-100')}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => <p>{highlightClarification(children)}</p>,
                    li: ({ children }) => <li>{highlightClarification(children)}</li>,
                  }}
                >
                  {prdMarkdown}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="text-sm text-slate-500">暂无 PRD</div>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-[320px] max-h-[520px] flex-col overflow-hidden">
          <CardHeader className="border-b border-slate-200/70 dark:border-slate-800/70">
            <CardTitle className="flex items-center gap-2">
              分段总结列表
              {status?.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
            </CardTitle>
            <CardDescription>按段号顺序追加展示</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
            {summaries.length === 0 ? (
              <div className="text-sm text-slate-500">暂无分段总结</div>
            ) : (
              summaries.map((item) => (
                <div
                  key={item.filename}
                  className="w-full min-w-0 rounded-xl border border-slate-200/70 bg-white/70 p-3 text-sm text-slate-700 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60 dark:text-slate-200"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      {formatDateTime(item.created_at)}
                    </span>
                    <span className="font-mono">{item.filename}</span>
                  </div>
                  <div className="prose max-w-none text-sm dark:text-slate-100">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
