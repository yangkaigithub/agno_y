// 鏁版嵁搴撴搷浣滃嚱鏁?- 宸茶縼绉诲埌鐩存帴浣跨敤 PostgreSQL
// 姝ゆ枃浠朵繚鐣欑敤浜庡悜鍚庡吋瀹癸紝瀹為檯瀹炵幇宸茬Щ鑷?lib/db.ts
// 鎵€鏈夊嚱鏁扮幇鍦ㄩ€氳繃 API 璺敱璋冪敤锛屼笉鍐嶇洿鎺ュ湪鍓嶇浣跨敤

import type { Project, MiniSummary } from './types';

// 閲嶆柊瀵煎嚭鏁版嵁搴撳嚱鏁帮紙杩欎簺鍑芥暟鐜板湪鍦ㄦ湇鍔＄浣跨敤锛?export {
  createProject,
  getProjects,
  getProject,
  updateProject,
  createMiniSummary,
  getMiniSummaries,
} from './db';

// 鏂囦欢涓婁紶鍔熻兘宸茬Щ鑷?API 璺敱 /api/upload
// 鍓嶇搴斾娇鐢?fetch('/api/upload', ...) 杩涜鏂囦欢涓婁紶
