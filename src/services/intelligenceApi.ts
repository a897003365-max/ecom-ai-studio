import type { BrandRankingDataset, InsightsDataset, Top100Dataset, Top100ItemV2 } from "../types";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) window.dispatchEvent(new Event("ecom:session-expired"));
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(message || `请求 ${path} 失败：${response.status}`);
  }
  return response.json() as Promise<T>;
}

// 类目：与 server INTELLIGENCE_CATEGORIES 对齐；undefined/"mattress" = 床垫类（默认，无文件名后缀）
function intelligenceQuery(params: { period?: string; category?: string }) {
  const q = new URLSearchParams();
  if (params.period) q.set("period", params.period);
  if (params.category && params.category !== "mattress") q.set("category", params.category);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function getTop100Dataset(period?: string, category?: string) {
  return fetchJson<Top100Dataset>(`/api/intelligence/top100${intelligenceQuery({ period, category })}`);
}

export function getBrandRanking(period?: string, category?: string) {
  return fetchJson<BrandRankingDataset>(`/api/intelligence/brand-ranking${intelligenceQuery({ period, category })}`);
}

export function getInsights(period?: string, category?: string) {
  return fetchJson<InsightsDataset>(`/api/intelligence/insights${intelligenceQuery({ period, category })}`);
}

export function getIntelligencePeriods(category?: string) {
  return fetchJson<{ periods: string[] }>(`/api/intelligence/periods${intelligenceQuery({ category })}`);
}

export interface PriceTrendPoint {
  period: string;
  price: number | null;
  rawPrice: string | null;
  originalPrice: number | null;
  low30d: number | null;
  imageUrl: string | null;
}

export interface PriceTrendPayload {
  id: string;
  productName: string | null;
  points: PriceTrendPoint[];
  snapshots: number;
}

// 价格趋势：聚合服务端 price-snapshots 多期快照（快照不足时前端用静态周期兜底）
export function getPriceTrend(id: string, category?: string) {
  const q = new URLSearchParams({ id });
  if (category && category !== "mattress") q.set("category", category);
  return fetchJson<PriceTrendPayload>(`/api/intelligence/price-trend?${q.toString()}`);
}

// 图片走静态路由 /competitor-images/<encoded-filename>
// 输入是 build-intelligence-dataset.mjs 生成的 imageFile 字段
export function competitorImageUrl(imageFile: string | null): string | null {
  if (!imageFile) return null;
  return `/competitor-images/${encodeURIComponent(imageFile)}`;
}

// ---------- CP 细粒度重算 ----------
// 模型直出的 CP 是 1-5 整数（约 80% 商品扎堆 4 分）。展示层统一改用 8 个子维度等权平均
// （保留两位小数）作为 CP，同分按 CI 卖点 → CJ 差异 → CK 价格依次决胜，排名不留并列。
// 新周期由 build-intelligence-dataset.mjs 直接产出同口径细分；此处覆盖已发布的旧周期数据。
const CP_DIMS = [
  "CH_clarity", "CI_sellpoint", "CJ_diff", "CK_price",
  "CL_gift", "CM_trust", "CN_urgency", "CO_visual",
] as const;

function fineCp(scores: Top100ItemV2["scores"]): number | null {
  const vals = CP_DIMS.map((k) => scores[k]);
  if (vals.some((v) => typeof v !== "number")) return scores.CP_total ?? null;
  return Math.round(((vals as number[]).reduce((s, v) => s + v, 0) / CP_DIMS.length) * 100) / 100;
}

/** 重算 TOP100 每条商品的 CP 与 cpRank；无任何评分时原样返回（兜底数据集不重排） */
export function recalcCpScores(dataset: Top100Dataset): Top100Dataset {
  if (!dataset.items.some((i) => i.scores.CP_total != null)) return dataset;
  const items = dataset.items.map((i) => ({ ...i, scores: { ...i.scores, CP_total: fineCp(i.scores) } }));
  items.sort((a, b) =>
    (b.scores.CP_total ?? 0) - (a.scores.CP_total ?? 0)
    || (b.scores.CI_sellpoint ?? 0) - (a.scores.CI_sellpoint ?? 0)
    || (b.scores.CJ_diff ?? 0) - (a.scores.CJ_diff ?? 0)
    || (b.scores.CK_price ?? 0) - (a.scores.CK_price ?? 0)
    || a.row - b.row);
  items.forEach((item, idx) => { item.cpRank = idx + 1; });
  return { ...dataset, items };
}

/** 品牌排行按重算后的 CP 重新聚合（服务端 brand-ranking.json 的 avgCP 是旧整数口径） */
export function deriveBrandRanking(top100: Top100Dataset, fallback: BrandRankingDataset | null): BrandRankingDataset | null {
  if (!top100.items.some((i) => i.scores.CP_total != null)) return fallback;
  const byBrand = new Map<string, { brand: string; rows: number[]; total: number }>();
  for (const item of top100.items) {
    if (item.scores.CP_total == null || !item.brand) continue;
    const bucket = byBrand.get(item.brand) ?? { brand: item.brand, rows: [], total: 0 };
    bucket.rows.push(item.row);
    bucket.total += item.scores.CP_total;
    byBrand.set(item.brand, bucket);
  }
  const ranking = Array.from(byBrand.values())
    .map((b) => ({
      brand: b.brand,
      count: b.rows.length,
      avgCP: Math.round((b.total / b.rows.length) * 100) / 100,
      rows: b.rows,
      rank: 0,
      isOwnBrand: false,
    }))
    .sort((a, b) => b.avgCP - a.avgCP || b.count - a.count || a.brand.localeCompare(b.brand));
  ranking.forEach((r, i) => {
    r.rank = i + 1;
    r.isOwnBrand = r.brand === "麻大师";
  });
  return { generatedAt: fallback?.generatedAt ?? new Date().toISOString(), ranking };
}
