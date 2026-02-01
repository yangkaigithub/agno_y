import { NextRequest } from 'next/server';
import { splitAudio, createTempFile, deleteTempFile, cleanupSegments, AudioSegment } from '@/lib/audio-splitter';
import { uploadToOSS, deleteOSSFile } from '@/lib/aliyun-oss';
import { submitFileTranscriptionTask, pollTranscriptionResult } from '@/lib/aliyun-file-transcription';

// 鍒嗘杞啓 API锛圫SE 娴佸紡杩斿洖锛?// 娴佺▼锛氫笂浼犳枃浠?鈫?鍒囧壊涓?2 鍒嗛挓鐗囨 鈫?鍒嗗埆璇嗗埆 鈫?鍒嗗埆鎬荤粨 鈫?娓呯悊 OSS 涓存椂鏂囦欢
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      let tempFilePath: string | null = null;
      let segments: AudioSegment[] = [];
      const ossFilesToCleanup: string[] = []; // 闇€瑕佹竻鐞嗙殑 OSS 鏂囦欢
      
      const sendEvent = (type: string, data: Record<string, unknown>) => {
        const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      try {
        // 1. 鎺ユ敹涓婁紶鐨勬枃浠?        const formData = await request.formData();
        const file = formData.get('file') as File;
        const projectId = formData.get('projectId') as string;

        if (!file) {
          sendEvent('error', { error: '鏈彁渚涢煶棰戞枃浠? });
          controller.close();
          return;
        }

        sendEvent('status', { message: '姝ｅ湪澶勭悊闊抽鏂囦欢...' });

        // 2. 淇濆瓨鍒颁复鏃舵枃浠?        const buffer = Buffer.from(await file.arrayBuffer());
        tempFilePath = await createTempFile(buffer, file.name);
        console.log('馃數 涓存椂鏂囦欢宸插垱寤?', tempFilePath);

        // 3. 鍒囧壊闊抽锛堟瘡 2 鍒嗛挓涓€娈碉級
        sendEvent('status', { message: '姝ｅ湪鍒囧壊闊抽...' });
        segments = await splitAudio(tempFilePath, 120); // 2 鍒嗛挓
        sendEvent('segments_info', { 
          totalSegments: segments.length,
          message: `闊抽宸插垏鍓蹭负 ${segments.length} 涓墖娈礰
        });

        // 4. 澶勭悊姣忎釜鐗囨
        const results: Array<{
          index: number;
          startTime: number;
          endTime: number;
          text: string;
          segments?: Array<{ speakerId: number; text: string; beginTime: number; endTime: number }>;
        }> = [];

        for (const segment of segments) {
          sendEvent('segment_start', { 
            index: segment.index,
            startTime: segment.startTime,
            endTime: segment.endTime,
            message: `姝ｅ湪澶勭悊鐗囨 ${segment.index + 1}/${segments.length}`
          });

          try {
            // 4.1 涓婁紶鐗囨鍒?OSS
            const fs = await import('fs');
            const segmentBuffer = fs.readFileSync(segment.filePath);
            const ext = file.name.split('.').pop()?.toLowerCase() || 'wav';
            const segmentFileName = `${projectId || 'temp'}/segment_${segment.index + 1}_${Date.now()}.${ext}`;
            
            // 鏍规嵁鏂囦欢鎵╁睍鍚嶇‘瀹?content type
            const contentTypeMap: Record<string, string> = {
              'mp3': 'audio/mpeg',
              'wav': 'audio/wav',
              'm4a': 'audio/mp4',
              'webm': 'audio/webm',
            };
            const contentType = contentTypeMap[ext] || 'audio/wav';
            
            // 涓婁紶骞剁敓鎴愰绛惧悕 URL锛堟湁鏁堟湡 1 灏忔椂锛?            const { url: ossUrl, objectName } = await uploadToOSS(segmentBuffer, segmentFileName, {
              contentType,
              generateSignedUrl: true,
              signedUrlExpires: 3600, // 1 灏忔椂
            });
            console.log(`馃數 鐗囨 ${segment.index + 1} 宸蹭笂浼犲埌 OSS:`, ossUrl);
            
            // 璁板綍 OSS 鏂囦欢鍚嶇敤浜庡悗缁竻鐞?            ossFilesToCleanup.push(objectName);

            // 4.2 鎻愪氦褰曢煶鏂囦欢璇嗗埆
            const { taskId } = await submitFileTranscriptionTask(ossUrl);
            console.log(`馃數 鐗囨 ${segment.index + 1} 璇嗗埆浠诲姟宸叉彁浜?`, taskId);

            // 4.3 绛夊緟璇嗗埆缁撴灉
            const task = await pollTranscriptionResult(taskId, {
              interval: 2000,
              timeout: 3 * 60 * 1000, // 3 鍒嗛挓瓒呮椂
              onProgress: (status) => {
                sendEvent('segment_progress', { 
                  index: segment.index,
                  status
                });
              },
            });

            // 4.4 淇濆瓨缁撴灉
            results.push({
              index: segment.index,
              startTime: segment.startTime,
              endTime: segment.endTime,
              text: task.result || '',
              segments: task.segments,
            });

            sendEvent('segment_complete', { 
              index: segment.index,
              startTime: segment.startTime,
              endTime: segment.endTime,
              text: task.result || '',
              segments: task.segments,
              message: `鐗囨 ${segment.index + 1}/${segments.length} 璇嗗埆瀹屾垚`
            });

            // 4.5 涓鸿繖涓墖娈电敓鎴愰樁娈垫€ф€荤粨
            if (task.result && task.result.trim().length > 50) {
              try {
                const summaryResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/summarize`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: task.result }),
                });

                if (summaryResponse.ok) {
                  const summaryData = await summaryResponse.json();
                  sendEvent('segment_summary', {
                    index: segment.index,
                    timestamp: segment.startTime,
                    summary: summaryData.summary,
                  });
                }
              } catch (summaryError) {
                console.warn(`鐗囨 ${segment.index + 1} 鎬荤粨鐢熸垚澶辫触:`, summaryError);
              }
            }

          } catch (segmentError) {
            console.error(`鐗囨 ${segment.index + 1} 澶勭悊澶辫触:`, segmentError);
            sendEvent('segment_error', { 
              index: segment.index,
              error: segmentError instanceof Error ? segmentError.message : '鏈煡閿欒'
            });
          }
        }

        // 5. 鍚堝苟鎵€鏈夌粨鏋?        const fullText = results
          .sort((a, b) => a.index - b.index)
          .map(r => r.text)
          .join('\n\n');

        // 鍚堝苟鎵€鏈夎璇濅汉鍒嗘锛堣皟鏁存椂闂存埑锛?        const allSegments: Array<{ speakerId: number; text: string; beginTime: number; endTime: number }> = [];
        for (const result of results.sort((a, b) => a.index - b.index)) {
          if (result.segments) {
            for (const seg of result.segments) {
              allSegments.push({
                ...seg,
                // 鏃堕棿鎴冲姞涓婄墖娈电殑璧峰鏃堕棿锛堣浆鎹负姣锛?                beginTime: seg.beginTime + result.startTime * 1000,
                endTime: seg.endTime + result.startTime * 1000,
              });
            }
          }
        }

        sendEvent('complete', { 
          text: fullText,
          segments: allSegments,
          segmentResults: results,
          message: '鎵€鏈夌墖娈佃瘑鍒畬鎴?
        });

      } catch (error) {
        console.error('鍒嗘杞啓澶辫触:', error);
        sendEvent('error', { 
          error: error instanceof Error ? error.message : '鏈煡閿欒'
        });
      } finally {
        // 娓呯悊鏈湴涓存椂鏂囦欢
        if (tempFilePath) {
          deleteTempFile(tempFilePath);
        }
        if (segments.length > 0) {
          cleanupSegments(segments);
        }
        
        // 娓呯悊 OSS 涓存椂鏂囦欢
        if (ossFilesToCleanup.length > 0) {
          console.log(`馃Ч 寮€濮嬫竻鐞?${ossFilesToCleanup.length} 涓?OSS 涓存椂鏂囦欢...`);
          for (const objectName of ossFilesToCleanup) {
            try {
              await deleteOSSFile(objectName);
              console.log(`鉁?宸插垹闄?OSS 鏂囦欢: ${objectName}`);
            } catch (e) {
              console.warn(`鈿狅笍 鍒犻櫎 OSS 鏂囦欢澶辫触: ${objectName}`, e);
            }
          }
          console.log('馃Ч OSS 涓存椂鏂囦欢娓呯悊瀹屾垚');
        }
        
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
