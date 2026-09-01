import type { PageId } from "./index";

// 顶部智能找数 · 前后端共享类型

export type ProductTab =
  | "overview"
  | "gallery"
  | "channel"
  | "trend"
  | "returns"
  | "fulfillment"
  | "price"
  | "size"
  | "custom";

// 导航目标：让 App 把搜索命令分发给目标页面
export type SearchTarget =
  | {
      requestId: string;
      page: Exclude<PageId, "analytics" | "products">;
    }
  | {
      requestId: string;
      page: "analytics";
      analyticsView?: "layered" | "legacy";
      workspace?: "overview" | "diagnosis";
      replicaPage?: "overall" | "promotion" | "product";
      section?: string;
      filters?: {
        start?: string;
        end?: string;
        channel?: string;
      };
    }
  | {
      requestId: string;
      page: "products";
      tab: ProductTab;
      section?: string;
      filters?: {
        start?: string;
        end?: string;
        channels?: string[];
        storeShortNames?: string[];
      };
      focus?: {
        kind: "product" | "spu" | "sku";
        value: string;
        productName?: string;
      };
    };

export type SearchMode = "suggest" | "answer";

export interface SearchRequest {
  query: string;
  mode: SearchMode;
  limit?: number;
}

export type SearchStatus =
  | "ok"
  | "ambiguous"
  | "navigate_required"
  | "unsupported"
  | "unavailable";

export type SearchIntent = "navigate" | "metric_value" | "ranking" | "definition" | "entity";
export type SearchScope = "analytics" | "products" | null;

export type SearchEntityKind = "channel" | "store" | "product" | "spu" | "sku";
export type SearchUnit = "currency" | "integer" | "percent" | "ratio" | "days";
export type SearchDataState = "fresh" | "partial" | "stale" | "missing";
export type SearchSource = "dingtalk" | "warehouse";

export interface SearchPeriod {
  start: string;
  end: string;
}

export interface SearchInterpretation {
  intent: SearchIntent;
  scope: SearchScope;
  metricIds: string[];
  period: {
    start: string;
    end: string;
    label: string;
    basis: "explicit" | "default" | "latest_complete";
  } | null;
  entity: {
    kind: SearchEntityKind;
    id: string;
    label: string;
  } | null;
}

export interface SearchAnswer {
  id: string;
  metricId: string;
  label: string;
  displayValue: string;
  rawValue: number | null;
  unit: SearchUnit;
  definition: string;
  scopeLabel: string;
  period: SearchPeriod | null;
  source: SearchSource;
  refreshedAt: string | null;
  dataState: SearchDataState;
  target: SearchTarget;
}

export interface SearchResult {
  id: string;
  kind: "section" | "metric" | "entity" | "clarification";
  title: string;
  subtitle: string;
  target?: SearchTarget;
}

export interface SearchResponse {
  query: string;
  mode: SearchMode;
  status: SearchStatus;
  interpretation: SearchInterpretation;
  answers: SearchAnswer[];
  results: SearchResult[];
  suggestions: string[];
}