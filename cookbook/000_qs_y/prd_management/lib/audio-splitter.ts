import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

// 闊抽鐗囨淇℃伅
export interface AudioSegment {
  index: number;
  startTime: number;  // 绉?  endTime: number;    // 绉?  duration: number;   // 绉?  filePath: string;   // 鏈湴鏂囦欢璺緞
}

// 鑾峰彇闊抽鏃堕暱锛堢锛?export async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return parseFloat(stdout.trim());
  } catch (error) {
    console.error('鑾峰彇闊抽鏃堕暱澶辫触:', error);
    throw new Error('鏃犳硶鑾峰彇闊抽鏃堕暱锛岃纭繚宸插畨瑁?ffmpeg');
  }
}

// 鍒囧壊闊抽鏂囦欢涓哄涓墖娈?export async function splitAudio(
  inputPath: string,
  segmentDuration: number = 120, // 榛樿 2 鍒嗛挓
  outputDir?: string
): Promise<AudioSegment[]> {
  // 鍒涘缓涓存椂鐩綍
  const tempDir = outputDir || path.join(os.tmpdir(), `audio-split-${Date.now()}`);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // 鑾峰彇闊抽鎬绘椂闀?  const totalDuration = await getAudioDuration(inputPath);
  console.log(`馃數 闊抽鎬绘椂闀? ${totalDuration.toFixed(2)} 绉抈);

  // 璁＄畻闇€瑕佺殑鐗囨鏁?  const segmentCount = Math.ceil(totalDuration / segmentDuration);
  console.log(`馃數 灏嗗垏鍓蹭负 ${segmentCount} 涓墖娈碉紝姣忔 ${segmentDuration} 绉抈);

  const segments: AudioSegment[] = [];
  const ext = path.extname(inputPath);
  const basename = path.basename(inputPath, ext);

  // 鍒囧壊姣忎釜鐗囨
  for (let i = 0; i < segmentCount; i++) {
    const startTime = i * segmentDuration;
    const endTime = Math.min((i + 1) * segmentDuration, totalDuration);
    const duration = endTime - startTime;
    const outputPath = path.join(tempDir, `${basename}_part${i + 1}${ext}`);

    try {
      // 浣跨敤 ffmpeg 鍒囧壊
      await execAsync(
        `ffmpeg -y -i "${inputPath}" -ss ${startTime} -t ${duration} -c copy "${outputPath}"`
      );

      segments.push({
        index: i,
        startTime,
        endTime,
        duration,
        filePath: outputPath,
      });

      console.log(`鉁?鐗囨 ${i + 1}/${segmentCount} 鍒囧壊瀹屾垚: ${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s`);
    } catch (error) {
      console.error(`鉂?鍒囧壊鐗囨 ${i + 1} 澶辫触:`, error);
      throw new Error(`鍒囧壊闊抽鐗囨 ${i + 1} 澶辫触`);
    }
  }

  return segments;
}

// 娓呯悊涓存椂鏂囦欢
export function cleanupSegments(segments: AudioSegment[]): void {
  for (const segment of segments) {
    try {
      if (fs.existsSync(segment.filePath)) {
        fs.unlinkSync(segment.filePath);
      }
    } catch (error) {
      console.warn(`娓呯悊涓存椂鏂囦欢澶辫触: ${segment.filePath}`, error);
    }
  }

  // 灏濊瘯鍒犻櫎涓存椂鐩綍
  if (segments.length > 0) {
    const tempDir = path.dirname(segments[0].filePath);
    try {
      if (fs.existsSync(tempDir) && fs.readdirSync(tempDir).length === 0) {
        fs.rmdirSync(tempDir);
      }
    } catch (error) {
      console.warn(`娓呯悊涓存椂鐩綍澶辫触: ${tempDir}`, error);
    }
  }
}

// 浠?Buffer 鍒涘缓涓存椂鏂囦欢
export async function createTempFile(buffer: Buffer, filename: string): Promise<string> {
  const tempDir = path.join(os.tmpdir(), `audio-upload-${Date.now()}`);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const filePath = path.join(tempDir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// 鍒犻櫎涓存椂鏂囦欢
export function deleteTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    // 灏濊瘯鍒犻櫎鐖剁洰褰?    const dir = path.dirname(filePath);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch (error) {
    console.warn(`鍒犻櫎涓存椂鏂囦欢澶辫触: ${filePath}`, error);
  }
}
