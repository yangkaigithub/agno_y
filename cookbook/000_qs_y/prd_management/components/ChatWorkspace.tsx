'use client';

import { useEffect, useRef, useState } from 'react';
import { FileUp, Loader2, RotateCcw, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AppShell from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type ChatRole = 'user' | 'assistant' | 'system';

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

interface SummaryItem {
  filename: string;
  timestamp: number;
  content: string;
}

interface PrdLatest {
  filename?: string | null;
  content?: string | null;
  record?: {
    title?: string | null;
    version?: number | null;
    updated_at?: number | null;
  } | null;
}

const API_BASE = 'http://127.0.0.1';
const CHAT_API_URL = `${API_BASE}/api/chat`;
const IMPORT_API_URL = `${API_BASE}/api/chat/import`;
const PRD_LATEST_API_URL = `${API_BASE}/api/prd/latest`;
const PRD_SUMMARIES_API_URL = `${API_BASE}/api/prd/summaries`;
const STORAGE_KEY = 'prd-chat-session-id';

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const initialMessages = (): ChatMessage[] => [
  {
    id: createId(),
    role: 'assistant',
    content:
      '你好！我是 PRD 需求聊天助手。请先描述产品背景、目标和目标用户，我会逐步追问，帮助你补全 PRD。',
    createdAt: Date.now(),
  },
];

export default function ChatWorkspace() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages());
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [prdLatest, setPrdLatest] = useState<PrdLatest | null>(null);
  const [summaries, setSummaries] = useState<SummaryItem[]>([]);
  const [isLoadingPrd, setIsLoadingPrd] = useState(false);
  const [isLoadingSummaries, setIsLoadingSummaries] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const summaryEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setSessionId(stored);
    }
  }, []);

  useEffect(() => {
    if (sessionId) {
      window.localStorage.setItem(STORAGE_KEY, sessionId);
    }
  }, [sessionId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending, isImporting]);

  useEffect(() => {
    summaryEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [summaries]);

  useEffect(() => {
    if (!sessionId) {
      setPrdLatest(null);
      setSummaries([]);
      return;
    }

    let active = true;
    const fetchLatest = async () => {
      setIsLoadingPrd(true);
      try {
        const response = await fetch(
          `${PRD_LATEST_API_URL}?session_id=${encodeURIComponent(sessionId)}`
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (active) {
          setPrdLatest(data);
        }
      } catch {
        if (active) {
          setPrdLatest(null);
        }
      } finally {
        if (active) {
          setIsLoadingPrd(false);
        }
      }
    };

    const fetchSummaries = async () => {
      setIsLoadingSummaries(true);
      try {
        const response = await fetch(
          `${PRD_SUMMARIES_API_URL}?session_id=${encodeURIComponent(sessionId)}`
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (active) {
          setSummaries(Array.isArray(data?.items) ? data.items : []);
        }
      } catch {
        if (active) {
          setSummaries([]);
        }
      } finally {
        if (active) {
          setIsLoadingSummaries(false);
        }
      }
    };

    fetchLatest();
    fetchSummaries();

    const intervalId = window.setInterval(() => {
      fetchLatest();
      fetchSummaries();
    }, 20000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [sessionId]);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsSending(true);

    try {
      const response = await fetch(CHAT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          session_id: sessionId,
        }),
      });

      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const data = await response.json();
          if (data?.detail) {
            detail = data.detail;
          }
        } catch {
          // ignore json parse errors
        }
        throw new Error(detail);
      }

      const data = await response.json();
      if (data?.session_id) {
        setSessionId(data.session_id);
      }

      const assistantMessage: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: data?.content || '没有返回内容。',
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '请求失败。';
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: 'system',
          content: `请求失败：${message}`,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  async function handleImport(file: File) {
    if (isImporting) return;

    setIsImporting(true);
    setImportError(null);

    const systemStart: ChatMessage = {
      id: createId(),
      role: 'system',
      content: `开始导入文档：${file.name}，正在分段并提交给助手...`,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, systemStart]);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (sessionId) {
        formData.append('session_id', sessionId);
      }
      formData.append('chunk_size', '1000');

      const response = await fetch(IMPORT_API_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const data = await response.json();
          if (data?.detail) {
            detail = data.detail;
          }
        } catch {
          // ignore json parse errors
        }
        throw new Error(detail);
      }

      const data = await response.json();
      if (data?.session_id) {
        setSessionId(data.session_id);
      }

      const chunks: string[] = Array.isArray(data?.chunks) ? data.chunks : [];
      const replies: string[] = Array.isArray(data?.replies) ? data.replies : [];
      const total = data?.total_chunks || chunks.length || replies.length;

      const combined: ChatMessage[] = [];
      const maxLen = Math.max(chunks.length, replies.length);

      for (let i = 0; i < maxLen; i += 1) {
        const chunk = chunks[i];
        if (chunk) {
          combined.push({
            id: createId(),
            role: 'user',
            content: `文档片段 ${i + 1}/${total}：\n${chunk}`,
            createdAt: Date.now(),
          });
        }
        const reply = replies[i];
        if (reply) {
          combined.push({
            id: createId(),
            role: 'assistant',
            content: reply,
            createdAt: Date.now(),
          });
        }
      }

      const doneMessage: ChatMessage = {
        id: createId(),
        role: 'system',
        content: `导入完成，共处理 ${total} 个片段。`,
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, ...combined, doneMessage]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败。';
      setImportError(message);
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: 'system',
          content: `导入失败：${message}`,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void handleImport(file);
    }
  }

  function handleReset() {
    setSessionId(null);
    window.localStorage.removeItem(STORAGE_KEY);
    setMessages(initialMessages());
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  const sessionLabel = sessionId ? `${sessionId.slice(0, 8)}...` : '新会话';

  const footer = (
    <>
      <div>当前会话：{sessionLabel}</div>
      <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleReset}>
        <RotateCcw className="h-4 w-4" />
        新会话
      </Button>
    </>
  );

  return (
    <AppShell
      title="聊需求"
      description="左侧对话，右侧实时展示 PRD 与 2 分钟总结列表。"
      active="chat"
      badges={
        <>
          <Badge variant="secondary">会话：{sessionLabel}</Badge>
          <Badge variant="outline">Agent：prd_chat_agent</Badge>
        </>
      }
      footer={footer}
      lockViewport
    >
      <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="border-b border-slate-200/70 dark:border-slate-800/70">
            <CardTitle>需求对话</CardTitle>
            <CardDescription>导入文档会拆成多段信息，按顺序发送。</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex-1 space-y-4 overflow-y-auto pr-2">
              {messages.map((message) => {
                const isUser = message.role === 'user';
                const isSystem = message.role === 'system';
                return (
                  <div
                    key={message.id}
                    className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm',
                        isUser &&
                          'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900',
                        !isUser &&
                          !isSystem &&
                          'border border-slate-200/70 bg-white/80 text-slate-800 dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-100',
                        isSystem &&
                          'border border-amber-200/80 bg-amber-50/80 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/50 dark:text-amber-100'
                      )}
                    >
                      {message.role === 'assistant' ? (
                        <div className="prose max-w-none text-sm dark:text-slate-100">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">
                          {message.content}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}

              {(isSending || isImporting) && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isImporting ? '导入中...' : '思考中...'}
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/70">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="请输入产品背景或当前痛点..."
                className="min-h-[96px] resize-none"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Enter 发送，Shift+Enter 换行。
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.markdown,.pdf,.docx"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isImporting}
                    className="gap-2"
                  >
                    {isImporting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileUp className="h-4 w-4" />
                    )}
                    导入文档
                  </Button>
                  <Button
                    onClick={handleSend}
                    disabled={isSending || isImporting || !input.trim()}
                    className="gap-2"
                  >
                    {isSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    发送
                  </Button>
                </div>
              </div>
              {importError && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  {importError}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid min-h-0 grid-rows-2 gap-4">
          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="border-b border-slate-200/70 dark:border-slate-800/70">
              <CardTitle>当前会话 PRD</CardTitle>
              <CardDescription>
                基于对话和总结自动刷新。{prdLatest?.filename || ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 overflow-y-auto">
              {isLoadingPrd && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载 PRD...
                </div>
              )}
              {!isLoadingPrd && !sessionId && (
                <div className="text-sm text-slate-500">暂无会话信息，等待 PRD...</div>
              )}
              {!isLoadingPrd && sessionId && !prdLatest?.content && (
                <div className="text-sm text-slate-500">暂无 PRD。</div>
              )}
              {prdLatest?.content && (
                <div className="prose max-w-none text-sm dark:text-slate-100">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {prdLatest.content}
                  </ReactMarkdown>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="border-b border-slate-200/70 dark:border-slate-800/70">
              <CardTitle>每 2 分钟总结</CardTitle>
              <CardDescription>新的总结会追加到下方</CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
              {isLoadingSummaries && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载总结...
                </div>
              )}
              {!isLoadingSummaries && summaries.length === 0 && (
                <div className="text-sm text-slate-500">暂无总结。</div>
              )}
              {summaries.map((item) => (
                <div
                  key={item.filename}
                  className="w-full min-w-0 rounded-xl border border-slate-200/70 bg-white/70 p-3 text-sm text-slate-700 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/60 dark:text-slate-200"
                >
                  <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                    {new Date(item.timestamp * 1000).toLocaleString('zh-CN')}
                  </div>
                  <div className="whitespace-pre-wrap break-words leading-relaxed">
                    {item.content}
                  </div>
                </div>
              ))}
              <div ref={summaryEndRef} />
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
