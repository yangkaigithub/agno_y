import { NextRequest, NextResponse } from 'next/server';
import { createMiniSummary, getMiniSummaries } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json(
        { error: '缂哄皯 projectId 鍙傛暟' },
        { status: 400 }
      );
    }

    const summaries = await getMiniSummaries(projectId);
    return NextResponse.json(summaries);
  } catch (error) {
    console.error('鑾峰彇闃舵鎬ф€荤粨閿欒:', error);
    return NextResponse.json(
      { error: '鑾峰彇闃舵鎬ф€荤粨澶辫触' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { project_id, timestamp, content } = body;

    if (!project_id || timestamp === undefined || !content) {
      return NextResponse.json(
        { error: '缂哄皯蹇呰鍙傛暟锛歱roject_id, timestamp, content' },
        { status: 400 }
      );
    }

    const summary = await createMiniSummary({
      project_id,
      timestamp,
      content,
    });

    if (!summary) {
      return NextResponse.json(
        { error: '鍒涘缓闃舵鎬ф€荤粨澶辫触' },
        { status: 500 }
      );
    }

    return NextResponse.json(summary);
  } catch (error) {
    console.error('鍒涘缓闃舵鎬ф€荤粨閿欒:', error);
    return NextResponse.json(
      { error: '鍒涘缓闃舵鎬ф€荤粨澶辫触' },
      { status: 500 }
    );
  }
}
