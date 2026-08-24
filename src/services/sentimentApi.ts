import type {
  RelatedKeyword,
  SentimentAnalysisIndexItem,
  SentimentAnalysisReport,
  SentimentAnalysisStatus,
  SentimentCrawledNote,
  SentimentCrawlStatus,
} from "../types/sentiment";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...init,
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("ecom:session-expired"));
    const error = new Error(payload.error || `请求 ${path} 失败：${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function getCrawledNotes() {
  return fetchJson<{ notes: SentimentCrawledNote[] }>("/api/sentiment/crawled");
}

export function getRelatedKeywords(keyword: string) {
  return fetchJson<{ items: RelatedKeyword[] }>("/api/sentiment/related-keywords", {
    method: "POST",
    body: JSON.stringify({ keyword }),
  });
}

export function startCrawl(keywords: string[]) {
  return fetchJson<{ keywords: number }>("/api/sentiment/crawl", {
    method: "POST",
    body: JSON.stringify({ keywords }),
  });
}

export function getCrawlStatus() {
  return fetchJson<SentimentCrawlStatus>("/api/sentiment/crawl/status");
}

export function startAnalysis(keyword: string, dateFrom: string, dateTo: string) {
  return fetchJson<{ status: string; keyword: string; noteCount: number }>("/api/sentiment/analyze", {
    method: "POST",
    body: JSON.stringify({ keyword, dateFrom, dateTo }),
  });
}

export function getAnalysisStatus() {
  return fetchJson<SentimentAnalysisStatus>("/api/sentiment/status");
}

export function listAnalyses() {
  return fetchJson<{ items: SentimentAnalysisIndexItem[] }>("/api/sentiment/analyses");
}

export function getAnalysis(id: string) {
  return fetchJson<SentimentAnalysisReport>(`/api/sentiment/analyses/${encodeURIComponent(id)}`);
}
