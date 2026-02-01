'use client';

import { Clock, FileText, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Summary {
  content: string;
  timestamp: number;
  id?: string;
}

interface SummarySidebarProps {
  summaries: Summary[];
  overview?: string;         // 鍏ㄦ枃姒傝
  isUpdatingOverview?: boolean; // 鏄惁姝ｅ湪鏇存柊鍏ㄦ枃姒傝
}

export function SummarySidebar({ summaries, overview, isUpdatingOverview }: SummarySidebarProps) {
  function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* 鍏ㄦ枃姒傝 */}
      <Card className="flex-shrink-0">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            鍏ㄦ枃姒傝
            {isUpdatingOverview && (
              <Loader2 className="h-3 w-3 animate-spin ml-auto text-blue-500" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {overview ? (
            <div className="max-h-40 overflow-y-auto">
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                {overview}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-400 text-center py-4">
              {summaries.length > 0 ? '姝ｅ湪鐢熸垚鍏ㄦ枃姒傝...' : '绛夊緟闃舵鎬ф€荤粨鍚庤嚜鍔ㄧ敓鎴?}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 闃舵鎬х畝鎶?*/}
      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="flex-shrink-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            闃舵鎬х畝鎶?            {summaries.length > 0 && (
              <Badge variant="secondary" className="ml-auto text-xs">
                {summaries.length} 鏉?              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            姣?2 鍒嗛挓鑷姩鎻愬彇鍏抽敭鍐呭
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden">
          {summaries.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">
              褰曢煶寮€濮嬪悗锛屾瘡 2 鍒嗛挓浼氳嚜鍔ㄦ彁鍙栧叧閿唴瀹?            </p>
          ) : (
            <div className="h-full max-h-[calc(100vh-450px)] overflow-y-auto pr-2 space-y-3">
              {summaries.map((summary, index) => (
                <div key={summary.id || index} className="border-l-2 border-blue-500 pl-3 py-1.5">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-xs px-1.5 py-0">
                      {formatTime(summary.timestamp)}
                    </Badge>
                    <span className="text-xs text-slate-400">#{index + 1}</span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                    {summary.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
