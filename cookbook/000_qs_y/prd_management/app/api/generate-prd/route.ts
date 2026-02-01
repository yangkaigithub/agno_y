import { NextRequest, NextResponse } from 'next/server';
import { generatePRD, generatePRDFromSummaries, prdToMarkdown } from '@/lib/openai';

export async function POST(request: NextRequest) {
  try {
    const { transcription, summaries, title } = await request.json();

    // 浼樺厛浣跨敤闃舵鎬ф€荤粨鐢熸垚 PRD锛堟洿楂樻晥锛岄伩鍏嶈秴闀挎枃鏈級
    if (summaries && summaries.length > 0) {
      console.log(`馃摑 浣跨敤 ${summaries.length} 涓樁娈垫€ф€荤粨鐢熸垚 PRD`);
      const prdContent = await generatePRDFromSummaries(summaries);
      const markdown = prdToMarkdown(prdContent, title || '浜у搧闇€姹傛枃妗?);
      
      return NextResponse.json({ 
        prd: prdContent,
        markdown 
      });
    }

    // 鍥為€€锛氫娇鐢ㄥ師濮嬭浆鍐欐枃鏈?    if (!transcription) {
      return NextResponse.json(
        { error: '鏈彁渚涜浆鍐欐枃鏈垨闃舵鎬ф€荤粨' },
        { status: 400 }
      );
    }

    console.log('馃摑 浣跨敤鍘熷杞啓鏂囨湰鐢熸垚 PRD');
    const prdContent = await generatePRD(transcription);
    const markdown = prdToMarkdown(prdContent, title || '浜у搧闇€姹傛枃妗?);
    
    return NextResponse.json({ 
      prd: prdContent,
      markdown 
    });
  } catch (error) {
    console.error('鐢熸垚 PRD 閿欒:', error);
    return NextResponse.json(
      { error: '鐢熸垚 PRD 澶辫触', details: error instanceof Error ? error.message : '鏈煡閿欒' },
      { status: 500 }
    );
  }
}
