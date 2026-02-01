import { NextRequest, NextResponse } from 'next/server';
import { createMiniSummary } from '@/lib/db';

// 鎵归噺鍒涘缓闃舵鎬ф€荤粨
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { project_id, summaries } = body;

    if (!project_id) {
      return NextResponse.json(
        { error: '缂哄皯蹇呰鍙傛暟锛歱roject_id' },
        { status: 400 }
      );
    }

    if (!Array.isArray(summaries)) {
      return NextResponse.json(
        { error: 'summaries 蹇呴』鏄暟缁? },
        { status: 400 }
      );
    }

    // 鎵归噺鍒涘缓闃舵鎬ф€荤粨
    const results = [];
    for (const summary of summaries) {
      if (!summary.timestamp || !summary.content) {
        console.warn('璺宠繃鏃犳晥鐨勬€荤粨:', summary);
        continue;
      }

      const created = await createMiniSummary({
        project_id,
        timestamp: summary.timestamp,
        content: summary.content,
      });

      if (created) {
        results.push(created);
      }
    }

    return NextResponse.json({
      success: true,
      count: results.length,
      summaries: results,
    });
  } catch (error) {
    console.error('鎵归噺鍒涘缓闃舵鎬ф€荤粨閿欒:', error);
    return NextResponse.json(
      { 
        error: '鎵归噺鍒涘缓闃舵鎬ф€荤粨澶辫触',
        details: error instanceof Error ? error.message : '鏈煡閿欒'
      },
      { status: 500 }
    );
  }
}
