'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Upload, Loader2, ScrollText, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// 璇磋瘽浜哄垎娈电粨鏋?interface TranscriptionSegment {
  id: string;
  speakerId: number;
  text: string;
  beginTime: number; // 姣
  endTime: number;   // 姣
  isIntermediate: boolean; // 鏄惁鏄腑闂寸粨鏋?}

// 鍒嗙墖浠诲姟鐘舵€?interface SegmentTask {
  index: number;
  startTime: number;
  endTime: number;
  status: 'pending' | 'uploading' | 'transcribing' | 'summarizing' | 'completed' | 'error';
  progress?: string;
  error?: string;
}

// 璇磋瘽浜洪鑹查厤缃?const SPEAKER_COLORS = [
  { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-300', badge: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' },
  { bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-green-200 dark:border-green-800', text: 'text-green-700 dark:text-green-300', badge: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' },
  { bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-purple-200 dark:border-purple-800', text: 'text-purple-700 dark:text-purple-300', badge: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300' },
  { bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-700 dark:text-orange-300', badge: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300' },
  { bg: 'bg-pink-50 dark:bg-pink-950/30', border: 'border-pink-200 dark:border-pink-800', text: 'text-pink-700 dark:text-pink-300', badge: 'bg-pink-100 dark:bg-pink-900 text-pink-700 dark:text-pink-300' },
];

// 鏍煎紡鍖栨椂闂存埑 (姣 -> MM:SS)
function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

interface RecordingPanelProps {
  onTranscriptionUpdate: (text: string) => void;
  onSummaryGenerated: (summary: string, timestamp: number) => void;
  projectId?: string;
}

export function RecordingPanel({ 
  onTranscriptionUpdate, 
  onSummaryGenerated,
  projectId 
}: RecordingPanelProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSupported, setIsSupported] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]); // 璇磋瘽浜哄垎娈?  
  // 鍒嗙墖浠诲姟鐘舵€?  const [segmentTasks, setSegmentTasks] = useState<SegmentTask[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string>(''); // 涓婁紶鐘舵€佹彁绀?
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmDataRef = useRef<Int16Array[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const summaryIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const accumulatedTextRef = useRef<string>(''); // 宸茬‘璁ょ殑鏂囨湰
  const currentIntermediateRef = useRef<string>(''); // 褰撳墠涓棿缁撴灉
  const currentIntermediateSegmentRef = useRef<TranscriptionSegment | null>(null); // 褰撳墠涓棿缁撴灉鍒嗘
  const mockSummaryIndexRef = useRef<number>(0);
  const transcriptionScrollRef = useRef<HTMLDivElement | null>(null);
  const recordingTimeRef = useRef<number>(0); // 鐢ㄤ簬鍦ㄥ洖璋冧腑鑾峰彇鏈€鏂板綍闊虫椂闀?  const lastSummaryTextLengthRef = useRef<number>(0); // 涓婃鎬荤粨鏃剁殑鏂囨湰闀垮害锛堢敤浜庡閲忚绠楋級
  const segmentIdRef = useRef<number>(0); // 鍒嗘 ID 璁℃暟鍣?  const summaryCountRef = useRef<number>(0); // 鎬荤粨娆℃暟璁℃暟
  
  // WebSocket 鐩磋繛闃块噷浜戯紙鐪熸鐨勬祦寮忚瘑鍒級
  const wsRef = useRef<WebSocket | null>(null);
  const wsReadyRef = useRef<boolean>(false);
  const taskIdRef = useRef<string>('');

  // 鐢熸垚 32 浣?hex 瀛楃涓诧紙闃块噷浜戣姹傜殑娑堟伅 ID 鏍煎紡锛屼笉甯﹁繛瀛楃锛?  function generateMessageId(): string {
    // 纭繚鐢熸垚 32 浣?hex 瀛楃涓?    let id = '';
    for (let i = 0; i < 32; i++) {
      id += Math.floor(Math.random() * 16).toString(16);
    }
    return id;
  }

  // 鍒濆鍖?WebSocket 杩炴帴鍒伴樋閲屼簯
  async function initWebSocket() {
    try {
      // 鑾峰彇 Token 鍜岃繛鎺ヤ俊鎭?      const response = await fetch('/api/aliyun/token');
      if (!response.ok) {
        throw new Error('鑾峰彇 Token 澶辫触');
      }
      const { token, appKey, wsUrl } = await response.json();
      
      console.log('馃數 杩炴帴闃块噷浜?WebSocket:', wsUrl);
      
      // 鐢熸垚 Task ID锛?2 浣?hex 瀛楃涓诧級
      taskIdRef.current = generateMessageId();
      
      // 鍒涘缓 WebSocket 杩炴帴
      const ws = new WebSocket(`${wsUrl}?token=${token}`);
      wsRef.current = ws;
      
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket 杩炴帴瓒呮椂'));
        }, 10000);
        
        ws.onopen = () => {
          console.log('馃煝 WebSocket 杩炴帴鎴愬姛');
          
          // 鍙戦€佸紑濮嬭瘑鍒寚浠?          const startMessage = {
            header: {
              message_id: generateMessageId(), // 娑堟伅 ID锛堟瘡鏉℃秷鎭敮涓€锛?              task_id: taskIdRef.current,  // 浠诲姟 ID锛堟暣涓細璇濆敮涓€锛?              namespace: 'SpeechTranscriber',
              name: 'StartTranscription',
              appkey: appKey
            },
            payload: {
              format: 'pcm',
              sample_rate: 16000,
              enable_intermediate_result: true,
              enable_punctuation_prediction: true,
              enable_inverse_text_normalization: true,
            }
          };
          
          ws.send(JSON.stringify(startMessage));
          console.log('馃數 鍙戦€佸紑濮嬭瘑鍒寚浠?);
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            const name = data.header?.name;
            
            if (name === 'TranscriptionStarted') {
              console.log('鉁?璇嗗埆宸插惎鍔?);
              wsReadyRef.current = true;
              clearTimeout(timeout);
              resolve();
            } else if (name === 'TranscriptionResultChanged') {
              // 涓棿缁撴灉锛堜細涓嶆柇绾犻敊锛?              const text = data.payload?.result || '';
              console.log('馃數 涓棿缁撴灉:', text);
              currentIntermediateRef.current = text;
              
              // 鏄剧ず锛氱疮绉枃鏈?+ 褰撳墠涓棿缁撴灉
              const displayText = accumulatedTextRef.current + text;
              setTranscription(displayText);
              onTranscriptionUpdate(displayText);
              
              // 婊氬姩鍒板簳閮?              if (transcriptionScrollRef.current) {
                transcriptionScrollRef.current.scrollTop = transcriptionScrollRef.current.scrollHeight;
              }
            } else if (name === 'SentenceEnd') {
              // 鍙ュ瓙缁撴潫锛堢‘璁ょ殑鏂囨湰锛?              const text = data.payload?.result || '';
              console.log('鉁?鍙ュ瓙纭:', text);
              
              // 杩藉姞鍒扮疮绉枃鏈?              accumulatedTextRef.current += text;
              currentIntermediateRef.current = '';
              
              setTranscription(accumulatedTextRef.current);
              onTranscriptionUpdate(accumulatedTextRef.current);
              
              // 婊氬姩鍒板簳閮?              if (transcriptionScrollRef.current) {
                transcriptionScrollRef.current.scrollTop = transcriptionScrollRef.current.scrollHeight;
              }
            } else if (name === 'TranscriptionCompleted') {
              console.log('馃弫 璇嗗埆瀹屾垚');
              wsReadyRef.current = false;
            } else if (name === 'TaskFailed') {
              console.error('鉂?璇嗗埆澶辫触:', data.header?.status_text);
              wsReadyRef.current = false;
            }
          } catch (e) {
            console.error('瑙ｆ瀽娑堟伅澶辫触:', e);
          }
        };
        
        ws.onerror = (error) => {
          console.error('鉂?WebSocket 閿欒:', error);
          wsReadyRef.current = false;
          clearTimeout(timeout);
          reject(error);
        };
        
        ws.onclose = () => {
          console.log('馃數 WebSocket 杩炴帴鍏抽棴');
          wsReadyRef.current = false;
        };
      });
    } catch (error) {
      console.error('鍒濆鍖?WebSocket 澶辫触:', error);
      throw error;
    }
  }

  // 鍏抽棴 WebSocket 杩炴帴
  function closeWebSocket() {
    if (wsRef.current) {
      try {
        if (wsReadyRef.current) {
          // 鍙戦€佸仠姝㈣瘑鍒寚浠?          const stopMessage = {
            header: {
              message_id: generateMessageId(), // 姣忔浣跨敤鏂扮殑 message_id
              task_id: taskIdRef.current,  // task_id 淇濇寔涓嶅彉
              namespace: 'SpeechTranscriber',
              name: 'StopTranscription'
            }
          };
          wsRef.current.send(JSON.stringify(stopMessage));
          console.log('馃數 鍙戦€佸仠姝㈣瘑鍒寚浠?);
        }
        wsRef.current.close();
      } catch (e) {
        console.error('鍏抽棴 WebSocket 澶辫触:', e);
      }
      wsRef.current = null;
      wsReadyRef.current = false;
    }
  }

  // 鏍囪缁勪欢宸叉寕杞斤紙瑙ｅ喅 Hydration 闂锛?  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 妫€鏌ユ祻瑙堝櫒鏄惁鏀寔褰曢煶鍔熻兘
  useEffect(() => {
    if (!isMounted) return;
    // 妫€鏌ユ槸鍚﹀惎鐢?Mock 妯″紡
    const useMock = typeof window !== 'undefined' && 
                   (process.env.NEXT_PUBLIC_USE_MOCK === 'true' || 
                    (window as any).USE_MOCK === 'true');
    
    if (useMock) {
      // Mock 妯″紡涓嬶紝璺宠繃娴忚鍣ㄦ敮鎸佹鏌ワ紝鐩存帴璁剧疆涓烘敮鎸?      setIsSupported(true);
      return;
    }

    if (isMounted && typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      try {
        const supported = !!(
          navigator?.mediaDevices &&
          typeof navigator.mediaDevices.getUserMedia === 'function' &&
          typeof window.MediaRecorder !== 'undefined'
        );
        setIsSupported(supported);
      } catch (error) {
        console.error('妫€鏌ユ祻瑙堝櫒鏀寔澶辫触:', error);
        setIsSupported(false);
      }
    } else {
      setIsSupported(false);
    }
  }, [isMounted]);

  useEffect(() => {
    if (isRecording) {
      // 閲嶇疆褰曢煶鏃堕暱鍜屾€荤粨鐩稿叧鐘舵€?      recordingTimeRef.current = 0;
      lastSummaryTextLengthRef.current = 0;
      summaryCountRef.current = 0;
      
      const timer = setInterval(() => {
        setRecordingTime((prev) => {
          const newTime = prev + 1;
          recordingTimeRef.current = newTime; // 鍚屾鏇存柊 ref
          return newTime;
        });
      }, 1000);

      // 姣?2 鍒嗛挓鐢熸垚涓€娆￠樁娈垫€ф€荤粨锛堝閲忔柟寮忥級
      const SUMMARY_INTERVAL = 2 * 60 * 1000; // 2 鍒嗛挓
      summaryIntervalRef.current = setInterval(() => {
        // 妫€鏌ユ槸鍚﹀惎鐢?Mock 妯″紡
        const useMock = typeof window !== 'undefined' && 
                       (process.env.NEXT_PUBLIC_USE_MOCK === 'true' || 
                        (window as any).USE_MOCK === 'true');
        
        const currentTime = recordingTimeRef.current;
        const fullText = accumulatedTextRef.current.trim();
        const lastLength = lastSummaryTextLengthRef.current;
        
        // 鑾峰彇澧為噺鏂囨湰锛堝彧鍙栨柊澧為儴鍒嗭級
        const incrementalText = fullText.substring(lastLength).trim();
        
        console.log('馃數 闃舵鎬ф€荤粨妫€鏌?', {
          useMock,
          currentTime,
          fullTextLength: fullText.length,
          lastLength,
          incrementalTextLength: incrementalText.length,
          summaryCount: summaryCountRef.current
        });
        
        if (useMock) {
          // Mock 妯″紡涓嬭嚜鍔ㄧ敓鎴愮畝鎶?          console.log('馃敡 Mock 妯″紡锛氱敓鎴愰樁娈垫€ф€荤粨 #' + (summaryCountRef.current + 1));
          generateMockSummary(currentTime);
          summaryCountRef.current++;
        } else if (incrementalText.length > 50) {
          // 鍙湁澧為噺鏂囨湰瓒呰繃 50 瀛楃鎵嶇敓鎴愭€荤粨锛堥伩鍏嶇┖鎬荤粨锛?          console.log('馃摑 鐢熸垚闃舵鎬ф€荤粨 #' + (summaryCountRef.current + 1) + '锛屽閲忔枃鏈暱搴?', incrementalText.length);
          summaryCountRef.current++;
          lastSummaryTextLengthRef.current = fullText.length; // 鏇存柊宸插鐞嗙殑鏂囨湰闀垮害
          generateSummary(incrementalText, currentTime);
        } else {
          console.log('鈴?璺宠繃鎬荤粨鐢熸垚锛氬閲忔枃鏈笉瓒筹紙' + incrementalText.length + ' 瀛楃锛?);
        }
      }, SUMMARY_INTERVAL);

      return () => {
        clearInterval(timer);
        if (summaryIntervalRef.current) {
          clearInterval(summaryIntervalRef.current);
        }
      };
    } else {
      setRecordingTime(0);
      recordingTimeRef.current = 0;
      if (summaryIntervalRef.current) {
        clearInterval(summaryIntervalRef.current);
      }
    }
  }, [isRecording]);

  useEffect(() => {
    if (isRecording && analyserRef.current) {
      const updateAudioLevel = () => {
        if (analyserRef.current) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setAudioLevel(average);
        }
        if (isRecording) {
          requestAnimationFrame(updateAudioLevel);
        }
      };
      updateAudioLevel();
    }
  }, [isRecording]);

  async function startRecording() {
    try {
      // 妫€鏌ユ槸鍚﹀惎鐢?Mock 妯″紡
      const useMock = typeof window !== 'undefined' && 
                     (process.env.NEXT_PUBLIC_USE_MOCK === 'true' || 
                      (window as any).USE_MOCK === 'true');
      
      if (useMock) {
        // Mock 妯″紡涓嬶紝璺宠繃楹﹀厠椋庢鏌ワ紝鐩存帴寮€濮嬫ā鎷熷綍闊?        console.log('馃敡 Mock 妯″紡锛氬紑濮嬫ā鎷熷綍闊?);
        setIsRecording(true);
        audioChunksRef.current = [];
        accumulatedTextRef.current = '';
        setTranscription('');
        setSegments([]); // 閲嶇疆璇磋瘽浜哄垎娈?        segmentIdRef.current = 0;
        currentIntermediateSegmentRef.current = null;
        return;
      }

      // 姝ｅ父妯″紡涓嬶紝妫€鏌ユ祻瑙堝櫒鏄惁鏀寔 getUserMedia
      if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        throw new Error('褰撳墠鐜涓嶆敮鎸佸綍闊冲姛鑳?);
      }

      if (!navigator?.mediaDevices) {
        throw new Error('鎮ㄧ殑娴忚鍣ㄤ笉鏀寔褰曢煶鍔熻兘銆傝纭繚锛歕n1. 浣跨敤 Chrome銆丗irefox銆丼afari 鎴?Edge 娴忚鍣╘n2. 閫氳繃 HTTPS 鎴?localhost 璁块棶\n3. 宸叉巿浜堥害鍏嬮鏉冮檺');
      }

      if (typeof navigator.mediaDevices.getUserMedia !== 'function') {
        throw new Error('getUserMedia API 涓嶅彲鐢紝璇锋鏌ユ祻瑙堝櫒鐗堟湰鍜屾潈闄愯缃?);
      }

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000, // 浣跨敤 16kHz 閲囨牱鐜囷紙闃块噷浜戞帹鑽愶級
          channelCount: 1,    // 鍗曞０閬?          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      streamRef.current = stream;

      // 鍒涘缓闊抽涓婁笅鏂囷紙浣跨敤 16kHz 閲囨牱鐜囷級
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000
      });
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      
      // 鍒涘缓闊抽鍒嗘瀽鍣ㄧ敤浜庢樉绀烘尝褰?      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // 鍒涘缓 ScriptProcessorNode 鏉ヨ幏鍙栧師濮?PCM 鏁版嵁
      const bufferSize = 4096;
      const scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      scriptProcessorRef.current = scriptProcessor;

      // 閲嶇疆 PCM 鏁版嵁
      pcmDataRef.current = [];
      audioChunksRef.current = [];

      // 鍒濆鍖?WebSocket 杩炴帴鍒伴樋閲屼簯锛堢湡姝ｇ殑娴佸紡璇嗗埆锛?      console.log('馃數 鍒濆鍖?WebSocket 杩炴帴...');
      await initWebSocket();
      
      // 澶勭悊闊抽鏁版嵁锛屽疄鏃跺彂閫佸埌闃块噷浜?      let chunkCount = 0;
      scriptProcessor.onaudioprocess = (event) => {
        chunkCount++;
        
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);
        
        // 灏?Float32Array 杞崲涓?Int16Array锛圥CM 16bit锛?        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // 绱Н PCM 鏁版嵁锛堢敤浜庡浠斤級
        pcmDataRef.current.push(pcm16);
        
        // 瀹炴椂鍙戦€佸埌闃块噷浜?WebSocket
        if (wsRef.current && wsReadyRef.current) {
          try {
            // 鍙戦€佷簩杩涘埗闊抽鏁版嵁
            wsRef.current.send(pcm16.buffer);
          } catch (e) {
            console.error('鍙戦€侀煶棰戝け璐?', e);
          }
        }
        
        // 姣?100 涓潡鎵撳嵃涓€娆℃棩蹇?        if (chunkCount % 100 === 0) {
          const totalSamples = pcmDataRef.current.reduce((sum, arr) => sum + arr.length, 0);
          const durationSeconds = totalSamples / 16000;
          console.log('馃數 褰曢煶涓紝宸插彂閫?, durationSeconds.toFixed(2), '绉掗煶棰?);
        }
      };

      // 杩炴帴闊抽澶勭悊閾?      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination); // 闇€瑕佽繛鎺ュ埌 destination 鎵嶈兘宸ヤ綔

      setIsRecording(true);
      accumulatedTextRef.current = '';
      setTranscription('');
      setSegments([]); // 閲嶇疆璇磋瘽浜哄垎娈?      segmentIdRef.current = 0;
      currentIntermediateSegmentRef.current = null;
    } catch (error) {
      console.error('鍚姩褰曢煶澶辫触:', error);
      const errorMessage = error instanceof Error 
        ? error.message 
        : '鏃犳硶璁块棶楹﹀厠椋庯紝璇锋鏌ユ潈闄愯缃?;
      alert(errorMessage);
    }
  }

  async function stopRecording() {
    // 妫€鏌ユ槸鍚﹀惎鐢?Mock 妯″紡
    const useMock = typeof window !== 'undefined' && 
                   (process.env.NEXT_PUBLIC_USE_MOCK === 'true' || 
                    (window as any).USE_MOCK === 'true');
    
    if (useMock) {
      // Mock 妯″紡涓嬶紝鐩存帴鍋滄妯℃嫙褰曢煶
      console.log('馃敡 Mock 妯″紡锛氬仠姝㈡ā鎷熷綍闊?);
      setIsRecording(false);
      return;
    }

    if (isRecording) {
      // 鍋滄褰曢煶
      setIsRecording(false);
      
      // 鍏抽棴 WebSocket 杩炴帴锛堝仠姝㈣瘑鍒級
      closeWebSocket();
      
      // 鏂紑闊抽澶勭悊閾?      if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
      }
      
      // 鍋滄闊抽娴?      streamRef.current?.getTracks().forEach(track => track.stop());
      
      // 鍏抽棴闊抽涓婁笅鏂?      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
        audioContextRef.current = null;
      }
      
      // 娉ㄦ剰锛氫娇鐢?WebSocket 娴佸紡璇嗗埆锛岄煶棰戝凡瀹炴椂鍙戦€侊紝鏃犻渶鍐嶆杞啓
      console.log('馃數 鍋滄褰曢煶锛學ebSocket 宸插叧闂?);
      
      // 娓呯悊 PCM 鏁版嵁
      pcmDataRef.current = [];
    }
  }

  // 灏?PCM 鏁版嵁杞崲涓?WAV 鏍煎紡
  function pcmToWav(pcmData: Int16Array[]): Blob {
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    
    // 璁＄畻鎬绘牱鏈暟
    const totalSamples = pcmData.reduce((sum, arr) => sum + arr.length, 0);
    const dataSize = totalSamples * numChannels * (bitsPerSample / 8);
    
    // 鍒涘缓 WAV 鏂囦欢缂撳啿鍖?    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // WAV 鏂囦欢澶?    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    // RIFF 澶?    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    
    // fmt 瀛愬潡
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt 鍧楀ぇ灏?    view.setUint16(20, 1, true);  // 闊抽鏍煎紡锛? = PCM锛?    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // 瀛楄妭鐜?    view.setUint16(32, numChannels * (bitsPerSample / 8), true); // 鍧楀榻?    view.setUint16(34, bitsPerSample, true);
    
    // data 瀛愬潡
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    // 鍐欏叆 PCM 鏁版嵁
    let offset = 44;
    for (const chunk of pcmData) {
      for (let i = 0; i < chunk.length; i++) {
        view.setInt16(offset, chunk[i], true);
        offset += 2;
      }
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function transcribeChunk(isFinal = false) {
    // 鍏堝鍒舵暟鎹紝閬垮厤鍦ㄨ浆鍐欒繃绋嬩腑鏁版嵁琚慨鏀?    const currentData = [...pcmDataRef.current];
    
    if (currentData.length === 0) {
      console.log('鈿狅笍 娌℃湁 PCM 鏁版嵁鍙浆鍐?);
      return;
    }

    try {
      const totalSamples = currentData.reduce((sum, arr) => sum + arr.length, 0);
      const durationSeconds = totalSamples / 16000;
      console.log('馃數 寮€濮嬭浆鍐欙紝PCM 鏁版嵁鍧楁暟:', currentData.length, '锛岄煶棰戞椂闀?', durationSeconds.toFixed(2), '绉?);
      
      // 灏?PCM 鏁版嵁杞崲涓?WAV 鏍煎紡
      const audioBlob = pcmToWav(currentData);
      console.log('馃數 WAV 鏂囦欢澶у皬:', audioBlob.size, '瀛楄妭');
      
      // 鍙戦€佽浆鍐欒姹傚悗锛屾竻绌哄凡澶勭悊鐨勬暟鎹紙涓嶄繚鐣欓噸鍙狅紝閬垮厤閲嶅璇嗗埆锛?      // 鐩存帴娓呯┖鎵€鏈夋暟鎹紝涓嬫杞啓灏嗘槸鍏ㄦ柊鐨勯煶棰戝潡
      pcmDataRef.current = [];
      console.log('馃數 娓呯┖宸插鐞嗙殑闊抽鏁版嵁锛岀瓑寰呮敹闆嗘柊鏁版嵁');
      
      setIsUploading(true);
      const formData = new FormData();
      formData.append('file', audioBlob, `recording_${Date.now()}.wav`);
      formData.append('isLast', isFinal ? 'true' : 'false');

      // 浣跨敤浼樺寲鐨勫疄鏃惰浆鍐?API锛堜竴鍙ヨ瘽璇嗗埆锛屾晥鏋滄洿濂斤級
      const response = await fetch('/api/realtime-transcribe', {
        method: 'POST',
        body: formData,
      });

      console.log('馃數 杞啓鍝嶅簲鐘舵€?', response.status);

      if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
        // 娴佸紡鍝嶅簲锛圫SE锛? 鏀寔涓棿缁撴灉
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        
        if (!reader) {
          throw new Error('鏃犳硶璇诲彇鍝嶅簲娴?);
        }

        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.type === 'intermediate') {
                  // 涓棿缁撴灉锛氬疄鏃舵樉绀猴紙鎸夎璇濅汉鍒嗘锛?                  const intermediateText = data.text || '';
                  const speakerId = data.speakerId ?? 0;
                  const beginTime = data.beginTime ?? (recordingTimeRef.current * 1000);
                  
                  console.log('馃摑 涓棿缁撴灉:', { text: intermediateText, speakerId, beginTime });
                  
                  // 鏇存柊褰撳墠涓棿缁撴灉鍒嗘
                  currentIntermediateSegmentRef.current = {
                    id: `intermediate-${Date.now()}`,
                    speakerId,
                    text: intermediateText,
                    beginTime,
                    endTime: beginTime,
                    isIntermediate: true
                  };
                  currentIntermediateRef.current = intermediateText;
                  
                  // 鏇存柊鏄剧ず锛堝寘鍚腑闂寸粨鏋滐級
                  setSegments(prev => {
                    // 绉婚櫎涔嬪墠鐨勪腑闂寸粨鏋滐紝娣诲姞鏂扮殑
                    const filtered = prev.filter(s => !s.isIntermediate);
                    if (currentIntermediateSegmentRef.current) {
                      return [...filtered, currentIntermediateSegmentRef.current];
                    }
                    return filtered;
                  });
                  
                  // 鍚屾椂鏇存柊绾枃鏈紙鐢ㄤ簬鎬荤粨绛夛級
                  const displayText = accumulatedTextRef.current + intermediateText;
                  setTranscription(displayText);
                  onTranscriptionUpdate(displayText);
                  
                  // 鑷姩婊氬姩鍒板簳閮?                  if (transcriptionScrollRef.current) {
                    transcriptionScrollRef.current.scrollTop = transcriptionScrollRef.current.scrollHeight;
                  }
                } else if (data.type === 'final') {
                  // 鏈€缁堢粨鏋滐細鎸夎璇濅汉鍒嗘杩藉姞
                  const finalText = data.text || '';
                  const speakerId = data.speakerId ?? 0;
                  const beginTime = data.beginTime ?? (recordingTimeRef.current * 1000);
                  const endTime = data.endTime ?? beginTime;
                  
                  console.log('鉁?鏈€缁堢粨鏋?', { text: finalText, speakerId, beginTime, endTime });
                  
                  if (finalText.trim()) {
                    // 鍒涘缓鏂扮殑鏈€缁堝垎娈?                    const newSegment: TranscriptionSegment = {
                      id: `segment-${segmentIdRef.current++}`,
                      speakerId,
                      text: finalText,
                      beginTime,
                      endTime,
                      isIntermediate: false
                    };
                    
                    // 杩藉姞鍒板垎娈靛垪琛紙绉婚櫎涓棿缁撴灉锛?                    setSegments(prev => {
                      const filtered = prev.filter(s => !s.isIntermediate);
                      
                      // 妫€鏌ユ槸鍚﹀彲浠ヤ笌涓婁竴涓垎娈靛悎骞讹紙鍚屼竴璇磋瘽浜猴級
                      if (filtered.length > 0) {
                        const lastSegment = filtered[filtered.length - 1];
                        if (lastSegment.speakerId === speakerId) {
                          // 鍚堝苟鍒颁笂涓€涓垎娈?                          const merged = {
                            ...lastSegment,
                            text: lastSegment.text + finalText,
                            endTime: endTime
                          };
                          return [...filtered.slice(0, -1), merged];
                        }
                      }
                      
                      return [...filtered, newSegment];
                    });
                    
                    // 杩藉姞鍒扮疮绉枃鏈?                    accumulatedTextRef.current += finalText;
                    currentIntermediateRef.current = '';
                    currentIntermediateSegmentRef.current = null;
                    
                    setTranscription(accumulatedTextRef.current);
                    onTranscriptionUpdate(accumulatedTextRef.current);
                    
                    // 鑷姩婊氬姩鍒板簳閮?                    if (transcriptionScrollRef.current) {
                      transcriptionScrollRef.current.scrollTop = transcriptionScrollRef.current.scrollHeight;
                    }
                  }
                } else if (data.type === 'completed') {
                  console.log('馃弫 闊抽鍧楄瘑鍒畬鎴?);
                  // 娓呯悊涓棿缁撴灉
                  currentIntermediateSegmentRef.current = null;
                  setSegments(prev => prev.filter(s => !s.isIntermediate));
                } else if (data.type === 'error') {
                  console.error('鉂?杞啓閿欒:', data.error);
                  throw new Error(data.error || '杞啓澶辫触');
                } else if (data.type === 'started') {
                  console.log('馃殌 杞啓寮€濮?);
                } else if (data.type === 'sentence_begin') {
                  console.log('馃數 鍙ュ瓙寮€濮?', data);
                }
              } catch (e) {
                console.error('瑙ｆ瀽 SSE 鏁版嵁澶辫触:', e);
              }
            }
          }
        }
      } else if (response.ok) {
        // 鏅€?JSON 鍝嶅簲锛堥潪娴佸紡锛?        const data = await response.json();
        const newText = data.text || '';
        console.log('鉁?杞啓鎴愬姛锛屾枃鏈暱搴?', newText.length);
        
        if (newText.trim()) {
          accumulatedTextRef.current += newText + ' ';
          const updatedText = accumulatedTextRef.current;
          setTranscription(updatedText);
          onTranscriptionUpdate(updatedText);
          
          // 鑷姩婊氬姩鍒板簳閮?          if (transcriptionScrollRef.current) {
            setTimeout(() => {
              transcriptionScrollRef.current?.scrollTo({
                top: transcriptionScrollRef.current.scrollHeight,
                behavior: 'smooth'
              });
            }, 50);
          }
        }
      } else {
        const error = await response.json();
        const errorMsg = error.details || error.error || '杞啓澶辫触';
        console.error('杞啓澶辫触:', errorMsg);
        // 瀵逛簬閰嶉涓嶈冻绛変弗閲嶉敊璇紝鏄剧ず璀﹀憡
        if (response.status === 402 || errorMsg.includes('閰嶉')) {
          alert(`鈿狅笍 ${errorMsg}\n\n寤鸿锛氳妫€鏌?OpenAI 璐︽埛浣欓鎴栬仈绯荤鐞嗗憳銆俙);
        }
      }

      if (isFinal) {
        audioChunksRef.current = [];
      }
    } catch (error) {
      console.error('杞啓澶辫触:', error);
      const errorMessage = error instanceof Error ? error.message : '杞啓澶辫触';
      alert(`杞啓閿欒: ${errorMessage}`);
    } finally {
      setIsUploading(false);
    }
  }

  async function generateSummary(text: string, timestamp: number) {
    console.log('馃殌 寮€濮嬬敓鎴愰樁娈垫€ф€荤粨...', { timestamp, textLength: text.length });
    
    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      console.log('馃摗 鎬荤粨 API 鍝嶅簲鐘舵€?', response.status);

      if (response.ok) {
        const data = await response.json();
        const summaryContent = data.summary;
        
        console.log('鉁?闃舵鎬ф€荤粨鐢熸垚鎴愬姛:', summaryContent?.substring(0, 100) + '...');
        
        // 閫氱煡鐖剁粍浠讹紙鐢ㄤ簬鐣岄潰鏄剧ず锛?        onSummaryGenerated(summaryContent, timestamp);
        
        // 濡傛灉鏈?projectId锛岃嚜鍔ㄤ繚瀛樺埌鏁版嵁搴?        if (projectId && summaryContent.trim()) {
          try {
            const saveResponse = await fetch('/api/mini-summaries', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                project_id: projectId,
                timestamp: timestamp,
                content: summaryContent,
              }),
            });

            if (saveResponse.ok) {
              console.log('鉁?闃舵鎬ф€荤粨宸茶嚜鍔ㄤ繚瀛樺埌鏁版嵁搴?);
            } else {
              console.warn('鈿狅笍 鑷姩淇濆瓨闃舵鎬ф€荤粨澶辫触锛屽皢鍦ㄤ繚瀛橀」鐩椂缁熶竴淇濆瓨');
            }
          } catch (saveError) {
            console.error('淇濆瓨闃舵鎬ф€荤粨澶辫触:', saveError);
            // 涓嶉樆濉炴祦绋嬶紝缁х画鎵ц
          }
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('鉂?鐢熸垚鎬荤粨澶辫触:', response.status, errorData);
      }
    } catch (error) {
      console.error('鉂?鐢熸垚鎬荤粨澶辫触:', error);
    }
  }

  // Mock 妯″紡涓嬭嚜鍔ㄧ敓鎴愮畝鎶?  async function generateMockSummary(timestamp: number) {
    try {
      // 妯℃嫙 API 寤惰繜
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 鑾峰彇 Mock 绠€鎶ュ唴瀹?      const { getMockSummary } = await import('@/lib/mock');
      const summary = getMockSummary(mockSummaryIndexRef.current);
      mockSummaryIndexRef.current += 1;
      
      onSummaryGenerated(summary, timestamp);
    } catch (error) {
      console.error('鐢熸垚 Mock 绠€鎶ュけ璐?', error);
    }
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    // 妫€鏌ユ枃浠剁被鍨?    const validTypes = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm'];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|m4a|webm)$/i)) {
      alert('涓嶆敮鎸佺殑鏂囦欢鏍煎紡锛岃涓婁紶 MP3銆乄AV 鎴?M4A 鏂囦欢');
      return;
    }

    setIsUploading(true);
    try {
      // 妫€鏌ユ槸鍚︿娇鐢ㄩ樋閲屼簯 OSS + 褰曢煶鏂囦欢璇嗗埆
      const useAliyunFileTranscription = process.env.NEXT_PUBLIC_USE_ALIYUN_FILE_TRANSCRIPTION === 'true';
      
      if (useAliyunFileTranscription) {
        // 浣跨敤鍒嗘杞啓 API锛氫笂浼?鈫?鍒囧壊涓?2 鍒嗛挓鐗囨 鈫?鍒嗗埆璇嗗埆 鈫?鍒嗗埆鎬荤粨
        console.log('馃數 浣跨敤鍒嗘杞啓锛堟瘡 2 鍒嗛挓涓€娈碉級');
        
        // 閲嶇疆鐘舵€?        setSegmentTasks([]);
        setUploadStatus('姝ｅ湪涓婁紶鏂囦欢...');
        
        // 鍒涘缓 FormData 涓婁紶鏂囦欢
        const uploadFormData = new FormData();
        uploadFormData.append('file', file);
        if (projectId) {
          uploadFormData.append('projectId', projectId);
        }
        
        // 璋冪敤鍒嗘杞啓 API
        const response = await fetch('/api/aliyun/segmented-transcribe', {
          method: 'POST',
          body: uploadFormData,
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.details || error.error || '鍒嗘杞啓澶辫触');
        }
        
        setUploadStatus('姝ｅ湪澶勭悊闊抽...');
        
        // 澶勭悊 SSE 娴?        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        
        if (!reader) {
          throw new Error('鏃犳硶璇诲彇鍝嶅簲娴?);
        }
        
        let buffer = '';
        let finalResult = '';
        let fileSegments: TranscriptionSegment[] = [];
        let segmentSummaries: Array<{ timestamp: number; content: string }> = [];
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.type === 'status') {
                  console.log('馃數 鐘舵€?', data.message);
                  setUploadStatus(data.message);
                } else if (data.type === 'segments_info') {
                  console.log('馃數 闊抽鍒囧壊瀹屾垚:', data.message);
                  setUploadStatus(data.message);
                  // 鍒濆鍖栨墍鏈夊垎鐗囦换鍔＄姸鎬?                  const initialTasks: SegmentTask[] = [];
                  for (let i = 0; i < data.totalSegments; i++) {
                    initialTasks.push({
                      index: i,
                      startTime: i * 120,
                      endTime: (i + 1) * 120,
                      status: 'pending',
                    });
                  }
                  setSegmentTasks(initialTasks);
                } else if (data.type === 'segment_start') {
                  console.log(`馃數 寮€濮嬪鐞嗙墖娈?${data.index + 1}:`, data.message);
                  setUploadStatus(`姝ｅ湪澶勭悊鐗囨 ${data.index + 1}...`);
                  // 鏇存柊浠诲姟鐘舵€佷负 uploading
                  setSegmentTasks(prev => prev.map(t => 
                    t.index === data.index 
                      ? { ...t, status: 'uploading' as const, startTime: data.startTime, endTime: data.endTime }
                      : t
                  ));
                } else if (data.type === 'segment_progress') {
                  console.log(`馃數 鐗囨 ${data.index + 1} 杩涘害:`, data.status);
                  // 鏇存柊浠诲姟鐘舵€佷负 transcribing
                  setSegmentTasks(prev => prev.map(t => 
                    t.index === data.index 
                      ? { ...t, status: 'transcribing' as const, progress: data.status }
                      : t
                  ));
                } else if (data.type === 'segment_complete') {
                  console.log(`鉁?鐗囨 ${data.index + 1} 璇嗗埆瀹屾垚:`, data.text?.substring(0, 50) + '...');
                  // 鏇存柊浠诲姟鐘舵€佷负 summarizing
                  setSegmentTasks(prev => prev.map(t => 
                    t.index === data.index 
                      ? { ...t, status: 'summarizing' as const }
                      : t
                  ));
                  
                  // 瀹炴椂鏇存柊杞啓鍐呭
                  if (data.text) {
                    finalResult += (finalResult ? '\n\n' : '') + data.text;
                    accumulatedTextRef.current = finalResult;
                    setTranscription(finalResult);
                    onTranscriptionUpdate(finalResult);
                  }
                  
                  // 瀹炴椂鏇存柊璇磋瘽浜哄垎娈?                  if (data.segments && Array.isArray(data.segments)) {
                    const newSegments = data.segments.map((seg: {
                      speakerId?: number;
                      text?: string;
                      beginTime?: number;
                      endTime?: number;
                    }, idx: number) => ({
                      id: `segment-${data.index}-${idx}`,
                      speakerId: seg.speakerId ?? 0,
                      text: seg.text || '',
                      // 鏃堕棿鎴冲凡鍦ㄦ湇鍔＄璋冩暣锛屽姞涓婄墖娈佃捣濮嬫椂闂?                      beginTime: (seg.beginTime || 0) + data.startTime * 1000,
                      endTime: (seg.endTime || 0) + data.startTime * 1000,
                      isIntermediate: false
                    }));
                    fileSegments = [...fileSegments, ...newSegments];
                    setSegments(fileSegments);
                  }
                  
                  // 婊氬姩鍒板簳閮?                  if (transcriptionScrollRef.current) {
                    transcriptionScrollRef.current.scrollTop = transcriptionScrollRef.current.scrollHeight;
                  }
                } else if (data.type === 'segment_summary') {
                  // 鏀跺埌鐗囨鐨勯樁娈垫€ф€荤粨
                  console.log(`馃摑 鐗囨 ${data.index + 1} 鎬荤粨:`, data.summary?.substring(0, 50) + '...');
                  // 鏇存柊浠诲姟鐘舵€佷负 completed
                  setSegmentTasks(prev => prev.map(t => 
                    t.index === data.index 
                      ? { ...t, status: 'completed' as const }
                      : t
                  ));
                  segmentSummaries.push({
                    timestamp: data.timestamp,
                    content: data.summary
                  });
                  // 閫氱煡鐖剁粍浠?                  onSummaryGenerated(data.summary, data.timestamp);
                } else if (data.type === 'segment_error') {
                  console.error(`鉂?鐗囨 ${data.index + 1} 澶辫触:`, data.error);
                  // 鏇存柊浠诲姟鐘舵€佷负 error
                  setSegmentTasks(prev => prev.map(t => 
                    t.index === data.index 
                      ? { ...t, status: 'error' as const, error: data.error }
                      : t
                  ));
                } else if (data.type === 'complete') {
                  console.log('鉁?鎵€鏈夌墖娈靛鐞嗗畬鎴?);
                  setUploadStatus('澶勭悊瀹屾垚锛佹鍦ㄦ竻鐞嗕复鏃舵枃浠?..');
                  
                  // 灏嗘墍鏈夋湭瀹屾垚鐨勪换鍔℃爣璁颁负瀹屾垚
                  setSegmentTasks(prev => prev.map(t => 
                    t.status !== 'error' && t.status !== 'completed'
                      ? { ...t, status: 'completed' as const }
                      : t
                  ));
                  
                  // 鏈€缁堢粨鏋?                  if (data.text) {
                    finalResult = data.text;
                    accumulatedTextRef.current = finalResult;
                    setTranscription(finalResult);
                    onTranscriptionUpdate(finalResult);
                  }
                  
                  // 鏈€缁堣璇濅汉鍒嗘
                  if (data.segments && Array.isArray(data.segments)) {
                    fileSegments = data.segments.map((seg: {
                      speakerId?: number;
                      text?: string;
                      beginTime?: number;
                      endTime?: number;
                    }, idx: number) => ({
                      id: `final-segment-${idx}`,
                      speakerId: seg.speakerId ?? 0,
                      text: seg.text || '',
                      beginTime: seg.beginTime || 0,
                      endTime: seg.endTime || 0,
                      isIntermediate: false
                    }));
                    setSegments(fileSegments);
                  }
                  
                  // 娓呯悊瀹屾垚鍚庢洿鏂扮姸鎬?                  setTimeout(() => {
                    setUploadStatus('');
                    setSegmentTasks([]);
                  }, 2000);
                } else if (data.type === 'error') {
                  throw new Error(data.error || '鍒嗘杞啓澶辫触');
                }
              } catch (e) {
                if (e instanceof SyntaxError) {
                  console.warn('瑙ｆ瀽 SSE 鏁版嵁澶辫触:', line);
                } else {
                  throw e;
                }
              }
            }
          }
        }
        
        if (!finalResult && fileSegments.length === 0) {
          throw new Error('鏈幏鍙栧埌璇嗗埆缁撴灉');
        }
        
        console.log(`鉁?鍒嗘杞啓瀹屾垚锛屽叡鐢熸垚 ${segmentSummaries.length} 涓樁娈垫€ф€荤粨`);
        
        // 鑷姩婊氬姩鍒板簳閮?        if (transcriptionScrollRef.current) {
          setTimeout(() => {
            transcriptionScrollRef.current?.scrollTo({
              top: transcriptionScrollRef.current.scrollHeight,
              behavior: 'smooth'
            });
          }, 50);
        }
      } else {
        // 鏂规 2: 浣跨敤鍘熸湁鐨勮浆鍐欐帴鍙ｏ紙OpenAI 鎴栧叾浠栵級
        console.log('馃數 浣跨敤鍘熸湁杞啓鎺ュ彛');
        
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.text || '';
          setTranscription(text);
          onTranscriptionUpdate(text);
          
          // 鑷姩婊氬姩鍒板簳閮ㄦ樉绀烘渶鏂板唴瀹?          if (transcriptionScrollRef.current) {
            setTimeout(() => {
              transcriptionScrollRef.current?.scrollTo({
                top: transcriptionScrollRef.current.scrollHeight,
                behavior: 'smooth'
              });
            }, 50);
          }
        } else {
          const error = await response.json();
          const errorMsg = error.details || error.error || '鏈煡閿欒';
          const suggestion = error.suggestion || '';
          
          // 鏍规嵁閿欒绫诲瀷鏄剧ず涓嶅悓鐨勬彁绀?          if (response.status === 402 || errorMsg.includes('閰嶉涓嶈冻')) {
            alert(`鈿狅笍 杞啓澶辫触锛?{errorMsg}\n\n${suggestion || '璇锋鏌?OpenAI 璐︽埛浣欓鎴栬仈绯荤鐞嗗憳銆?}`);
          } else if (response.status === 401 || errorMsg.includes('API Key')) {
            alert(`鉂?杞啓澶辫触锛?{errorMsg}\n\n璇锋鏌?OPENAI_API_KEY 鐜鍙橀噺閰嶇疆銆俙);
          } else if (response.status === 429 || errorMsg.includes('棰戠巼')) {
            alert(`鈴憋笍 杞啓澶辫触锛?{errorMsg}\n\n璇风◢鍚庡啀璇曘€俙);
          } else {
            alert(`杞啓澶辫触锛?{errorMsg}`);
          }
        }
      }
    } catch (error) {
      console.error('涓婁紶杞啓澶辫触:', error);
      const errorMessage = error instanceof Error ? error.message : '鏈煡閿欒';
      alert(`涓婁紶杞啓澶辫触锛?{errorMessage}`);
    } finally {
      setIsUploading(false);
    }
  }

  function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>褰曢煶涓庤浆鍐?/CardTitle>
        <CardDescription>
          寮€濮嬪綍闊虫垨涓婁紶闊抽鏂囦欢杩涜杞啓
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isMounted && (() => {
          const useMock = typeof window !== 'undefined' && 
                         (process.env.NEXT_PUBLIC_USE_MOCK === 'true' || 
                          (window as any).USE_MOCK === 'true');
          
          // Mock 妯″紡涓嬩笉鏄剧ず璀﹀憡
          if (useMock) return null;
          
          // 闈?Mock 妯″紡涓斾笉鏀寔鏃舵樉绀鸿鍛?          return !isSupported ? (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                鈿狅笍 妫€娴嬪埌娴忚鍣ㄥ彲鑳戒笉鏀寔褰曢煶鍔熻兘銆傝纭繚锛?                <br />鈥?浣跨敤 Chrome銆丗irefox銆丼afari 鎴?Edge 娴忚鍣?                <br />鈥?閫氳繃 HTTPS 鎴?localhost 璁块棶锛堥潪 HTTPS 鍙兘鏃犳硶浣跨敤锛?                <br />鈥?宸叉巿浜堥害鍏嬮鏉冮檺
              </p>
            </div>
          ) : null;
        })()}
        <div className="flex items-center gap-4">
          {!isRecording ? (
            <Button 
              onClick={startRecording} 
              size="lg" 
              className="gap-2"
              disabled={(() => {
                const useMock = typeof window !== 'undefined' && 
                               (process.env.NEXT_PUBLIC_USE_MOCK === 'true' || 
                                (window as any).USE_MOCK === 'true');
                // Mock 妯″紡涓嬩笉绂佺敤鎸夐挳
                return useMock ? false : !isSupported;
              })()}
            >
              <Mic className="h-5 w-5" />
              寮€濮嬪綍闊?            </Button>
          ) : (
            <Button 
              onClick={stopRecording} 
              size="lg" 
              variant="destructive"
              className="gap-2"
            >
              <MicOff className="h-5 w-5" />
              鍋滄褰曢煶
            </Button>
          )}

          <div className="flex-1">
            <Label htmlFor="audio-upload" className="cursor-pointer">
              <Button 
                variant="outline" 
                className="gap-2" 
                disabled={isUploading}
                asChild
              >
                <span>
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      杞啓涓?..
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      涓婁紶闊抽
                    </>
                  )}
                </span>
              </Button>
            </Label>
            <Input
              id="audio-upload"
              type="file"
              accept="audio/*"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isUploading}
            />
          </div>
        </div>

        {isRecording && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-400">
                褰曢煶鏃堕暱: {formatTime(recordingTime)}
              </span>
            </div>
            <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-100"
                style={{ width: `${Math.min(audioLevel, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* 鍒嗙墖浠诲姟杩涘害 */}
        {(isUploading || segmentTasks.length > 0) && (
          <div className="space-y-3 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border">
            {uploadStatus && (
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{uploadStatus}</span>
              </div>
            )}
            
            {segmentTasks.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>鍒嗙墖浠诲姟杩涘害</span>
                  <span>
                    {segmentTasks.filter(t => t.status === 'completed').length} / {segmentTasks.length} 瀹屾垚
                  </span>
                </div>
                
                {/* 杩涘害鏉?*/}
                <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 transition-all duration-300"
                    style={{ 
                      width: `${(segmentTasks.filter(t => t.status === 'completed').length / segmentTasks.length) * 100}%` 
                    }}
                  />
                </div>
                
                {/* 鍒嗙墖璇︽儏 */}
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1.5 mt-2">
                  {segmentTasks.map((task) => {
                    const statusColors = {
                      pending: 'bg-slate-200 dark:bg-slate-700',
                      uploading: 'bg-yellow-400 animate-pulse',
                      transcribing: 'bg-blue-400 animate-pulse',
                      summarizing: 'bg-purple-400 animate-pulse',
                      completed: 'bg-green-500',
                      error: 'bg-red-500',
                    };
                    const statusTitles = {
                      pending: '绛夊緟涓?,
                      uploading: '涓婁紶涓?,
                      transcribing: '璇嗗埆涓?,
                      summarizing: '鎬荤粨涓?,
                      completed: '宸插畬鎴?,
                      error: '澶辫触',
                    };
                    return (
                      <div
                        key={task.index}
                        className={`h-6 rounded flex items-center justify-center text-xs font-medium text-white cursor-default ${statusColors[task.status]}`}
                        title={`鐗囨 ${task.index + 1} (${formatTime(task.startTime)} - ${formatTime(task.endTime)}): ${statusTitles[task.status]}${task.error ? ` - ${task.error}` : ''}`}
                      >
                        {task.status === 'completed' ? '鉁? : task.status === 'error' ? '鉁? : task.index + 1}
                      </div>
                    );
                  })}
                </div>
                
                {/* 鍥句緥 */}
                <div className="flex flex-wrap gap-3 text-xs text-slate-500 mt-2">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded bg-slate-200 dark:bg-slate-700"></span> 绛夊緟
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded bg-yellow-400"></span> 涓婁紶
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded bg-blue-400"></span> 璇嗗埆
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded bg-purple-400"></span> 鎬荤粨
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded bg-green-500"></span> 瀹屾垚
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 瀹炴椂杞啓鍐呭婊氬姩鏄剧ず鍖哄煙 - 鎸夎璇濅汉鍒嗘鏄剧ず */}
        <div className="mt-4 space-y-2">
          <Label className="flex items-center gap-2">
            <ScrollText className="h-4 w-4" />
            瀹炴椂杞啓鍐呭
            {segments.length > 0 && (
              <span className="text-xs text-slate-400 ml-2">
                {new Set(segments.filter(s => !s.isIntermediate).map(s => s.speakerId)).size} 浣嶈璇濅汉
              </span>
            )}
          </Label>
          <div className="border rounded-lg bg-slate-50 dark:bg-slate-900 relative shadow-inner">
            <div 
              ref={transcriptionScrollRef}
              className="h-56 overflow-y-auto p-4 space-y-3"
              style={{ scrollBehavior: 'smooth' }}
            >
              {segments.length > 0 ? (
                // 鎸夎璇濅汉鍒嗘鏄剧ず
                segments.map((segment) => {
                  const colorIndex = segment.speakerId % SPEAKER_COLORS.length;
                  const colors = SPEAKER_COLORS[colorIndex];
                  
                  return (
                    <div 
                      key={segment.id}
                      className={`rounded-lg p-3 border ${colors.bg} ${colors.border} ${
                        segment.isIntermediate ? 'opacity-70' : ''
                      } transition-all duration-200`}
                    >
                      {/* 璇磋瘽浜烘爣绛惧拰鏃堕棿鎴?*/}
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors.badge}`}>
                            <User className="h-3 w-3" />
                            璇磋瘽浜?{segment.speakerId + 1}
                          </span>
                          {segment.isIntermediate && (
                            <span className="text-xs text-slate-400 italic">璇嗗埆涓?..</span>
                          )}
                        </div>
                        <span className="text-xs text-slate-400 font-mono">
                          {formatTimestamp(segment.beginTime)}
                          {segment.endTime > segment.beginTime && ` - ${formatTimestamp(segment.endTime)}`}
                        </span>
                      </div>
                      {/* 杞啓鍐呭 */}
                      <p className={`text-sm leading-relaxed ${colors.text} break-words`}>
                        {segment.text}
                        {segment.isIntermediate && isRecording && (
                          <span className="inline-block w-2 h-4 bg-current ml-1 animate-pulse opacity-50" />
                        )}
                      </p>
                    </div>
                  );
                })
              ) : transcription ? (
                // 鍥為€€鍒扮函鏂囨湰鏄剧ず锛堝吋瀹规棫鏁版嵁锛?                <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300 leading-relaxed text-sm">
                  {transcription}
                  {isRecording && (
                    <span className="inline-block w-2 h-4 bg-blue-500 ml-1 animate-pulse" />
                  )}
                </p>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-slate-500">
                  <Mic className="h-12 w-12 mb-4 opacity-30" />
                  <p className="text-sm italic">
                    {isRecording ? '姝ｅ湪褰曢煶锛岃浆鍐欏唴瀹瑰皢瀹炴椂鏄剧ず鍦ㄨ繖閲?..' : '鏆傛棤杞啓鍐呭锛屽紑濮嬪綍闊虫垨涓婁紶闊抽鏂囦欢'}
                  </p>
                  <div className="text-xs mt-3 opacity-60 space-y-1 text-center">
                    <p>馃搧 <strong>涓婁紶闊抽</strong>锛氭敮鎸佽璇濅汉璇嗗埆锛岃嚜鍔ㄥ尯鍒嗕笉鍚屽彂瑷€鑰?/p>
                    <p>馃帳 <strong>瀹炴椂褰曢煶</strong>锛氫粎鏀寔鏃堕棿鎴筹紝涓嶅尯鍒嗚璇濅汉</p>
                  </div>
                </div>
              )}
            </div>
            {/* 缁熻淇℃伅 */}
            {(segments.length > 0 || transcription) && (
              <div className="absolute bottom-2 right-2 flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 bg-slate-50/90 dark:bg-slate-900/90 px-2 py-1 rounded backdrop-blur-sm">
                <span>{transcription.length} 瀛?/span>
                {segments.filter(s => !s.isIntermediate).length > 0 && (
                  <span>鈥?{segments.filter(s => !s.isIntermediate).length} 娈?/span>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
