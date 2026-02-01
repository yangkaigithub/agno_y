// 浣跨敤鍔ㄦ€佸鍏ラ伩鍏?Next.js 鏋勫缓鏃剁殑渚濊禆闂
// 娉ㄦ剰锛氭妯″潡鍙兘鍦ㄦ湇鍔＄浣跨敤锛圓PI Routes锛?
// 鑾峰彇 OSS 瀹㈡埛绔厤缃?function getOSSConfig() {
  const region = process.env.ALIYUN_OSS_REGION || 'oss-cn-shanghai';
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
  const bucket = process.env.ALIYUN_OSS_BUCKET;

  if (!accessKeyId || !accessKeySecret || !bucket) {
    throw new Error('闃块噷浜?OSS 閰嶇疆涓嶅畬鏁达紝璇疯缃?ALIYUN_ACCESS_KEY_ID銆丄LIYUN_ACCESS_KEY_SECRET 鍜?ALIYUN_OSS_BUCKET');
  }

  return {
    region,
    accessKeyId,
    accessKeySecret,
    bucket,
  };
}

// 鍔ㄦ€佸鍏?OSS 瀹㈡埛绔?async function getOSSClient() {
  // 鍔ㄦ€佸鍏ワ紝閬垮厤鍦ㄦ瀯寤烘椂瑙ｆ瀽渚濊禆
  const OSS = (await import('ali-oss')).default;
  const config = getOSSConfig();
  
  return new OSS({
    region: config.region,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    bucket: config.bucket,
  });
}

// 鍒涘缓 OSS 瀹㈡埛绔紙淇濇寔鍚戝悗鍏煎锛屼絾浣跨敤鍔ㄦ€佸鍏ワ級
export async function createOSSClient() {
  return await getOSSClient();
}

// 涓婁紶鏂囦欢鍒?OSS
export async function uploadToOSS(
  file: File | Buffer,
  objectName: string,
  options?: {
    contentType?: string;
    metadata?: Record<string, string>;
    generateSignedUrl?: boolean; // 鏄惁鐢熸垚棰勭鍚?URL
    signedUrlExpires?: number;   // 棰勭鍚?URL 鏈夋晥鏈燂紙绉掞級
  }
): Promise<{ url: string; objectName: string }> {
  const client = await getOSSClient();
  
  // 濡傛灉鏄?File 瀵硅薄锛岃浆鎹负 Buffer
  let buffer: Buffer;
  if (file instanceof File) {
    const arrayBuffer = await file.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } else {
    buffer = file;
  }

  // 涓婁紶鏂囦欢
  const result = await client.put(objectName, buffer, {
    headers: {
      'Content-Type': options?.contentType || 'audio/wav',
      ...options?.metadata,
    },
  });

  // 鐢熸垚璁块棶 URL
  let url = result.url;
  
  // 濡傛灉闇€瑕侀绛惧悕 URL锛堢敤浜庣鏈?bucket 鎴栭渶瑕佷复鏃惰闂級
  if (options?.generateSignedUrl !== false) {
    // 榛樿鐢熸垚 1 灏忔椂鏈夋晥鏈熺殑棰勭鍚?URL
    const expires = options?.signedUrlExpires || 3600;
    url = client.signatureUrl(result.name, { expires });
    console.log('馃數 鐢熸垚棰勭鍚?URL锛屾湁鏁堟湡:', expires, '绉?);
  }

  return {
    url,
    objectName: result.name,
  };
}

// 鐢熸垚棰勭鍚?URL锛堢敤浜庝复鏃惰闂級
export async function generatePresignedURL(
  objectName: string,
  expires: number = 3600
): Promise<string> {
  const client = await getOSSClient();
  return client.signatureUrl(objectName, { expires });
}

// 鍒犻櫎 OSS 鏂囦欢
export async function deleteOSSFile(objectName: string): Promise<void> {
  const client = await getOSSClient();
  await client.delete(objectName);
}
