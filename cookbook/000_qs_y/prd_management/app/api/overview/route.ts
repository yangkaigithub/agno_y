import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// 澶фā鍨嬮厤缃?const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '',
  baseURL: process.env.DEEPSEEK_API_KEY 
    ? 'https://api.deepseek.com' 
    : 'https://api.openai.com/v1',
});

const defaultModel = process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'gpt-4o';

// 鐢熸垚鍏ㄦ枃姒傝锛堝悎骞朵笂娆℃瑙?+ 鏂伴樁娈垫€荤粨锛?export async function POST(request: NextRequest) {
  try {
    const { previousOverview, newSummary } = await request.json();

    if (!newSummary) {
      return NextResponse.json(
        { error: '鏈彁渚涙柊鐨勯樁娈垫€荤粨' },
        { status: 400 }
      );
    }

    // 妫€鏌ユ槸鍚︿娇鐢?Mock 妯″紡
    if (process.env.USE_MOCK === 'true') {
      const mockOverview = previousOverview 
        ? `${previousOverview}\n\n銆愭柊澧炶鐐广€?{newSummary.substring(0, 100)}...`
        : `銆愪細璁瑙堛€?{newSummary.substring(0, 200)}...`;
      
      return NextResponse.json({ overview: mockOverview });
    }

    const prompt = previousOverview
      ? `鏁村悎浠ヤ笅鍐呭锛岃緭鍑哄畬鏁寸殑瑕佺偣姒傝銆?
瑕佹眰锛?1. 绾枃鏈紝绂佹 markdown 绗﹀彿
2. 鐩存帴闄堣堪鍐呭锛屼笉瑕佸紑鍦虹櫧
3. 鍚堝苟閲嶅锛屾寜涓婚缁勭粐
4. 300 瀛椾互鍐?
銆愬凡鏈夊唴瀹广€?${previousOverview}

銆愭柊澧炲唴瀹广€?${newSummary}

杈撳嚭锛歚
      : `鎻愬彇浠ヤ笅鍐呭鐨勬牳蹇冭鐐规瑙堛€?
瑕佹眰锛?1. 绾枃鏈紝绂佹 markdown 绗﹀彿
2. 鐩存帴闄堣堪鍐呭锛屼笉瑕佸紑鍦虹櫧
3. 200 瀛椾互鍐?
銆愬唴瀹广€?${newSummary}

杈撳嚭锛歚;

    const response = await openai.chat.completions.create({
      model: defaultModel,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 500,
    });

    const overview = response.choices[0]?.message?.content || '';

    return NextResponse.json({ overview });
  } catch (error) {
    console.error('鐢熸垚鍏ㄦ枃姒傝澶辫触:', error);
    return NextResponse.json(
      { error: '鐢熸垚鍏ㄦ枃姒傝澶辫触', details: error instanceof Error ? error.message : '鏈煡閿欒' },
      { status: 500 }
    );
  }
}
