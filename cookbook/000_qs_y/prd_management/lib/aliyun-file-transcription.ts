'use strict';

// 浣跨敤闃块噷浜戝畼鏂?SDK锛欯alicloud/nls-filetrans-2018-08-17
// 鍙傝€冩枃妗ｏ細https://help.aliyun.com/zh/isi/developer-reference/node-js-demo

// 褰曢煶鏂囦欢璇嗗埆浠诲姟鐘舵€?export type TranscriptionTaskStatus = 'QUEUING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

// 璇磋瘽浜哄垎娈?export interface TranscriptionSegment {
  speakerId: number;
  text: string;
  beginTime: number; // 姣
  endTime: number;   // 姣
}

export interface TranscriptionTask {
  taskId: string;
  status: TranscriptionTaskStatus;
  result?: string;
  segments?: TranscriptionSegment[]; // 璇磋瘽浜哄垎娈电粨鏋?  error?: string;
}

// 鍔ㄦ€佸鍏?SDK锛堥伩鍏嶅鎴风鎵撳寘闂锛?async function getClient() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Client = require('@alicloud/nls-filetrans-2018-08-17');
  return Client;
}

// 鑾峰彇鍖哄煙閰嶇疆
function getRegion(): string {
  let regionId = process.env.ALIYUN_FILE_TRANSCRIBE_REGION || process.env.ALIYUN_OSS_REGION || 'cn-hangzhou';
  
  // 濡傛灉鍖哄煙鏍煎紡鏄?oss-cn-xxx锛屾彁鍙?cn-xxx
  if (regionId.startsWith('oss-')) {
    regionId = regionId.replace('oss-', '');
  }
  
  return regionId;
}

// 鎻愪氦褰曢煶鏂囦欢璇嗗埆浠诲姟
export async function submitFileTranscriptionTask(
  fileUrl: string
): Promise<{ taskId: string }> {
  const appKey = process.env.ALIYUN_ASR_APP_KEY?.trim();
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;

  if (!appKey) {
    throw new Error('闃块噷浜?AppKey 鏈厤缃?);
  }
  if (!accessKeyId || !accessKeySecret) {
    throw new Error('闃块噷浜?AccessKey 鏈厤缃?);
  }

  const regionId = getRegion();
  
  // 鍦板煙 ID 瀵瑰簲鐨?Endpoint
  const ENDPOINT = `http://filetrans.${regionId}.aliyuncs.com`;
  const API_VERSION = '2018-08-17';

  console.log('馃數 鎻愪氦褰曢煶鏂囦欢璇嗗埆浠诲姟:');
  console.log('  - Endpoint:', ENDPOINT);
  console.log('  - API Version:', API_VERSION);
  console.log('  - AppKey:', appKey);
  console.log('  - FileUrl:', fileUrl);

  // 鍒涘缓闃块噷浜戦壌鏉?client
  const Client = await getClient();
  const client = new Client({
    accessKeyId: accessKeyId,
    secretAccessKey: accessKeySecret,
    endpoint: ENDPOINT,
    apiVersion: API_VERSION
  });

  // 鏋勫缓 task 鍙傛暟锛圝SON 瀛楃涓诧級
  const task = {
    appkey: appKey,
    file_link: fileUrl,
    version: '4.0',              // 鏂版帴鍏ヨ浣跨敤 4.0 鐗堟湰
    enable_words: true,           // 杈撳嚭璇嶄俊鎭紙鍖呭惈鏃堕棿鎴筹級
    enable_punctuation_prediction: true,  // 鍚敤鏍囩偣绗﹀彿棰勬祴
    enable_inverse_text_normalization: true,  // 鍚敤 ITN
    // 璇磋瘽浜哄垎绂伙紙Speaker Diarization锛?    enable_diarization: true,     // 寮€鍚璇濅汉鍒嗙
    speaker_count: 0,             // 0 琛ㄧず鑷姩妫€娴嬭璇濅汉鏁伴噺
    // 璇箟鏂彞
    enable_semantic_sentence_detection: true,
  };

  const taskString = JSON.stringify(task);
  console.log('  - Task:', taskString);

  const taskParams = {
    Task: taskString
  };

  const options = {
    method: 'POST'
  };

  try {
    // 鎻愪氦褰曢煶鏂囦欢璇嗗埆璇锋眰
    const response = await client.submitTask(taskParams, options);
    console.log('馃煝 鎻愪氦浠诲姟鍝嶅簲:', JSON.stringify(response, null, 2));

    // 鏈嶅姟绔搷搴斾俊鎭殑鐘舵€佹弿杩?StatusText
    const statusText = response.StatusText;
    if (statusText !== 'SUCCESS') {
      throw new Error(`褰曢煶鏂囦欢璇嗗埆璇锋眰鍝嶅簲澶辫触: ${statusText} - ${response.Message || ''}`);
    }

    console.log('馃煝 褰曢煶鏂囦欢璇嗗埆璇锋眰鍝嶅簲鎴愬姛!');
    
    // 鑾峰彇浠诲姟 ID
    const taskId = response.TaskId;
    if (!taskId) {
      throw new Error('鏈幏鍙栧埌 TaskId');
    }

    return { taskId };
  } catch (error) {
    console.error('鉂?鎻愪氦浠诲姟澶辫触:', error);
    throw error;
  }
}

// 鏌ヨ璇嗗埆浠诲姟鐘舵€?export async function getTranscriptionTaskStatus(
  taskId: string
): Promise<TranscriptionTask> {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;

  if (!accessKeyId || !accessKeySecret) {
    throw new Error('闃块噷浜?AccessKey 鏈厤缃?);
  }

  const regionId = getRegion();
  
  // 鍦板煙 ID 瀵瑰簲鐨?Endpoint
  const ENDPOINT = `http://filetrans.${regionId}.aliyuncs.com`;
  const API_VERSION = '2018-08-17';

  // 鍒涘缓闃块噷浜戦壌鏉?client
  const Client = await getClient();
  const client = new Client({
    accessKeyId: accessKeyId,
    secretAccessKey: accessKeySecret,
    endpoint: ENDPOINT,
    apiVersion: API_VERSION
  });

  const taskIdParams = {
    TaskId: taskId
  };

  try {
    // 鏌ヨ浠诲姟缁撴灉
    const response = await client.getTaskResult(taskIdParams);
    console.log('馃數 鏌ヨ浠诲姟鐘舵€佸搷搴?', JSON.stringify(response, null, 2));

    const statusText = response.StatusText;

    // 瑙ｆ瀽浠诲姟鐘舵€?    let status: TranscriptionTaskStatus;
    if (statusText === 'SUCCESS' || statusText === 'SUCCESS_WITH_NO_VALID_FRAGMENT') {
      status = 'SUCCESS';
    } else if (statusText === 'RUNNING') {
      status = 'RUNNING';
    } else if (statusText === 'QUEUEING') {
      status = 'QUEUING';
    } else {
      status = 'FAILED';
    }

    const result: TranscriptionTask = {
      taskId,
      status,
    };

    // 濡傛灉浠诲姟鎴愬姛锛屾彁鍙栬瘑鍒粨鏋?    if (status === 'SUCCESS') {
      if (response.Result) {
        try {
          // Result 鍙兘鏄?Sentences 鏁扮粍锛堝寘鍚璇濅汉淇℃伅锛?          const sentences = response.Result.Sentences || response.Result;
          console.log('馃數 瑙ｆ瀽璇嗗埆缁撴灉锛屽彞瀛愭暟:', Array.isArray(sentences) ? sentences.length : 'N/A');
          
          if (Array.isArray(sentences)) {
            // 鎻愬彇璇磋瘽浜哄垎娈?            const segments: TranscriptionSegment[] = sentences.map((s: {
              Text?: string;
              BeginTime?: number;
              EndTime?: number;
              SpeakerId?: number | string;
              ChannelId?: number;
            }) => ({
              speakerId: typeof s.SpeakerId === 'number' ? s.SpeakerId : 
                        typeof s.SpeakerId === 'string' ? parseInt(s.SpeakerId, 10) : 
                        s.ChannelId ?? 0,
              text: s.Text || '',
              beginTime: s.BeginTime || 0,
              endTime: s.EndTime || 0
            })).filter((seg: TranscriptionSegment) => seg.text.trim());
            
            result.segments = segments;
            
            // 鍚屾椂鐢熸垚绾枃鏈粨鏋?            result.result = segments
              .map((seg: TranscriptionSegment) => seg.text)
              .join('');
              
            console.log('馃數 鎻愬彇鍒?, segments.length, '涓璇濅汉鍒嗘');
            if (segments.length > 0) {
              const speakerIds = new Set(segments.map(s => s.speakerId));
              console.log('馃數 璇磋瘽浜烘暟閲?', speakerIds.size, '锛岃璇濅汉 ID:', Array.from(speakerIds));
            }
          } else if (typeof sentences === 'string') {
            result.result = sentences;
          } else {
            result.result = JSON.stringify(sentences);
          }
        } catch (e) {
          console.error('瑙ｆ瀽璇嗗埆缁撴灉澶辫触:', e);
          result.result = JSON.stringify(response.Result);
        }
      }
    } else if (status === 'FAILED') {
      result.error = response.Message || response.StatusText || '璇嗗埆澶辫触';
    }

    return result;
  } catch (error) {
    console.error('鉂?鏌ヨ浠诲姟鐘舵€佸け璐?', error);
    throw error;
  }
}

// 杞鑾峰彇璇嗗埆缁撴灉锛堝甫瓒呮椂锛? 杩斿洖瀹屾暣缁撴灉锛堝惈璇磋瘽浜哄垎娈碉級
export async function pollTranscriptionResult(
  taskId: string,
  options: {
    interval?: number; // 杞闂撮殧锛堟绉掞級锛岄粯璁?3 绉?    timeout?: number; // 瓒呮椂鏃堕棿锛堟绉掞級锛岄粯璁?5 鍒嗛挓
    onProgress?: (status: TranscriptionTaskStatus) => void;
  } = {}
): Promise<TranscriptionTask> {
  const interval = options.interval || 3000;  // 瀹樻柟绀轰緥浣跨敤 10 绉掞紝杩欓噷鐢?3 绉?  const timeout = options.timeout || 5 * 60 * 1000;
  const startTime = Date.now();

  console.log('馃數 寮€濮嬭疆璇㈣瘑鍒粨鏋? TaskId:', taskId);

  while (true) {
    // 妫€鏌ヨ秴鏃?    if (Date.now() - startTime > timeout) {
      throw new Error('璇嗗埆浠诲姟瓒呮椂');
    }

    // 鏌ヨ浠诲姟鐘舵€?    const task = await getTranscriptionTaskStatus(taskId);

    // 璋冪敤杩涘害鍥炶皟
    if (options.onProgress) {
      options.onProgress(task.status);
    }

    console.log(`  - 褰撳墠鐘舵€? ${task.status}`);

    // 濡傛灉浠诲姟鎴愬姛锛岃繑鍥炲畬鏁寸粨鏋滐紙鍖呭惈璇磋瘽浜哄垎娈碉級
    if (task.status === 'SUCCESS') {
      console.log('馃煝 璇嗗埆瀹屾垚!');
      console.log('  - 绾枃鏈暱搴?', task.result?.length || 0);
      console.log('  - 璇磋瘽浜哄垎娈垫暟:', task.segments?.length || 0);
      return task;
    }

    // 濡傛灉浠诲姟澶辫触锛屾姏鍑洪敊璇?    if (task.status === 'FAILED') {
      throw new Error(task.error || '璇嗗埆浠诲姟澶辫触');
    }

    // 濡傛灉浠诲姟杩樺湪杩涜涓紝绛夊緟鍚庣户缁疆璇?    await new Promise(resolve => setTimeout(resolve, interval));
  }
}
