import OpenAI from 'openai';
import type { PRDContent } from './types';

// 鏀寔 DeepSeek 鍜?OpenAI
const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '';
const baseURL = process.env.DEEPSEEK_API_KEY 
  ? 'https://api.deepseek.com/v1'
  : undefined;
const defaultModel = process.env.DEEPSEEK_API_KEY
  ? 'deepseek-chat'
  : 'gpt-4o';

const openai = new OpenAI({
  apiKey,
  baseURL,
});

if (!apiKey) {
  console.warn('API Key 鏈厤缃紝璇疯缃?DEEPSEEK_API_KEY 鎴?OPENAI_API_KEY 鐜鍙橀噺');
}

// 璇煶杞枃瀛楀姛鑳藉凡杩佺Щ鍒?lib/transcribe.ts
// 涓轰簡鍚戝悗鍏煎锛岃繖閲岄噸鏂板鍑?export { transcribeAudio } from './transcribe';

// 鐢熸垚闃舵鎬ф€荤粨锛堟瘡 2 鍒嗛挓锛?export async function generateMiniSummary(text: string): Promise<string> {
  // 濡傛灉鍚敤浜?MOCK 妯″紡锛屼娇鐢?mock 鍑芥暟
  if (process.env.USE_MOCK === 'true') {
    console.log('馃敡 浣跨敤 Mock 妯″紡鐢熸垚闃舵鎬ф€荤粨');
    const { mockGenerateMiniSummary } = await import('./mock');
    return mockGenerateMiniSummary(text);
  }

  try {
    const response = await openai.chat.completions.create({
      model: defaultModel,
      messages: [
        {
          role: 'system',
          content: `鎻愬彇浠ヤ笅鍐呭鐨勬牳蹇冭鐐广€?
瑕佹眰锛?1. 绾枃鏈紝绂佹 markdown 绗﹀彿
2. 鐩存帴闄堣堪瑕佺偣锛屼笉瑕?鏈璁ㄨ浜?绛夊紑鍦虹櫧
3. 绠€娲佷笓涓氾紝150 瀛椾互鍐卄
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.5,
      max_tokens: 250,
    });

    return response.choices[0]?.message?.content || '鏃犳硶鐢熸垚鎬荤粨';
  } catch (error) {
    console.error('鐢熸垚闃舵鎬ф€荤粨澶辫触:', error);
    throw error;
  }
}

// 鐢熸垚瀹屾暣鐨?PRD
export async function generatePRD(transcription: string): Promise<PRDContent> {
  // 濡傛灉鍚敤浜?MOCK 妯″紡锛屼娇鐢?mock 鍑芥暟
  if (process.env.USE_MOCK === 'true') {
    console.log('馃敡 浣跨敤 Mock 妯″紡鐢熸垚 PRD');
    const { mockGeneratePRD } = await import('./mock');
    return mockGeneratePRD(transcription);
  }

  try {
    const response = await openai.chat.completions.create({
      model: defaultModel,
      messages: [
        {
          role: 'system',
          content: `浣犳槸涓€浣嶈祫娣变骇鍝佷笓瀹躲€傝鍒嗘瀽浠ヤ笅浼氳杞啓鏂囨湰锛屽墧闄ゅ彛姘磋瘽锛屾彁鍙栨牳蹇冧笟鍔￠€昏緫銆傝浠ヤ笓涓氱殑 PRD 鏍煎紡杈撳嚭锛岄噸鐐圭獊鍑哄鎴风棝鐐瑰拰鍔熻兘鐗规€х殑浼樺厛绾с€傝瑷€瑕佹眰绠€缁冦€佸噯纭€?
璇锋寜鐓т互涓?JSON 鏍煎紡杈撳嚭锛?{
  "background": "椤圭洰鑳屾櫙鎻忚堪",
  "objectives": ["鐩爣1", "鐩爣2"],
  "painPoints": ["鐥涚偣1", "鐥涚偣2"],
  "userStories": [
    {
      "as": "浣滀负...",
      "want": "鎴戞兂瑕?..",
      "soThat": "浠ヤ究..."
    }
  ],
  "features": [
    {
      "name": "鍔熻兘鍚嶇О",
      "description": "鍔熻兘鎻忚堪",
      "priority": "high|medium|low"
    }
  ],
  "flows": "娴佺▼鍥炬弿杩版垨鍏抽敭娴佺▼璇存槑"
}`
        },
        {
          role: 'user',
          content: transcription
        }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '{}';
    return JSON.parse(content) as PRDContent;
  } catch (error) {
    console.error('鐢熸垚 PRD 澶辫触:', error);
    throw error;
  }
}

// 浣跨敤闃舵鎬ф€荤粨鐢熸垚 PRD锛堟帹鑽愶細鏇撮珮鏁堬紝閬垮厤瓒呴暱鏂囨湰锛?export async function generatePRDFromSummaries(summaries: { content: string; timestamp: number }[]): Promise<PRDContent> {
  // 濡傛灉鍚敤浜?MOCK 妯″紡锛屼娇鐢?mock 鍑芥暟
  if (process.env.USE_MOCK === 'true') {
    console.log('馃敡 浣跨敤 Mock 妯″紡鐢熸垚 PRD锛堝熀浜庨樁娈垫€ф€荤粨锛?);
    const { mockGeneratePRD } = await import('./mock');
    return mockGeneratePRD('');
  }

  try {
    // 鏍煎紡鍖栭樁娈垫€ф€荤粨锛屾坊鍔犳椂闂存埑鏍囪
    const formattedSummaries = summaries.map((s, index) => {
      const minutes = Math.floor(s.timestamp / 60);
      const seconds = s.timestamp % 60;
      return `銆愮 ${index + 1} 娈碉紝鏃堕棿 ${minutes}:${seconds.toString().padStart(2, '0')}銆慭n${s.content}`;
    }).join('\n\n---\n\n');

    console.log(`馃搳 鍏?${summaries.length} 涓樁娈垫€ф€荤粨锛屾€诲瓧绗︽暟: ${formattedSummaries.length}`);

    const response = await openai.chat.completions.create({
      model: defaultModel,
      messages: [
        {
          role: 'system',
          content: `浣犳槸涓€浣嶈祫娣变骇鍝佷笓瀹躲€備互涓嬫槸涓€鍦洪渶姹傝璁轰細鐨勯樁娈垫€ф€荤粨锛堟瘡 2 鍒嗛挓鎻愬彇涓€娆″叧閿唴瀹癸級銆?
璇风患鍚堝垎鏋愯繖浜涢樁娈垫€ф€荤粨锛屾暣鍚堥噸澶嶅唴瀹癸紝鎻愬彇鏍稿績涓氬姟閫昏緫锛岀敓鎴愪竴浠藉畬鏁寸殑 PRD 鏂囨。銆?
瑕佹眰锛?1. 鍚堝苟鐩镐技鎴栭噸澶嶇殑闇€姹傜偣
2. 鎸変紭鍏堢骇鎺掑簭鍔熻兘鐗规€?3. 璇█绠€缁冦€佷笓涓?
璇锋寜鐓т互涓?JSON 鏍煎紡杈撳嚭锛?{
  "background": "椤圭洰鑳屾櫙鎻忚堪锛堢患鍚堟墍鏈夎璁哄唴瀹癸級",
  "objectives": ["鐩爣1", "鐩爣2"],
  "painPoints": ["鐥涚偣1", "鐥涚偣2"],
  "userStories": [
    {
      "as": "浣滀负...",
      "want": "鎴戞兂瑕?..",
      "soThat": "浠ヤ究..."
    }
  ],
  "features": [
    {
      "name": "鍔熻兘鍚嶇О",
      "description": "鍔熻兘鎻忚堪",
      "priority": "high|medium|low"
    }
  ],
  "flows": "娴佺▼鍥炬弿杩版垨鍏抽敭娴佺▼璇存槑"
}`
        },
        {
          role: 'user',
          content: `浠ヤ笅鏄細璁殑 ${summaries.length} 涓樁娈垫€ф€荤粨锛歕n\n${formattedSummaries}`
        }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '{}';
    return JSON.parse(content) as PRDContent;
  } catch (error) {
    console.error('浠庨樁娈垫€ф€荤粨鐢熸垚 PRD 澶辫触:', error);
    throw error;
  }
}

// 灏?PRD 鍐呭杞崲涓?Markdown
export function prdToMarkdown(prd: PRDContent, title: string): string {
  let markdown = `# ${title}\n\n`;

  markdown += `## 1. 椤圭洰鑳屾櫙\n\n${prd.background}\n\n`;

  markdown += `## 2. 椤圭洰鐩爣\n\n`;
  prd.objectives.forEach((obj, index) => {
    markdown += `${index + 1}. ${obj}\n`;
  });
  markdown += '\n';

  markdown += `## 3. 鏍稿績鐥涚偣\n\n`;
  prd.painPoints.forEach((point, index) => {
    markdown += `${index + 1}. ${point}\n`;
  });
  markdown += '\n';

  markdown += `## 4. 鐢ㄦ埛鏁呬簨\n\n`;
  prd.userStories.forEach((story, index) => {
    markdown += `### 鐢ㄦ埛鏁呬簨 ${index + 1}\n\n`;
    markdown += `- **浣滀负** ${story.as}\n`;
    markdown += `- **鎴戞兂瑕?* ${story.want}\n`;
    markdown += `- **浠ヤ究** ${story.soThat}\n\n`;
  });

  markdown += `## 5. 鍔熻兘鐗规€n\n`;
  prd.features.forEach((feature, index) => {
    const priorityEmoji = feature.priority === 'high' ? '馃敶' : feature.priority === 'medium' ? '馃煛' : '馃煝';
    markdown += `### ${index + 1}. ${feature.name} ${priorityEmoji} [${feature.priority}]\n\n`;
    markdown += `${feature.description}\n\n`;
  });

  markdown += `## 6. 娴佺▼鍥炬弿杩癨n\n${prd.flows}\n\n`;

  return markdown;
}
