import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// 鏂囦欢瀛樺偍鐩綍锛堢浉瀵逛簬椤圭洰鏍圭洰褰曪級
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'public', 'uploads', 'audio');

// 纭繚涓婁紶鐩綍瀛樺湪
async function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureUploadDir();

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

    // 鐢熸垚鏂囦欢鍚?    const fileName = projectId 
      ? `${projectId}/${Date.now()}.${fileExt}`
      : `${Date.now()}.${fileExt}`;
    
    const filePath = join(UPLOAD_DIR, fileName);

    // 纭繚椤圭洰鐩綍瀛樺湪
    if (projectId) {
      const projectDir = join(UPLOAD_DIR, projectId);
      if (!existsSync(projectDir)) {
        await mkdir(projectDir, { recursive: true });
      }
    }

    // 灏嗘枃浠跺啓鍏ョ鐩?    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // 鐢熸垚璁块棶 URL
    // 濡傛灉浣跨敤鐩稿璺緞锛屽墠绔彲浠ラ€氳繃 /uploads/audio/... 璁块棶
    const publicUrl = `/uploads/audio/${fileName}`;

    // 鎴栬€呬娇鐢ㄧ粷瀵?URL锛堝鏋滈厤缃簡 BASE_URL锛?    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';
    const fullUrl = baseUrl ? `${baseUrl}${publicUrl}` : publicUrl;

    return NextResponse.json({
      url: fullUrl,
      path: fileName,
    });
  } catch (error) {
    console.error('鏂囦欢涓婁紶閿欒:', error);
    return NextResponse.json(
      { error: '鏂囦欢涓婁紶澶辫触', details: error instanceof Error ? error.message : '鏈煡閿欒' },
      { status: 500 }
    );
  }
}
