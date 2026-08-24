// 小红书舆情分析类型（对应 server/sentiment.mjs 的响应结构）
export type SentimentNoteState = "pending" | "ok" | "failed";

export interface SentimentNoteMeta {
  noteId: string;
  title: string;
  url: string;
  author: string;
  liked: number;
  comment: number;
  collected: number;
  shared: number;
  keyword?: string;
  crawledAt?: string;
  publishTime?: string | null;
}

// 笔记库条目（local-data/sentiment/crawled-notes.json）
export interface SentimentCrawledNote extends SentimentNoteMeta {
  keyword: string;
  crawledAt: string;
  detailState: SentimentNoteState;
  bodyLength: number;
  noteBody?: string;
  redId?: string | null;
  fans?: number | null;
}

export type SentimentSeverity = "high" | "medium" | "low";

export interface SentimentProblemPoint {
  title: string;
  detail: string;
  evidence: string[];
  severity: SentimentSeverity;
  mentionCount: number;
}

export interface SentimentSuggestion {
  title: string;
  detail: string;
  priority: SentimentSeverity;
}

export interface SentimentResult {
  summary: string;
  riskLevel: "high" | "medium" | "low";
  problemPoints: SentimentProblemPoint[];
  suggestions: SentimentSuggestion[];
  keywords: string[];
}

// 分析报告（local-data/sentiment/analyses/{id}.json）
export interface SentimentAnalysisReport {
  id: string;
  keyword: string;
  createdAt: string;
  period: { from: string | null; to: string | null } | null;
  noteCount: number;
  totalEngagement: number;
  noteIds: string[];
  result: SentimentResult;
}

export interface SentimentAnalysisIndexItem {
  id: string;
  keyword: string;
  createdAt: string;
  period: { from: string | null; to: string | null } | null;
  noteCount: number;
  riskLevel: "high" | "medium" | "low";
  problemCount: number;
}

// 相关关键词（话题列表）条目
export interface RelatedKeyword {
  name: string;
  viewNum: number | null;
}

// 抓取任务状态（POST /api/sentiment/crawl 后轮询）
export interface SentimentCrawlStatus {
  running: boolean;
  keywords: string[];
  keywordIndex: number;
  phase: "idle" | "searching" | "filling";
  total: number;
  ok: number;
  failed: number;
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

// 分析任务状态（POST /api/sentiment/analyze 后轮询）
export interface SentimentAnalysisStatus {
  status: "idle" | "running" | "done" | "error";
  keyword: string;
  reportId: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}
