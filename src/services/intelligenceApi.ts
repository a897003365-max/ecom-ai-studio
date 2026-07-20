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

export function getTop100Dataset() {
  return fetchJson<Top100Dataset>("/api/intelligence/top100");
}

export function getBrandRanking() {
  return fetchJson<BrandRankingDataset>("/api/intelligence/brand-ranking");
}

export function getInsights() {
  return fetchJson<InsightsDataset>("/api/intelligence/insights");
}

// 图片走静态路由 /competitor-images/<encoded-filename>
// 输入是 build-intelligence-dataset.mjs 生成的 imageFile 字段
export function competitorImageUrl(imageFile: string | null): string | null {
  if (!imageFile) return null;
  return `/competitor-images/${encodeURIComponent(imageFile)}`;
}
