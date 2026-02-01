import { NextRequest } from 'next/server';
import { createTranscriptionProvider } from '@/lib/transcribe';

// 娴佸紡杞啓 API锛屼娇鐢?SSE 鎺ㄩ€佷腑闂寸粨鏋?export async function POST(request: NextRequest) {
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

    const provider = createTranscriptionProvider();
    
    // 妫€鏌ユ槸鍚︽槸闃块噷浜戞彁渚涘晢
    if (provider.getName() !== '闃块噷浜戣闊宠瘑鍒?) {
      // 闈為樋閲屼簯鎻愪緵鍟嗭紝浣跨敤鏅€氳浆鍐?      const { transcribeAudio } = await import('@/lib/transcribe');
      const transcription = await transcribeAudio(file);
      return new Response(
        JSON.stringify({ text: transcription, isFinal: true }),
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // 闃块噷浜戞彁渚涘晢锛屼娇鐢ㄦ祦寮忚浆鍐?    return await streamTranscribe(file);
  } catch (error) {
    console.error('娴佸紡杞啓閿欒:', error);
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

async function streamTranscribe(file: File) {
  const encoder = new TextEncoder();
  
  // 鍒涘缓 ReadableStream 鐢ㄤ簬 SSE
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 鑾峰彇 Token
        const { generateAliyunToken } = await import('@/lib/aliyun-token');
        const tokenData = await generateAliyunToken();
        const token = tokenData.token;

        // 鑾峰彇 AppKey
        const appKey = process.env.ALIYUN_ASR_APP_KEY?.trim();
        if (!appKey) {
          throw new Error('闃块噷浜?AppKey 鏈厤缃?);
        }

        // 璇诲彇闊抽鏂囦欢
        const audioBuffer = await file.arrayBuffer();
        const audioData = Buffer.from(audioBuffer);

        // 鍔ㄦ€佸鍏?SDK
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Nls = require('alibabacloud-nls');
        const { SpeechTranscription } = Nls;

        const URL = 'wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1';
        const st = new SpeechTranscription({
          url: URL,
          appkey: appKey,
          token: token,
        });

        let finalResult = '';
        let isCompleted = false;
        let errorOccurred: Error | null = null;

        // 鍙戦€佷腑闂寸粨鏋?        const sendEvent = (type: string, data: Record<string, unknown>) => {
          const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
          controller.enqueue(encoder.encode(message));
        };

        st.on('started', (msg: string) => {
          console.log('馃數 闃块噷浜戣瘑鍒紑濮?', msg);
          sendEvent('started', { message: msg });
        });

        // 璁板綍璇嗗埆寮€濮嬫椂闂达紙鐢ㄤ簬璁＄畻鐩稿鏃堕棿鎴筹級
        const recognitionStartTime = Date.now();

        st.on('changed', (msg: string) => {
          try {
            const data = JSON.parse(msg);
            if (data.payload && data.payload.result) {
              const intermediateResult = data.payload.result;
              const beginTime = data.payload.begin_time || 0; // 鍙ュ瓙寮€濮嬫椂闂达紙姣锛?              const speakerId = data.payload.spk_id ?? data.payload.speaker_id ?? 0; // 璇磋瘽浜?ID
              
              console.log('馃數 涓棿缁撴灉:', { text: intermediateResult, beginTime, speakerId });
              sendEvent('intermediate', { 
                text: intermediateResult,
                beginTime,
                speakerId,
                timestamp: Date.now() - recognitionStartTime
              });
            }
          } catch {
            // 蹇界暐瑙ｆ瀽閿欒
          }
        });

        // 鍙ュ瓙缁撴潫浜嬩欢 - 杩欐槸姣忓彞璇濈殑鏈€缁堢粨鏋滐紝闇€瑕佽拷鍔犲埌绱Н鏂囨湰
        st.on('end', (msg: string) => {
          console.log('馃數 鍙ュ瓙缁撴潫锛堝畬鏁存暟鎹級:', msg);
          try {
            const data = JSON.parse(msg);
            // 浠?end 浜嬩欢涓彁鍙栬繖鍙ヨ瘽鐨勬渶缁堢粨鏋?            if (data.payload && data.payload.result) {
              const sentenceResult = data.payload.result;
              const beginTime = data.payload.begin_time || 0; // 鍙ュ瓙寮€濮嬫椂闂达紙姣锛?              const endTime = data.payload.time || data.payload.end_time || 0; // 鍙ュ瓙缁撴潫鏃堕棿锛堟绉掞級
              const speakerId = data.payload.spk_id ?? data.payload.speaker_id ?? 0; // 璇磋瘽浜?ID
              
              console.log('鉁?鍙ュ瓙鏈€缁堢粨鏋?', { text: sentenceResult, beginTime, endTime, speakerId });
              
              // 鍙戦€?final 浜嬩欢锛屽寘鍚璇濅汉鍜屾椂闂翠俊鎭?              sendEvent('final', { 
                text: sentenceResult,
                beginTime,
                endTime,
                speakerId,
                timestamp: Date.now() - recognitionStartTime
              });
              finalResult += sentenceResult; // 绱Н鏈€缁堢粨鏋?            }
          } catch (e) {
            console.error('瑙ｆ瀽鍙ュ瓙缁撴潫浜嬩欢澶辫触:', e);
          }
        });

        // 鍙ュ瓙寮€濮嬩簨浠?        st.on('begin', (msg: string) => {
          console.log('馃數 鍙ュ瓙寮€濮?', msg);
          try {
            const data = JSON.parse(msg);
            const beginTime = data.payload?.begin_time || 0;
            const speakerId = data.payload?.spk_id ?? data.payload?.speaker_id ?? 0;
            sendEvent('sentence_begin', { 
              beginTime,
              speakerId,
              timestamp: Date.now() - recognitionStartTime
            });
          } catch {
            sendEvent('sentence_begin', { timestamp: Date.now() - recognitionStartTime });
          }
        });

        // 璇嗗埆瀹屾垚浜嬩欢 - 鏁翠釜浼氳瘽缁撴潫
        st.on('completed', (msg: string) => {
          console.log('鉁?闃块噷浜戣瘑鍒細璇濆畬鎴?', msg);
          // 涓嶅啀浠?completed 鎻愬彇缁撴灉锛屽洜涓烘瘡鍙ヨ瘽鐨勭粨鏋滃凡缁忓湪 end 浜嬩欢涓鐞?          sendEvent('completed', { message: '璇嗗埆瀹屾垚' });
          isCompleted = true;
          controller.close();
        });

        st.on('closed', () => {
          console.log('馃數 杩炴帴宸插叧闂?);
          if (!isCompleted && !errorOccurred) {
            isCompleted = true;
            controller.close();
          }
        });

        st.on('failed', (msg: string) => {
          console.error('鉂?闃块噷浜戣瘑鍒け璐?', msg);
          try {
            const data = JSON.parse(msg);
            errorOccurred = new Error(data.message || data.status_text || msg);
          } catch {
            errorOccurred = new Error(msg);
          }
          sendEvent('error', { error: errorOccurred.message });
          isCompleted = true;
          controller.close();
        });

        // 閰嶇疆璇嗗埆鍙傛暟
        // 娉ㄦ剰锛氬疄鏃惰闊宠瘑鍒紙SpeechTranscription锛変笉鏀寔璇磋瘽浜哄垎绂?        // 璇磋瘽浜哄垎绂讳粎鍦ㄥ綍闊虫枃浠惰瘑鍒腑鏀寔
        const startParams = {
          format: 'wav',  // WAV 鏍煎紡
          sample_rate: 16000,
          enable_intermediate_result: true,  // 寮€鍚腑闂寸粨鏋?          enable_punctuation_prediction: true,  // 寮€鍚爣鐐归娴?          enable_inverse_text_normalization: true,  // 寮€鍚?ITN
          enable_semantic_sentence_detection: true,  // 璇箟鏂彞
        };
        console.log('馃數 璇嗗埆鍙傛暟:', startParams);
        console.log('鈿狅笍 娉ㄦ剰锛氬疄鏃跺綍闊充笉鏀寔璇磋瘽浜哄垎绂伙紝濡傞渶鍖哄垎璇磋瘽浜鸿浣跨敤鏂囦欢涓婁紶');
        
        // 鍚姩璇嗗埆锛坋nablePing=true 淇濇寔杩炴帴娲昏穬锛宲ingInterval=6000ms锛?        await st.start(startParams, true, 6000);

        // 鍙戦€侀煶棰戞暟鎹?        const chunkSize = 1024;
        const delay = 20;
        for (let i = 0; i < audioData.length; i += chunkSize) {
          if (errorOccurred) {
            throw errorOccurred;
          }
          const chunk = audioData.slice(i, i + chunkSize);
          if (!st.sendAudio(chunk)) {
            throw new Error('鍙戦€侀煶棰戞暟鎹け璐?);
          }
          if (i + chunkSize < audioData.length) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }

        // 鍏抽棴璇嗗埆
        await st.close();

        // 绛夊緟缁撴灉
        const maxWaitTime = 10000;
        const startTime = Date.now();
        while (!isCompleted && !errorOccurred && (Date.now() - startTime) < maxWaitTime) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        st.shutdown();

        if (errorOccurred) {
          throw errorOccurred;
        }

        if (!finalResult) {
          throw new Error('璇嗗埆瓒呮椂鎴栨湭杩斿洖缁撴灉');
        }
      } catch (error) {
        console.error('娴佸紡杞啓閿欒:', error);
        const errorMessage = error instanceof Error ? error.message : '鏈煡閿欒';
        const message = `data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`;
        controller.enqueue(encoder.encode(message));
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
