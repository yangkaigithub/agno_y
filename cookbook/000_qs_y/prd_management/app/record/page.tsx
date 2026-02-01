'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Sparkles, Loader2, Save } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RecordingPanel } from '@/components/RecordingPanel';
import { SummarySidebar } from '@/components/SummarySidebar';

interface Summary {
  content: string;
  timestamp: number;
  id?: string;
}

export default function RecordPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [transcription, setTranscription] = useState('');
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [overview, setOverview] = useState('');           // 鍏ㄦ枃姒傝
  const [isUpdatingOverview, setIsUpdatingOverview] = useState(false); // 鏄惁姝ｅ湪鏇存柊鍏ㄦ枃姒傝

  async function handleGeneratePRD() {
    if (!transcription.trim()) {
      alert('璇峰厛杩涜褰曢煶杞啓鎴栦笂浼犻煶棰戞枃浠?);
      return;
    }

    if (!title.trim()) {
      alert('璇疯緭鍏ラ」鐩爣棰?);
      return;
    }

    setIsGenerating(true);
    try {
      // 鍒涘缓椤圭洰
      const projectResponse = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          raw_text: transcription,
          summary: summaries.length > 0 ? summaries[summaries.length - 1].content : '',
          prd_content: '',
          audio_url: '',
        }),
      });

      if (!projectResponse.ok) {
        throw new Error('鍒涘缓椤圭洰澶辫触');
      }

      const project = await projectResponse.json();
      setProjectId(project.id);

      // 鐢熸垚 PRD锛堜紭鍏堜娇鐢ㄩ樁娈垫€ф€荤粨锛屾洿楂樻晥锛?      const response = await fetch('/api/generate-prd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 浼樺厛浣跨敤闃舵鎬ф€荤粨
          summaries: summaries.length > 0 ? summaries.map(s => ({
            content: s.content,
            timestamp: s.timestamp
          })) : undefined,
          // 濡傛灉娌℃湁闃舵鎬ф€荤粨锛屽洖閫€浣跨敤鍘熷杞啓
          transcription: summaries.length === 0 ? transcription : undefined,
          title: title.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error('鐢熸垚 PRD 澶辫触');
      }

      const data = await response.json();

      // 鏇存柊椤圭洰
      const updateResponse = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prd_content: data.markdown,
          summary: data.prd.background.substring(0, 200),
        }),
      });

      if (updateResponse.ok) {
        router.push(`/prd/${project.id}`);
      } else {
        throw new Error('淇濆瓨 PRD 澶辫触');
      }
    } catch (error) {
      console.error('鐢熸垚 PRD 澶辫触:', error);
      alert('鐢熸垚 PRD 澶辫触锛岃閲嶈瘯');
    } finally {
      setIsGenerating(false);
    }
  }

  function handleTranscriptionUpdate(text: string) {
    setTranscription(text);
  }

  async function handleSummaryGenerated(content: string, timestamp: number) {
    setSummaries((prev) => [
      ...prev,
      { content, timestamp, id: Date.now().toString() },
    ]);
    
    // 鏇存柊鍏ㄦ枃姒傝锛堝悎骞朵笂娆℃瑙?+ 鏂伴樁娈垫€荤粨锛?    setIsUpdatingOverview(true);
    try {
      const response = await fetch('/api/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previousOverview: overview,
          newSummary: content,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setOverview(data.overview);
      }
    } catch (error) {
      console.error('鏇存柊鍏ㄦ枃姒傝澶辫触:', error);
    } finally {
      setIsUpdatingOverview(false);
    }
  }

  async function handleSaveProject() {
    if (!title.trim()) {
      alert('璇疯緭鍏ラ」鐩爣棰?);
      return;
    }

    if (!transcription.trim()) {
      alert('璇峰厛杩涜褰曢煶杞啓鎴栦笂浼犻煶棰戞枃浠?);
      return;
    }

    setIsSaving(true);
    try {
      let savedProjectId = projectId;

      // 濡傛灉椤圭洰宸插瓨鍦紝鏇存柊椤圭洰锛涘惁鍒欏垱寤烘柊椤圭洰
      if (savedProjectId) {
        const updateResponse = await fetch(`/api/projects/${savedProjectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            raw_text: transcription, // 淇濆瓨杞啓鍐呭
            summary: summaries.length > 0 ? summaries[summaries.length - 1].content : '',
          }),
        });

        if (!updateResponse.ok) {
          throw new Error('淇濆瓨椤圭洰澶辫触');
        }
      } else {
        const projectResponse = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            raw_text: transcription, // 淇濆瓨杞啓鍐呭
            summary: summaries.length > 0 ? summaries[summaries.length - 1].content : '',
            prd_content: '',
            audio_url: '',
          }),
        });

        if (!projectResponse.ok) {
          throw new Error('淇濆瓨椤圭洰澶辫触');
        }

        const project = await projectResponse.json();
        savedProjectId = project.id;
        setProjectId(savedProjectId);
        
        // 椤圭洰鍒涘缓鍚庯紝绔嬪嵆淇濆瓨宸叉湁鐨勯樁娈垫€ф€荤粨
        if (summaries.length > 0) {
          console.log('馃數 椤圭洰宸插垱寤猴紝绔嬪嵆淇濆瓨闃舵鎬ф€荤粨锛屾暟閲?', summaries.length);
          
          const batchResponse = await fetch('/api/mini-summaries/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              project_id: savedProjectId,
              summaries: summaries.map(s => ({
                timestamp: s.timestamp,
                content: s.content,
              })),
            }),
          });

          if (!batchResponse.ok) {
            console.warn('鈿狅笍 淇濆瓨闃舵鎬ф€荤粨澶辫触锛屼絾椤圭洰宸蹭繚瀛?);
            const errorData = await batchResponse.json().catch(() => ({}));
            console.error('閿欒璇︽儏:', errorData);
          } else {
            const batchResult = await batchResponse.json();
            console.log('鉁?闃舵鎬ф€荤粨淇濆瓨鎴愬姛锛屾暟閲?', batchResult.count);
          }
        }
      }

      // 濡傛灉鏄洿鏂伴」鐩紝涔熶繚瀛橀樁娈垫€ф€荤粨锛堥伩鍏嶉噸澶嶄繚瀛橈級
      if (savedProjectId && summaries.length > 0) {
        // 妫€鏌ユ槸鍚﹀凡鏈夋€荤粨锛堥伩鍏嶉噸澶嶄繚瀛橈級
        const existingSummariesResponse = await fetch(`/api/mini-summaries?projectId=${savedProjectId}`);
        const existingSummaries = existingSummariesResponse.ok 
          ? await existingSummariesResponse.json() 
          : [];
        
        // 鍙繚瀛樻柊鐨勬€荤粨锛堥€氳繃鏃堕棿鎴冲垽鏂級
        const existingTimestamps = new Set(existingSummaries.map((s: any) => s.timestamp));
        const newSummaries = summaries.filter(s => !existingTimestamps.has(s.timestamp));
        
        if (newSummaries.length > 0) {
          console.log('馃數 淇濆瓨鏂扮殑闃舵鎬ф€荤粨锛屾暟閲?', newSummaries.length);
          
          const batchResponse = await fetch('/api/mini-summaries/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              project_id: savedProjectId,
              summaries: newSummaries.map(s => ({
                timestamp: s.timestamp,
                content: s.content,
              })),
            }),
          });

          if (!batchResponse.ok) {
            console.warn('鈿狅笍 淇濆瓨闃舵鎬ф€荤粨澶辫触锛屼絾椤圭洰宸蹭繚瀛?);
          } else {
            const batchResult = await batchResponse.json();
            console.log('鉁?闃舵鎬ф€荤粨淇濆瓨鎴愬姛锛屾暟閲?', batchResult.count);
          }
        }
      }

      alert('椤圭洰淇濆瓨鎴愬姛锛?);
      router.push(`/prd/${savedProjectId}`);
    } catch (error) {
      console.error('淇濆瓨椤圭洰澶辫触:', error);
      alert('淇濆瓨椤圭洰澶辫触锛岃閲嶈瘯');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-8">
        <Link href="/">
          <Button variant="ghost" className="mb-4 gap-2">
            <ArrowLeft className="h-4 w-4" />
            杩斿洖棣栭〉
          </Button>
        </Link>

        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50 mb-2">
            鏂板缓 PRD 椤圭洰
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            褰曢煶鎴栦笂浼犻煶棰戞枃浠讹紝AI 灏嗚嚜鍔ㄧ敓鎴愪骇鍝侀渶姹傛枃妗?          </p>
        </div>

        <div className="mb-4">
          <Label htmlFor="title">椤圭洰鏍囬</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="渚嬪锛氱敤鎴风鐞嗙郴缁熶紭鍖?
            className="mt-2"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecordingPanel
              onTranscriptionUpdate={handleTranscriptionUpdate}
              onSummaryGenerated={handleSummaryGenerated}
              projectId={projectId || undefined}
            />

            {transcription && (
              <div className="mt-6 flex gap-3">
                <Button
                  onClick={handleSaveProject}
                  size="lg"
                  variant="outline"
                  className="flex-1 gap-2"
                  disabled={isSaving || !title.trim()}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      淇濆瓨涓?..
                    </>
                  ) : (
                    <>
                      <Save className="h-5 w-5" />
                      淇濆瓨椤圭洰
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleGeneratePRD}
                  size="lg"
                  className="flex-1 gap-2"
                  disabled={isGenerating || !title.trim()}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      姝ｅ湪鐢熸垚 PRD...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-5 w-5" />
                      鐢熸垚 PRD 鏂囨。
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          <div className="lg:col-span-1">
            <SummarySidebar 
              summaries={summaries} 
              overview={overview}
              isUpdatingOverview={isUpdatingOverview}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
