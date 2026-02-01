// 璇煶杞枃鏈湇鍔℃帴鍙?export interface TranscriptionProvider {
  transcribe(audioFile: File): Promise<string>;
  getName(): string;
}

// OpenAI Whisper 瀹炵幇
class OpenAIWhisperProvider implements TranscriptionProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  getName(): string {
    return 'OpenAI Whisper';
  }

  async transcribe(audioFile: File): Promise<string> {
    const formData = new FormData();
    formData.append('file', audioFile);
    formData.append('model', 'whisper-1');
    formData.append('language', 'zh');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `璇煶杞啓澶辫触: ${response.statusText}`;
      
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error) {
          const apiError = errorData.error;
          
          if (apiError.code === 'insufficient_quota') {
            errorMessage = 'OpenAI API 閰嶉涓嶈冻锛岃妫€鏌ユ偍鐨勮处鎴蜂綑棰濆拰璁¤垂璁剧疆銆?;
          } else if (apiError.code === 'invalid_api_key') {
            errorMessage = 'OpenAI API Key 鏃犳晥锛岃妫€鏌?OPENAI_API_KEY 鐜鍙橀噺閰嶇疆銆?;
          } else if (apiError.code === 'rate_limit_exceeded') {
            errorMessage = 'OpenAI API 璇锋眰棰戠巼杩囬珮锛岃绋嶅悗鍐嶈瘯銆?;
          } else if (apiError.message) {
            errorMessage = `OpenAI API 閿欒: ${apiError.message}`;
          }
        }
      } catch {
        errorMessage = `璇煶杞啓 API 閿欒: ${response.statusText}`;
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data.text;
  }
}

// 闃块噷浜戣闊宠瘑鍒疄鐜?class AliyunASRProvider implements TranscriptionProvider {
  private accessKeyId: string;
  private accessKeySecret: string;
  private appKey: string;

  constructor(accessKeyId: string, accessKeySecret: string, appKey: string) {
    this.accessKeyId = accessKeyId;
    this.accessKeySecret = accessKeySecret;
    this.appKey = appKey;
  }

  getName(): string {
    return '闃块噷浜戣闊宠瘑鍒?;
  }

  async transcribe(audioFile: File): Promise<string> {
    try {
      // 浣跨敤闃块噷浜戝畼鏂?Node.js SDK 杩涜瀹炴椂璇煶璇嗗埆
      // 鏂囨。锛歨ttps://help.aliyun.com/zh/isi/developer-reference/sdk-for-node-js
      
      // 1. 鑾峰彇 Token
      let token: string;
      
      if (typeof window === 'undefined') {
        // 鏈嶅姟绔幆澧冿細鐩存帴璋冪敤鍑芥暟
        const { generateAliyunToken } = await import('./aliyun-token');
        const tokenData = await generateAliyunToken();
        token = tokenData.token;
      } else {
        // 瀹㈡埛绔幆澧冿細閫氳繃 API 璋冪敤
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
        const tokenResponse = await fetch(`${baseUrl}/api/aliyun/token`);
        if (!tokenResponse.ok) {
          const error = await tokenResponse.json();
          throw new Error(`鑾峰彇 Token 澶辫触: ${error.error || '鏈煡閿欒'}`);
        }
        const tokenData = await tokenResponse.json();
        token = tokenData.token;
      }

      // 楠岃瘉 appkey
      if (!this.appKey || this.appKey.trim() === '') {
        throw new Error('闃块噷浜?AppKey 鏈厤缃垨涓虹┖锛岃璁剧疆 ALIYUN_ASR_APP_KEY 鐜鍙橀噺');
      }

      // 2. 璇诲彇闊抽鏂囦欢骞惰浆鎹负 Buffer
      // 娉ㄦ剰锛氬疄鏃惰瘑鍒彧鏀寔 PCM 鏍煎紡鐨勫師濮嬮煶棰戞暟鎹?      // 濡傛灉杈撳叆鏄帇缂╂牸寮忥紙webm, mp3, m4a 绛夛級锛岄渶瑕佸厛杞崲涓?PCM
      const audioBuffer = await audioFile.arrayBuffer();
      const audioData = Buffer.from(audioBuffer);

      // 3. 浣跨敤闃块噷浜?SDK 杩涜瀹炴椂璇煶璇嗗埆
      // 娉ㄦ剰锛歋DK 鍙兘鍦ㄦ湇鍔＄浣跨敤锛圢ode.js 鐜锛?      if (typeof window !== 'undefined') {
        throw new Error('闃块噷浜?SDK 鍙兘鍦ㄦ湇鍔＄浣跨敤锛岃閫氳繃 API 璺敱璋冪敤');
      }

      // 鍔ㄦ€佸鍏?SDK锛堜粎鍦ㄦ湇鍔＄锛?      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Nls = require('alibabacloud-nls');
      const { SpeechTranscription } = Nls;

      // WebSocket URL
      const URL = 'wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1';

      // 鍒涘缓璇嗗埆瀹炰緥
      const st = new SpeechTranscription({
        url: URL,
        appkey: this.appKey.trim(),
        token: token,
      });

      // 鏀堕泦璇嗗埆缁撴灉
      let finalResult = '';
      let isCompleted = false;
      let errorOccurred: Error | null = null;

      // 璁剧疆浜嬩欢鍥炶皟
      st.on('started', (msg: string) => {
        console.log('馃數 闃块噷浜戣瘑鍒紑濮?', msg);
      });

      st.on('changed', (msg: string) => {
        // 涓棿缁撴灉
        try {
          const data = JSON.parse(msg);
          if (data.payload && data.payload.result) {
            console.log('馃數 涓棿缁撴灉:', data.payload.result);
          }
        } catch {
          // 蹇界暐瑙ｆ瀽閿欒
        }
      });

      st.on('completed', (msg: string) => {
        console.log('鉁?闃块噷浜戣瘑鍒畬鎴?', msg);
        try {
          const data = JSON.parse(msg);
          if (data.payload && data.payload.result) {
            finalResult = data.payload.result;
          } else if (data.result) {
            finalResult = data.result;
          }
        } catch {
          // 濡傛灉瑙ｆ瀽澶辫触锛屽皾璇曠洿鎺ヤ娇鐢?msg
          finalResult = msg;
        }
        isCompleted = true;
      });

      st.on('closed', () => {
        console.log('馃數 杩炴帴宸插叧闂?);
        if (!isCompleted && !errorOccurred) {
          isCompleted = true;
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
        isCompleted = true;
      });

      st.on('begin', (msg: string) => {
        console.log('馃數 鍙ュ瓙寮€濮?', msg);
      });

      st.on('end', (msg: string) => {
        console.log('馃數 鍙ュ瓙缁撴潫:', msg);
      });

      // 鑾峰彇榛樿鍙傛暟骞惰皟鏁存牸寮?      // 娉ㄦ剰锛氬疄鏃惰瘑鍒紙SpeechTranscription锛夊彧鏀寔 PCM 鏍煎紡鐨勫師濮嬮煶棰戞暟鎹?      // 涓嶆敮鎸佸帇缂╂牸寮忥紙webm, mp3, m4a 绛夛級
      const originalFormat = this.getAudioFormat(audioFile.name);
      const sampleRate = 16000; // 榛樿閲囨牱鐜?      
      // 瀹炴椂璇嗗埆蹇呴』浣跨敤 PCM 鏍煎紡
      // 濡傛灉杈撳叆鏄帇缂╂牸寮忥紝浼氳繑鍥?UNSUPPORTED_FORMAT 閿欒
      const format = 'pcm';
      
      // 妫€鏌ユ牸寮忓吋瀹规€?      if (originalFormat !== 'pcm' && originalFormat !== 'wav') {
        throw new Error(
          `闊抽鏍煎紡涓嶆敮鎸侊細瀹炴椂璇嗗埆鍙敮鎸?PCM 鏍煎紡锛屽綋鍓嶆牸寮忎负 ${originalFormat}銆俓n` +
          `瑙ｅ喅鏂规锛歕n` +
          `1. 鍦ㄦ祻瑙堝櫒绔綍闊虫椂浣跨敤 PCM 鏍煎紡锛堟帹鑽愶級\n` +
          `2. 鎴栦娇鐢ㄥ綍闊虫枃浠惰瘑鍒帴鍙ｏ紙闇€瑕佸厛涓婁紶鍒?OSS锛塡n` +
          `3. 鎴栧厛灏嗛煶棰戣浆鎹负 PCM 鏍煎紡`
        );
      }
      
      // 濡傛灉鏄?WAV 鏍煎紡锛岄渶瑕佹彁鍙?PCM 鏁版嵁锛圵AV 鏂囦欢鍖呭惈澶撮儴淇℃伅锛?      // 杩欓噷鍋囪杈撳叆鐨?WAV 鏂囦欢宸茬粡鏄函 PCM 鏁版嵁锛屾垨鑰呴渶瑕佽В鏋?WAV 澶撮儴
      // 瀵逛簬瀹炴椂璇嗗埆锛屽簲璇ョ洿鎺ヤ娇鐢?PCM 鍘熷鏁版嵁
      
      // 鏍规嵁鏂囨。锛岀洿鎺ユ瀯寤哄弬鏁板璞?      const params: Record<string, unknown> = {
        format: format,
        sample_rate: sampleRate,
        enable_intermediate_result: true,
        enable_punctuation_prediction: true,
        enable_inverse_text_normalization: true,
      };
      
      console.log('馃數 璇嗗埆鍙傛暟:', {
        format,
        originalFormat,
        sampleRate,
        audioSize: audioData.length,
      });

      // 鍚姩璇嗗埆
      console.log('馃數 鍚姩闃块噷浜戣闊宠瘑鍒?..');
      await st.start(params, false, 6000);

      // 灏嗛煶棰戞暟鎹垎鍧楀彂閫侊紙姣忓潡 1024 瀛楄妭锛屽欢杩?20ms锛?      const chunkSize = 1024;
      const delay = 20; // 姣

      for (let i = 0; i < audioData.length; i += chunkSize) {
        if (errorOccurred) {
          throw errorOccurred;
        }
        
        const chunk = audioData.slice(i, i + chunkSize);
        if (!st.sendAudio(chunk)) {
          throw new Error('鍙戦€侀煶棰戞暟鎹け璐?);
        }
        
        // 寤惰繜鍙戦€佷笅涓€鍧楋紙妯℃嫙瀹炴椂娴侊級
        if (i + chunkSize < audioData.length) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      // 鍏抽棴璇嗗埆
      console.log('馃數 鍏抽棴璇嗗埆...');
      await st.close();

      // 绛夊緟缁撴灉锛堟渶澶氱瓑寰?10 绉掞級
      const maxWaitTime = 10000; // 10 绉?      const startTime = Date.now();
      
      while (!isCompleted && !errorOccurred && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 寮哄埗鍏抽棴杩炴帴
      st.shutdown();

      // 妫€鏌ラ敊璇?      if (errorOccurred) {
        throw errorOccurred;
      }

      // 妫€鏌ユ槸鍚︽湁缁撴灉
      if (!finalResult) {
        throw new Error('璇嗗埆瓒呮椂鎴栨湭杩斿洖缁撴灉');
      }

      console.log('鉁?璇嗗埆鎴愬姛锛岀粨鏋滈暱搴?', finalResult.length);
      return finalResult;
    } catch (error) {
      console.error('闃块噷浜戣闊宠瘑鍒敊璇?', error);
      throw error;
    }
  }

  // 鏍规嵁鏂囦欢鍚嶈幏鍙栭煶棰戞牸寮?  private getAudioFormat(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const formatMap: Record<string, string> = {
      'wav': 'wav',
      'mp3': 'mp3',
      'm4a': 'm4a',
      'flac': 'flac',
      'opus': 'opus',
      'webm': 'webm',
    };
    return formatMap[ext || ''] || 'wav';
  }
}

// 鑵捐浜戣闊宠瘑鍒疄鐜?class TencentASRProvider implements TranscriptionProvider {
  private secretId: string;
  private secretKey: string;
  private appId: string;

  constructor(secretId: string, secretKey: string, appId: string) {
    this.secretId = secretId;
    this.secretKey = secretKey;
    this.appId = appId;
  }

  getName(): string {
    return '鑵捐浜戣闊宠瘑鍒?;
  }

  async transcribe(audioFile: File): Promise<string> {
    // 鑵捐浜戣闊宠瘑鍒疄鐜?    // 闇€瑕佸畨瑁?tencentcloud-sdk-nodejs 鎴栦娇鐢?REST API
    // 杩欓噷鎻愪緵鍩烘湰妗嗘灦锛屽疄闄呴渶瑕佹牴鎹吘璁簯 SDK 瀹炵幇
    
    const audioBuffer = await audioFile.arrayBuffer();
    
    // 浣跨敤鑵捐浜?API锛堥渶瑕佹牴鎹疄闄?API 鏂囨。璋冩暣锛?    const response = await fetch('https://asr.tencentcloudapi.com/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TC-Action': 'SentenceRecognition',
        'X-TC-Version': '2019-06-14',
      },
      body: JSON.stringify({
        ProjectId: 0,
        SubServiceType: 2,
        EngSerViceType: '16k_zh',
        SourceType: 1,
        VoiceFormat: 'wav',
        UsrAudioKey: 'test',
        Data: typeof Buffer !== 'undefined' 
          ? Buffer.from(audioBuffer).toString('base64')
          : btoa(String.fromCharCode(...new Uint8Array(audioBuffer))),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`鑵捐浜戣闊宠瘑鍒け璐? ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data.Response.Result || '';
  }
}

// 鐧惧害璇煶璇嗗埆瀹炵幇
class BaiduASRProvider implements TranscriptionProvider {
  private apiKey: string;
  private secretKey: string;

  constructor(apiKey: string, secretKey: string) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
  }

  getName(): string {
    return '鐧惧害璇煶璇嗗埆';
  }

  async transcribe(audioFile: File): Promise<string> {
    // 鐧惧害璇煶璇嗗埆闇€瑕佸厛鑾峰彇 access_token
    const accessToken = await this.getAccessToken();
    
    const audioBuffer = await audioFile.arrayBuffer();
    const base64Audio = typeof Buffer !== 'undefined' 
      ? Buffer.from(audioBuffer).toString('base64')
      : btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));

    const response = await fetch(
      `https://vop.baidu.com/server_api?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          format: 'wav',
          rate: 16000,
          channel: 1,
          cuid: 'prd-builder',
          len: audioBuffer.byteLength,
          speech: base64Audio,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`鐧惧害璇煶璇嗗埆澶辫触: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    if (data.err_no !== 0) {
      throw new Error(`鐧惧害璇煶璇嗗埆閿欒: ${data.err_msg || '鏈煡閿欒'}`);
    }
    return data.result?.[0] || '';
  }

  private async getAccessToken(): Promise<string> {
    const response = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${this.apiKey}&client_secret=${this.secretKey}`,
      { method: 'POST' }
    );
    const data = await response.json();
    return data.access_token;
  }
}

// 鏅鸿氨AI 璇煶璇嗗埆锛堝鏋滄敮鎸侊級
class ZhipuASRProvider implements TranscriptionProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  getName(): string {
    return '鏅鸿氨AI';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async transcribe(_audioFile: File): Promise<string> {
    // 娉ㄦ剰锛氭櫤璋盇I 涓昏鎻愪緵澶фā鍨嬫湇鍔★紝鍙兘涓嶇洿鎺ユ彁渚涜闊宠浆鏂囨湰
    // 杩欓噷鎻愪緵妗嗘灦锛屽鏋滄櫤璋盇I 鏈夌浉鍏虫湇鍔★紝鍙互鍦ㄦ瀹炵幇
    throw new Error('鏅鸿氨AI 鏆備笉鏀寔璇煶杞枃鏈湇鍔★紝璇蜂娇鐢ㄥ叾浠栨湇鍔℃彁渚涘晢');
  }
}

// 宸ュ巶鍑芥暟锛氭牴鎹厤缃垱寤哄搴旂殑鏈嶅姟鎻愪緵鍟?export function createTranscriptionProvider(): TranscriptionProvider {
  const provider = process.env.TRANSCRIBE_PROVIDER || 'openai';

  switch (provider.toLowerCase()) {
    case 'openai':
    case 'whisper': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OpenAI API Key 鏈厤缃紝璇疯缃?OPENAI_API_KEY 鐜鍙橀噺');
      }
      return new OpenAIWhisperProvider(apiKey);
    }

    case 'aliyun':
    case 'ali': {
      const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
      const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
      const appKey = process.env.ALIYUN_ASR_APP_KEY;
      
      if (!accessKeyId || accessKeyId.trim() === '') {
        throw new Error('闃块噷浜戦厤缃笉瀹屾暣锛欰LIYUN_ACCESS_KEY_ID 鏈缃垨涓虹┖');
      }
      if (!accessKeySecret || accessKeySecret.trim() === '') {
        throw new Error('闃块噷浜戦厤缃笉瀹屾暣锛欰LIYUN_ACCESS_KEY_SECRET 鏈缃垨涓虹┖');
      }
      if (!appKey || appKey.trim() === '') {
        throw new Error('闃块噷浜戦厤缃笉瀹屾暣锛欰LIYUN_ASR_APP_KEY 鏈缃垨涓虹┖');
      }
      
      console.log('鉁?闃块噷浜戦厤缃鏌ラ€氳繃:', {
        accessKeyId: accessKeyId.substring(0, 5) + '...',
        accessKeySecret: accessKeySecret.substring(0, 5) + '...',
        appKey: appKey.substring(0, 10) + '...',
        appKey_length: appKey.length,
      });
      
      return new AliyunASRProvider(accessKeyId.trim(), accessKeySecret.trim(), appKey.trim());
    }

    case 'tencent':
    case 'qcloud': {
      const secretId = process.env.TENCENT_SECRET_ID;
      const secretKey = process.env.TENCENT_SECRET_KEY;
      const appId = process.env.TENCENT_ASR_APP_ID;
      
      if (!secretId || !secretKey || !appId) {
        throw new Error('鑵捐浜戦厤缃笉瀹屾暣锛岄渶瑕?TENCENT_SECRET_ID, TENCENT_SECRET_KEY, TENCENT_ASR_APP_ID');
      }
      return new TencentASRProvider(secretId, secretKey, appId);
    }

    case 'baidu': {
      const apiKey = process.env.BAIDU_ASR_API_KEY;
      const secretKey = process.env.BAIDU_ASR_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        throw new Error('鐧惧害璇煶璇嗗埆閰嶇疆涓嶅畬鏁达紝闇€瑕?BAIDU_ASR_API_KEY, BAIDU_ASR_SECRET_KEY');
      }
      return new BaiduASRProvider(apiKey, secretKey);
    }

    case 'zhipu': {
      const apiKey = process.env.ZHIPU_API_KEY;
      if (!apiKey) {
        throw new Error('鏅鸿氨AI API Key 鏈厤缃紝璇疯缃?ZHIPU_API_KEY 鐜鍙橀噺');
      }
      return new ZhipuASRProvider(apiKey);
    }

    default:
      throw new Error(`涓嶆敮鎸佺殑璇煶杞枃鏈湇鍔℃彁渚涘晢: ${provider}`);
  }
}

// Mock 杞啓鎻愪緵鑰?class MockTranscriptionProvider implements TranscriptionProvider {
  getName(): string {
    return 'Mock (娴嬭瘯妯″紡)';
  }

  async transcribe(audioFile: File): Promise<string> {
    const { mockTranscribeAudio } = await import('./mock');
    return mockTranscribeAudio(audioFile);
  }
}

// 瀵煎嚭缁熶竴鐨勮浆鍐欏嚱鏁?export async function transcribeAudio(audioFile: File): Promise<string> {
  // 濡傛灉鍚敤浜?MOCK 妯″紡锛屼娇鐢?mock 鎻愪緵鑰?  if (process.env.USE_MOCK === 'true') {
    console.log('馃敡 浣跨敤 Mock 妯″紡杩涜璇煶杞啓');
    const mockProvider = new MockTranscriptionProvider();
    return mockProvider.transcribe(audioFile);
  }

  const provider = createTranscriptionProvider();
  console.log(`浣跨敤 ${provider.getName()} 杩涜璇煶杞啓`);
  return provider.transcribe(audioFile);
}
