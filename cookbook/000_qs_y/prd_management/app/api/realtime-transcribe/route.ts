import { NextRequest } from 'next/server';

// 浼樺寲鐗堝疄鏃惰浆鍐?API
// 瑙ｅ喅鍗′綇闂锛?// 1. 鍑忓皯绛夊緟鏃堕棿
// 2. 鍔犲揩鍙戦€侀€熷害
// 3. 娣诲姞瓒呮椂淇濇姢

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return new Response(
        JSON.stringify({ error: '鏈彁渚涢煶棰戞枃浠? }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const audioBuffer = await file.arrayBuffer();
    const audioData = Buffer.from(audioBuffer);
    
    console.log(`馃數 鏀跺埌闊抽锛屽ぇ灏? ${audioData.length} 瀛楄妭`);

    // 妫€鏌ラ煶棰戝ぇ灏忥紙澶煭鐨勯煶棰戣烦杩囷級
    if (audioData.length < 2000) {
      console.log('鈿狅笍 闊抽澶煭锛岃烦杩囪瘑鍒?);
      return new Response(
        JSON.stringify({ text: '', skipped: true }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 浣跨敤 Promise.race 娣诲姞瓒呮椂淇濇姢
    const result = await Promise.race([
      recognizeSpeechWithTimeout(audioData),
      new Promise<Response>((_, reject) => 
        setTimeout(() => reject(new Error('璇嗗埆瓒呮椂')), 10000)
      )
    ]);

    return result;
  } catch (error) {
    console.error('瀹炴椂杞啓閿欒:', error);
    const errorMessage = error instanceof Error ? error.message : '鏈煡閿欒';
    
    return new Response(
      JSON.stringify({ error: '杞啓澶辫触', details: errorMessage }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// 甯﹁秴鏃剁殑涓€鍙ヨ瘽璇嗗埆
async function recognizeSpeechWithTimeout(audioData: Buffer): Promise<Response> {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      let sr: { sendAudio: (data: Buffer) => boolean; close: () => Promise<void>; shutdown: () => void; start: (params: Record<string, unknown>, enablePing: boolean, pingInterval: number) => Promise<void>; on: (event: string, callback: (msg: string) => void) => void } | null = null;
      let timeoutId: NodeJS.Timeout | null = null;
      let isCompleted = false;
      
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (sr) {
          try { sr.shutdown(); } catch { /* ignore */ }
        }
        if (!isCompleted) {
          isCompleted = true;
          try { controller.close(); } catch { /* ignore */ }
        }
      };
      
      // 璁剧疆鎬昏秴鏃讹紙8绉掞級
      timeoutId = setTimeout(() => {
        console.log('鈴憋笍 璇嗗埆瓒呮椂锛屽己鍒跺叧闂?);
        const message = `data: ${JSON.stringify({ type: 'timeout', error: '璇嗗埆瓒呮椂' })}\n\n`;
        try {
          controller.enqueue(encoder.encode(message));
        } catch { /* ignore */ }
        cleanup();
      }, 8000);

      try {
        const { generateAliyunToken } = await import('@/lib/aliyun-token');
        const tokenData = await generateAliyunToken();
        const token = tokenData.token;

        const appKey = process.env.ALIYUN_ASR_APP_KEY?.trim();
        if (!appKey) {
          throw new Error('闃块噷浜?AppKey 鏈厤缃?);
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Nls = require('alibabacloud-nls');
        const { SpeechRecognition } = Nls;

        const region = process.env.ALIYUN_ASR_REGION || 'cn-shanghai';
        const URL = `wss://nls-gateway.${region}.aliyuncs.com/ws/v1`;
        
        sr = new SpeechRecognition({
          url: URL,
          appkey: appKey,
          token: token,
        });

        const sendEvent = (type: string, data: Record<string, unknown>) => {
          if (isCompleted) return;
          try {
            const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
            controller.enqueue(encoder.encode(message));
          } catch { /* ignore */ }
        };

        sr.on('started', (msg: string) => {
          console.log('馃數 璇嗗埆寮€濮?);
        });

        sr.on('changed', (msg: string) => {
          try {
            const data = JSON.parse(msg);
            if (data.payload?.result) {
              console.log('馃數 涓棿:', data.payload.result);
              sendEvent('intermediate', { text: data.payload.result });
            }
          } catch { /* ignore */ }
        });

        sr.on('completed', (msg: string) => {
          console.log('鉁?璇嗗埆瀹屾垚');
          try {
            const data = JSON.parse(msg);
            if (data.payload?.result) {
              sendEvent('final', { text: data.payload.result });
            }
          } catch { /* ignore */ }
          cleanup();
        });

        sr.on('closed', () => {
          console.log('馃數 杩炴帴鍏抽棴');
          cleanup();
        });

        sr.on('failed', (msg: string) => {
          console.error('鉂?璇嗗埆澶辫触:', msg);
          sendEvent('error', { error: msg });
          cleanup();
        });

        // 鍙傛暟浼樺寲
        const startParams = {
          format: 'wav',
          sample_rate: 16000,
          enable_intermediate_result: true,
          enable_punctuation_prediction: true,
          enable_inverse_text_normalization: true,
          enable_voice_detection: true,
          max_start_silence: 5000,   // 鍑忓皯璧峰闈欓煶绛夊緟
          max_end_silence: 500,      // 鍑忓皯缁撴潫闈欓煶绛夊緟
        };

        await sr.start(startParams, true, 3000);

        // 蹇€熷彂閫侀煶棰戯紙鏃犲欢杩燂級
        const chunkSize = 6400; // 200ms 闊抽鍧?        for (let i = 0; i < audioData.length && !isCompleted; i += chunkSize) {
          const chunk = audioData.slice(i, i + chunkSize);
          if (!sr.sendAudio(chunk)) {
            throw new Error('鍙戦€佸け璐?);
          }
        }

        console.log('馃數 闊抽鍙戦€佸畬鎴愶紝绛夊緟缁撴灉...');
        await sr.close();

        // 绛夊緟缁撴灉锛堟渶澶?5 绉掞級
        const waitStart = Date.now();
        while (!isCompleted && (Date.now() - waitStart) < 5000) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        cleanup();

      } catch (error) {
        console.error('璇嗗埆閿欒:', error);
        const errorMessage = error instanceof Error ? error.message : '鏈煡閿欒';
        try {
          const message = `data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch { /* ignore */ }
        cleanup();
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
