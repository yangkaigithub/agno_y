import crypto from 'crypto';

// 鐢熸垚闃块噷浜戞櫤鑳借闊充氦浜?Token
// 鍙互鍦ㄦ湇鍔＄鐩存帴璋冪敤锛岄伩鍏?HTTP 璇锋眰
export async function generateAliyunToken(): Promise<{ token: string; expireTime: number }> {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;

  if (!accessKeyId || !accessKeySecret) {
    throw new Error('闃块噷浜?AccessKey 鏈厤缃紝璇疯缃?ALIYUN_ACCESS_KEY_ID 鍜?ALIYUN_ACCESS_KEY_SECRET');
  }

  // 鏋勫缓璇锋眰鍙傛暟
  const timestamp = new Date().toISOString();
  const nonce = Date.now().toString();
  const params: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Action: 'CreateToken',
    Format: 'JSON',
    RegionId: 'cn-shanghai',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: nonce,
    SignatureVersion: '1.0',
    Timestamp: timestamp,
    Version: '2019-02-28',
  };

  // 瀵瑰弬鏁拌繘琛屾帓搴忓苟鏋勫缓鏌ヨ瀛楃涓?  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  // 鏋勫缓寰呯鍚嶅瓧绗︿覆
  const stringToSign = `GET&${encodeURIComponent('/')}&${encodeURIComponent(sortedParams)}`;

  // 浣跨敤 HMAC-SHA1 绛惧悕
  const signature = crypto
    .createHmac('sha1', accessKeySecret + '&')
    .update(stringToSign)
    .digest('base64');

  // 娣诲姞绛惧悕鍒板弬鏁?  const finalParams = `${sortedParams}&${encodeURIComponent('Signature')}=${encodeURIComponent(signature)}`;

  // 璋冪敤闃块噷浜?STS 鏈嶅姟鑾峰彇 Token
  const tokenUrl = `https://nls-meta.cn-shanghai.aliyuncs.com/?${finalParams}`;

  const response = await fetch(tokenUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`鑾峰彇 Token 澶辫触: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  
  // 妫€鏌ヨ繑鍥炵粨鏋?  if (data.Token) {
    return {
      token: data.Token.Id,
      expireTime: data.Token.ExpireTime,
    };
  } else if (data.TokenId) {
    return {
      token: data.TokenId,
      expireTime: Math.floor(Date.now() / 1000) + 86400, // 榛樿 24 灏忔椂
    };
  } else {
    throw new Error(`Token 鐢熸垚澶辫触: ${JSON.stringify(data)}`);
  }
}
