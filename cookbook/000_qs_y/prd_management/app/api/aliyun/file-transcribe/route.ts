import { NextRequest, NextResponse } from 'next/server';
import { submitFileTranscriptionTask, pollTranscriptionResult } from '@/lib/aliyun-file-transcription';

// 鎻愪氦褰曢煶鏂囦欢璇嗗埆浠诲姟
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileUrl } = body;

    if (!fileUrl) {
      return NextResponse.json(
        { error: '鏈彁渚涙枃浠?URL' },
        { status: 400 }
      );
    }

    // 鎻愪氦璇嗗埆浠诲姟
    const { taskId } = await submitFileTranscriptionTask(fileUrl);

    return NextResponse.json({
      taskId,
      message: '璇嗗埆浠诲姟宸叉彁浜?,
    });
  } catch (error) {
    console.error('鎻愪氦璇嗗埆浠诲姟閿欒:', error);
    const errorMessage = error instanceof Error ? error.message : '鏈煡閿欒';
    
    return NextResponse.json(
      { error: '鎻愪氦璇嗗埆浠诲姟澶辫触', details: errorMessage },
      { status: 500 }
    );
  }
}

// 鏌ヨ璇嗗埆浠诲姟鐘舵€?export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json(
        { error: '鏈彁渚涗换鍔?ID' },
        { status: 400 }
      );
    }

    // 鏌ヨ浠诲姟鐘舵€?    const { getTranscriptionTaskStatus } = await import('@/lib/aliyun-file-transcription');
    const task = await getTranscriptionTaskStatus(taskId);

    return NextResponse.json(task);
  } catch (error) {
    console.error('鏌ヨ浠诲姟鐘舵€侀敊璇?', error);
    const errorMessage = error instanceof Error ? error.message : '鏈煡閿欒';
    
    return NextResponse.json(
      { error: '鏌ヨ浠诲姟鐘舵€佸け璐?, details: errorMessage },
      { status: 500 }
    );
  }
}

// 杞鑾峰彇璇嗗埆缁撴灉锛堝甫 SSE 鏀寔锛?export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, waitForResult = false } = body;

    if (!taskId) {
      return NextResponse.json(
        { error: '鏈彁渚涗换鍔?ID' },
        { status: 400 }
      );
    }

    if (waitForResult) {
      // 濡傛灉闇€瑕佺瓑寰呯粨鏋滐紝浣跨敤 SSE 娴佸紡杩斿洖
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            const sendEvent = (type: string, data: Record<string, unknown>) => {
              const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
              controller.enqueue(encoder.encode(message));
            };

            // 杞鑾峰彇缁撴灉锛堣繑鍥炲畬鏁翠换鍔＄粨鏋滐紝鍚璇濅汉鍒嗘锛?            const task = await pollTranscriptionResult(taskId, {
              interval: 2000,
              timeout: 5 * 60 * 1000, // 5 鍒嗛挓瓒呮椂
              onProgress: (status) => {
                sendEvent('progress', { status });
              },
            });

            // 杩斿洖绾枃鏈粨鏋滃拰璇磋瘽浜哄垎娈?            sendEvent('complete', { 
              result: task.result,
              segments: task.segments // 璇磋瘽浜哄垎娈?            });
            controller.close();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '鏈煡閿欒';
            const errorMsg = `data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`;
            controller.enqueue(encoder.encode(errorMsg));
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
    } else {
      // 鍙煡璇竴娆＄姸鎬?      const { getTranscriptionTaskStatus } = await import('@/lib/aliyun-file-transcription');
      const task = await getTranscriptionTaskStatus(taskId);
      return NextResponse.json(task);
    }
  } catch (error) {
    console.error('杞璇嗗埆缁撴灉閿欒:', error);
    const errorMessage = error instanceof Error ? error.message : '鏈煡閿欒';
    
    return NextResponse.json(
      { error: '杞璇嗗埆缁撴灉澶辫触', details: errorMessage },
      { status: 500 }
    );
  }
}
