import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio } from '@/lib/transcribe';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: '鏈彁渚涢煶棰戞枃浠? },
        { status: 400 }
      );
    }

    const transcription = await transcribeAudio(file);
    
    return NextResponse.json({ text: transcription });
  } catch (error) {
    console.error('杞啓閿欒:', error);
    
    const errorMessage = error instanceof Error ? error.message : '鏈煡閿欒';
    
    // 鏍规嵁閿欒绫诲瀷杩斿洖涓嶅悓鐨勭姸鎬佺爜
    let statusCode = 500;
    if (errorMessage.includes('閰嶉涓嶈冻') || errorMessage.includes('insufficient_quota')) {
      statusCode = 402; // Payment Required
    } else if (errorMessage.includes('API Key') || errorMessage.includes('invalid_api_key')) {
      statusCode = 401; // Unauthorized
    } else if (errorMessage.includes('棰戠巼') || errorMessage.includes('rate_limit')) {
      statusCode = 429; // Too Many Requests
    }
    
    return NextResponse.json(
      { 
        error: '杞啓澶辫触', 
        details: errorMessage,
        suggestion: errorMessage.includes('閰嶉涓嶈冻') 
          ? '璇锋鏌?OpenAI 璐︽埛浣欓锛屾垨鑰冭檻浣跨敤鍏朵粬璇煶杞啓鏈嶅姟' 
          : undefined
      },
      { status: statusCode }
    );
  }
}
