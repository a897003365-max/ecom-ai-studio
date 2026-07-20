import type { QueueTask } from "../types";
import type { AnalyticsIntegrationPayload, DataSourcesPayload, ProductsPayload, UploadRecord } from "../types/integration";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

export async function uploadLocalDataFile(file: File, category: string): Promise<UploadRecord> {
  if (file.size > 10 * 1024 * 1024) throw new Error("MVP 单文件上限为 10 MB");
  const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
  const payload = await request<{ upload: UploadRecord }>("/api/uploads", {
    method: "POST",
    body: JSON.stringify({ fileName: file.name, category, contentBase64 }),
  });
  return payload.upload;
}
