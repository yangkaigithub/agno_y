import { NextRequest, NextResponse } from 'next/server';
import { generateMiniSummary } from '@/lib/openai';

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    if (!text) {
      return NextResponse.json(
        { error: '鏈彁渚涙枃鏈? },
        { status: 400 }
      );
    }

    const summary = await generateMiniSummary(text);
    
    return NextResponse.json({ summary });
  } catch (error) {
    console.error('鐢熸垚鎬荤粨閿欒:', error);
    return NextResponse.json(
      { error: '鐢熸垚鎬荤粨澶辫触', details: error instanceof Error ? error.message : '鏈煡閿欒' },
      { status: 500 }
    );
  }
}
