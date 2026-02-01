import { NextResponse } from 'next/server';
import { generateAliyunToken } from '@/lib/aliyun-token';

// 鐢熸垚闃块噷浜戞櫤鑳借闊充氦浜?Token API
// 杩斿洖 Token銆丄ppKey 鍜?WebSocket URL锛屼緵瀹㈡埛绔洿杩?export async function GET() {
  try {
    const result = await generateAliyunToken();
    
    // 鑾峰彇 AppKey 鍜屽尯鍩?    const appKey = process.env.ALIYUN_ASR_APP_KEY?.trim();
    const region = process.env.ALIYUN_ASR_REGION || 'cn-shanghai';
    
    if (!appKey) {
      throw new Error('ALIYUN_ASR_APP_KEY 鏈厤缃?);
    }
    
    // WebSocket URL锛堝疄鏃惰闊宠浆鍐欙級
    const wsUrl = `wss://nls-gateway.${region}.aliyuncs.com/ws/v1`;
    
    return NextResponse.json({
      ...result,
      appKey,
      wsUrl,
      region
    });
  } catch (error) {
    console.error('鐢熸垚闃块噷浜?Token 閿欒:', error);
    return NextResponse.json(
      { 
        error: '鐢熸垚 Token 澶辫触', 
        details: error instanceof Error ? error.message : '鏈煡閿欒' 
      },
      { status: 500 }
    );
  }
}
