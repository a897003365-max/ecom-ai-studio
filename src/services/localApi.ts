import type { CompetitorPriceItem, QueueTask } from "../types";
import { tmallCompetitorPrices } from "../data/tmallCompetitorData";
import type { AnalyticsIntegrationPayload, DataSourcesPayload, ProductsPayload, UploadRecord } from "../types/integration";
import type { SearchRequest, SearchResponse } from "../types/search";
import { startProgress, stopProgress } from "../utils/progress";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  startProgress();
  try {
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    const payload = await response.json() as T & { error?: string | { message?: string } };
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new Event("ecom:session-expired"));
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(message || `本地服务请求失败：${response.status}`);
    }
    return payload;
  } finally {
    stopProgress();
  }
}

export function getDataSources() {
  return request<DataSourcesPayload>("/api/data-sources");
}

export function getAnalyticsData(filters?: { start: string; end: string }) {
  const query = filters ? `?${new URLSearchParams(filters).toString()}` : "";
  return request<AnalyticsIntegrationPayload>(`/api/analytics${query}`);
}

export function getProductData(filters?: {
  start?: string;
  end?: string;
  statuses?: string[];
  channels?: string[];
  storeShortNames?: string[];
}) {
  if (!filters) return request<ProductsPayload>("/api/products");
  const params = new URLSearchParams();
  if (filters.start) params.set("start", filters.start);
  if (filters.end) params.set("end", filters.end);
  for (const s of filters.statuses ?? []) params.append("status", s);
  for (const channel of filters.channels ?? []) params.append("channel", channel);
  for (const storeShortName of filters.storeShortNames ?? []) params.append("storeShortName", storeShortName);
  const query = params.toString();
  return request<ProductsPayload>(`/api/products${query ? `?${query}` : ""}`);
}

export function syncDataSource(source: "warehouse" | "feishu" | "dingtalk") {
  return request<{ runId: string; snapshot: unknown }>(`/api/sync/${source}`, { method: "POST" });
}

// yudao 业务管理后台 VO（camelCase），字段可空，统一在映射时兜底
export interface YudaoCompetitorPriceVO {
  id?: number | string;
  productName?: string;
  shop?: string;
  brand?: string;
  platform?: string;
  originalPrice?: number | string;
  couponPrice?: number | string;
  campaignInfo?: string;
  previousPrice?: number | string;
  low30d?: number | string;
  newStatus?: string;
  warningStatus?: string;
  alertThreshold?: number | string;
  alertReason?: string;
  suggestedAction?: string;
}

export interface CompetitorPricesPayload {
  items: CompetitorPriceItem[];
  total: number;
  degraded: boolean;
  reason?: string;
}

function toNumber(value: number | string | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPrice(value: number | string | undefined): string {
  const numeric = toNumber(value);
  return numeric === null ? String(value ?? "-") : `¥${numeric.toLocaleString("zh-CN")}`;
}

// 价格变化：对比券后价与上一期价格，与页面既有「▼/▲/持平」展示口径一致
function derivePriceChange(item: YudaoCompetitorPriceVO): string {
  const current = toNumber(item.couponPrice);
  const previous = toNumber(item.previousPrice);
  if (current === null || previous === null || previous <= 0) return "-";
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.0005) return "持平";
  return `${change < 0 ? "▼" : "▲"} ${(Math.abs(change) * 100).toFixed(1)}%`;
}

function warningTone(warningStatus: string): CompetitorPriceItem["tone"] {
  if (warningStatus.includes("预警")) return "red";
  if (warningStatus.includes("观察")) return "orange";
  return "muted";
}

function toCompetitorPriceItem(vo: YudaoCompetitorPriceVO, index: number): CompetitorPriceItem {
  const warningStatus = String(vo.warningStatus ?? "无变化");
  const threshold = toNumber(vo.alertThreshold);
  return {
    id: String(vo.id ?? `yudao-${index}`),
    productName: String(vo.productName ?? "-"),
    mainImage: "🛏️",
    store: String(vo.shop ?? "-"),
    brand: String(vo.brand ?? "-"),
    platform: String(vo.platform ?? "天猫") as CompetitorPriceItem["platform"],
    originalPrice: formatPrice(vo.originalPrice),
    couponPrice: formatPrice(vo.couponPrice),
    campaignInfo: String(vo.campaignInfo ?? "-"),
    previousPrice: formatPrice(vo.previousPrice),
    priceChange: derivePriceChange(vo),
    low30d: formatPrice(vo.low30d),
    newStatus: String(vo.newStatus ?? "-"),
    warningStatus,
    alertThreshold: threshold === null ? String(vo.alertThreshold ?? "-") : `${threshold}%`,
    alertReason: String(vo.alertReason ?? "-"),
    suggestedAction: String(vo.suggestedAction ?? "-"),
    tone: warningTone(warningStatus),
  };
}

// 竞品价格监控：服务端代理 yudao 只读接口；degraded=true 时回退到 tmall-sku-price 实时抓取数据
export async function getCompetitorPrices(): Promise<CompetitorPricesPayload> {
  const payload = await request<{
    items?: YudaoCompetitorPriceVO[];
    total?: number;
    degraded?: boolean;
    reason?: string;
  }>("/api/masterdata/competitor-prices");
  const mapped = (payload.items ?? []).map(toCompetitorPriceItem);
  if (payload.degraded === true || mapped.length === 0) {
    // yudao 不可用 → 用天猫实时抓取数据兜底（tmall-sku-price 项目产出）
    return {
      items: tmallCompetitorPrices,
      total: tmallCompetitorPrices.length,
      degraded: false,
      reason: `yudao 不可用，展示天猫实时抓取数据（${payload.reason ?? "未配置"}）`,
    };
  }
  return {
    items: mapped,
    total: payload.total ?? 0,
    degraded: false,
    reason: payload.reason,
  };
}

export function syncAnalyticsData() {
  return request<{
    status: "success" | "partial" | "failed";
    runs: Array<{ runId: string; sourceId: string; recordCount: number }>;
    failures: Array<{ sourceId: string; detail: string }>;
    dataStatus: unknown;
  }>("/api/sync/analytics", { method: "POST" });
}

export function getPersistedTasks() {
  return request<{ tasks: QueueTask[] }>("/api/tasks");
}

export function persistTask(task: QueueTask) {
  return request<{ task: QueueTask; workflow?: { queueFile: string } | null }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export function persistTaskAction(taskId: string, action: "retry" | "confirm" | "cancel" | "export") {
  return request<{ task: QueueTask }>(`/api/tasks/${encodeURIComponent(taskId)}/actions`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

// 顶部智能找数 · 搜索联想/回答。支持 AbortSignal 取消过期联想请求。
export function searchSite(req: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
  // 用 fetch + AbortController 支持取消；不启动全局进度条，避免联想请求打断顶部进度。
  return fetch("/api/search", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  }).then(async (response) => {
    const payload = (await response.json()) as SearchResponse & { error?: string | { message?: string } };
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new Event("ecom:session-expired"));
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(message || `本地服务请求失败：${response.status}`);
    }
    return payload;
  });
}

export async function uploadLocalDataFile(file: File, category: string): Promise<UploadRecord> {
  if (file.size > 10 * 1024 * 1024) throw new Error("MVP 单文件上限为 10 MB");
  const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
  const payload = await request<{ upload: UploadRecord }>("/api/uploads", {
    method: "POST",
    body: JSON.stringify({ fileName: file.name, category, contentBase64 }),
  });
  return payload.upload;
}
