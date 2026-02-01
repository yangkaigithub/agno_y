import { NextRequest, NextResponse } from 'next/server';
import { uploadToOSS } from '@/lib/aliyun-oss';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const projectId = formData.get('projectId') as string;

    if (!file) {
      return NextResponse.json(
        { error: '鏈彁渚涙枃浠? },
        { status: 400 }
      );
    }

    // 妫€鏌ユ枃浠剁被鍨?    const validTypes = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/x-m4a'];
    const validExtensions = ['.mp3', '.wav', '.m4a', '.webm'];
    const fileExt = file.name.split('.').pop()?.toLowerCase() || '';

    if (!validTypes.includes(file.type) && !validExtensions.includes(`.${fileExt}`)) {
      return NextResponse.json(
        { error: '涓嶆敮鎸佺殑鏂囦欢鏍煎紡锛岃涓婁紶 MP3銆乄AV 鎴?M4A 鏂囦欢' },
        { status: 400 }
      );
    }

    // 鐢熸垚 OSS 瀵硅薄鍚嶇О
    const timestamp = Date.now();
    const objectName = projectId 
      ? `audio/${projectId}/${timestamp}.${fileExt}`
      : `audio/${timestamp}.${fileExt}`;

    // 涓婁紶鍒?OSS锛堢敓鎴愰绛惧悕 URL锛屾湁鏁堟湡 1 灏忔椂锛?    const { url, objectName: uploadedName } = await uploadToOSS(file, objectName, {
      contentType: file.type || `audio/${fileExt}`,
      generateSignedUrl: true,
      signedUrlExpires: 3600,
    });

    return NextResponse.json({
      url,
      objectName: uploadedName,
      fileName: file.name,
    });
  } catch (error) {
    console.error('OSS 涓婁紶閿欒:', error);
    const errorMessage = error instanceof Error ? error.message : '鏈煡閿欒';
    
    return NextResponse.json(
      { error: '涓婁紶澶辫触', details: errorMessage },
      { status: 500 }
    );
  }
}
