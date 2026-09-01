import type { BrandRankingDataset, InsightsDataset, Top100Dataset } from "../types";

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

export function getTop100Dataset(period?: string) {
  const q = period ? `?period=${encodeURIComponent(period)}` : "";
  return fetchJson<Top100Dataset>(`/api/intelligence/top100${q}`);
}

export function getBrandRanking(period?: string) {
  const q = period ? `?period=${encodeURIComponent(period)}` : "";
  return fetchJson<BrandRankingDataset>(`/api/intelligence/brand-ranking${q}`);
}

export function getInsights(period?: string) {
  const q = period ? `?period=${encodeURIComponent(period)}` : "";
  return fetchJson<InsightsDataset>(`/api/intelligence/insights${q}`);
}

export function getIntelligencePeriods() {
  return fetchJson<{ periods: string[] }>("/api/intelligence/periods");
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
export function getPriceTrend(id: string) {
  return fetchJson<PriceTrendPayload>(`/api/intelligence/price-trend?id=${encodeURIComponent(id)}`);
}

// 图片走静态路由 /competitor-images/<encoded-filename>
// 输入是 build-intelligence-dataset.mjs 生成的 imageFile 字段
export function competitorImageUrl(imageFile: string | null): string | null {
  if (!imageFile) return null;
  return `/competitor-images/${encodeURIComponent(imageFile)}`;
}
