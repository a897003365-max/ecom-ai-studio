import type { Tone } from "./index";

export type ConnectionStatus = "connected" | "ready" | "cached" | "offline" | "auth_required" | "incomplete";

export interface IntegrationSource {
  id: "warehouse" | "feishu" | "dingtalk" | "workflow";
  name: string;
  kind: "local_direct" | "authorized_aggregate" | "upload_or_auth" | "scheduled_read_only";
  status: ConnectionStatus;
  statusLabel: string;
  detail: string;
  lastSync: string | null;
  records: number;
  location: string;
}

export interface UploadPolicyGroup {
  id: string;
  category: string;
  tone: Tone;
  items: string[];
  reason: string;
}

export interface WorkflowStatus {
  id: string;
  name: string;
  status: "ready" | "incomplete";
  localRoot: string;
  workflowFile: string;
  promptFile: string;
  readyCount: number;
  expectedCount: number;
  executionPort: string;
  stages: string[];
  agents: Array<{ name: string; installed: boolean }>;
}

export interface UploadRecord {
  id: string;
  fileName: string;
  category: string;
  sizeBytes: number;
  storagePath: string;
  status: string;
  createdAt: string;
}

export interface DataSourcesPayload {
  sources: IntegrationSource[];
  warehouse: WarehouseStatus;
  workflow: WorkflowStatus;
  uploadPolicy: UploadPolicyGroup[];
  uploads: UploadRecord[];
}

export interface WarehouseStatus {
  configured: boolean;
  available: boolean;
  syncing: boolean;
  partitionCount: number;
  failedPartitionCount: number;
  queryCount: number;
  completedQueries: number;
  sourceFileCount: number;
  rowCount: number;
  databaseSize: number;
  databasePath: string;
  snapshotPath: string;
}

export interface WarehouseMetricTotals {
  exposure: number;
  clicks: number;
  spend: number;
  onsiteSpend?: number;
  gmv: number;
  netRevenue: number;
  refund: number;
  addToCart: number;
  ctr: number;
  roi: number;
}

export interface WarehouseSnapshot {
  source: "local_warehouse";
  engine: { transform: string; storage: string; query: string };
  refreshedAt: string;
  period: { start: string; end: string };
  totals: WarehouseMetricTotals;
  daily: Array<{ date: string } & WarehouseMetricTotals>;
  platforms: Array<{ platform: string } & WarehouseMetricTotals>;
  stores: Array<{
    platform: string;
    store: string;
    spend: number;
    gmv: number;
    netRevenue: number;
    refund: number;
    roi: number;
  }>;
  quality: {
    status: "healthy" | "partial" | "empty";
    queryCount: number;
    failedFiles: number;
    queries: Array<{
      query: string;
      files: number;
      activePartitions: number;
      rows: number;
      columns: number;
      failed: number;
      status: "success" | "partial" | "failed" | "cached" | "empty";
    }>;
  };
  privacy: {
    webExposure: string;
    rawCustomerServiceRowsExposed: boolean;
    sourcePathsExposed: boolean;
  };
  recordCount: number;
}

export interface FeishuSnapshot {
  source: "feishu_sheets";
  refreshedAt: string;
  content: {
    processedRows: number;
    period: { start: string | null; end: string | null };
    totals: {
      published: number;
      exposure: number;
      reads: number;
      interactions48h: number;
      interactions30d: number;
    };
    platforms: Array<{
      name: string;
      published: number;
      exposure: number;
      reads: number;
      interactions30d: number;
      averageClickRate: number;
      interactionRate: number;
    }>;
    products: Array<{
      name: string;
      published: number;
      exposure: number;
      reads: number;
      interactions30d: number;
    }>;
  };
  pr: {
    period: { start: string | null; end: string | null };
    overall: { negotiated: number; published: number; viral48h: number; cost: number; interactions48h: number };
    currentMonth: { negotiated: number; published: number; viral: number; cost: number; interactions7d: number; cpe7d: number };
    products: Array<Record<string, string | number>>;
  };
  inventory: Array<Record<string, string | number>>;
  privacy: { excludedFields: string[]; persistedLevel: string };
  recordCount: number;
}

export interface DingTalkMetricTotals {
  exposure: number;
  clicks: number;
  spend: number;
  paidOrders: number;
  gmv: number;
  netRevenue: number;
  refund: number;
  favorite: number;
  addToCart: number;
  target: number;
  budget: number;
  ctr: number;
  roi: number;
  completionRate?: number;
  feeRate?: number;
  recoveryRate?: number;
  refundRate?: number;
  channelShare?: number;
}

export interface DingTalkReportingPeriod {
  start: string;
  end: string;
}

export interface DingTalkStoreMetric extends DingTalkMetricTotals {
  platform: string;
  store: string;
  offsiteSpend?: number;
}

export interface DingTalkMonthlyOverview {
  month: string;
  label: string;
  period: DingTalkReportingPeriod;
  metrics: {
    netRevenue: number;
    priorYearNetRevenue: number;
    yoy: number | null;
    onsiteSpend: number;
    offsiteSpend: number;
    onsiteFeeRate: number;
    offsiteFeeRate: number;
    totalFeeRate: number;
    target: number;
    completionRate: number;
  };
  daily: Array<{
    date: string;
    totalNetRevenue: number;
    channels: Array<{ platform: string; netRevenue: number }>;
  }>;
  source: string;
}

export interface DingTalkComparisonItem {
  level: "channel" | "store";
  platform: string;
  name: string;
  netRevenue: number;
  netRevenueChange: number | null;
  spend: number;
  spendChange: number | null;
  feeRate: number;
  feeRateChange: number | null;
  refundRate: number;
  refundRateChange: number | null;
}

export interface DingTalkLatestComparison {
  asOf: string;
  previousDate: string;
  channels: DingTalkComparisonItem[];
  stores: DingTalkComparisonItem[];
}

export interface DingTalkSnapshot {
  source: "dingtalk_export" | "dingtalk_api";
  refreshedAt: string;
  sourceFile: string;
  schedule?: string[];
  monthly?: {
    month: string;
    netRevenue: number;
    yoy: number;
    onsiteSpend: number;
    offsiteSpend: number;
    onsiteFeeRate?: number;
    offsiteFeeRate?: number;
    totalSpendRate: number;
    completionRate: number;
  };
  period: { start: string | null; end: string | null };
  totals: DingTalkMetricTotals;
  platforms: Array<{ platform: string } & DingTalkMetricTotals>;
  stores: DingTalkStoreMetric[];
  daily: Array<{ date: string } & DingTalkMetricTotals>;
  reporting?: {
    availablePeriod: DingTalkReportingPeriod;
    completedThrough: string;
    selectedPeriod: DingTalkReportingPeriod | null;
    dailyPlatforms?: Array<{ date: string; platform: string } & DingTalkMetricTotals>;
    dailyStores?: Array<{ date: string; platform: string; store: string } & DingTalkMetricTotals>;
    dailyOffsiteSpend?: Array<{ date: string; spend: number }>;
    monthlyOverview?: DingTalkMonthlyOverview;
    latestComparison?: DingTalkLatestComparison;
    formulaLineage?: { summary: string; monthlyRollup: string; target: string };
  };
  inventory: Array<{
    name: string;
    headerRow: number;
    rowCount: number;
    rowsWithMetrics: number;
    detectedFields: string[];
    missingDimensions: string[];
    detectedMetricCount: number;
    blockedFields: string[];
    ignoredFields: string[];
    dimensionCounts: Record<string, number>;
    anomalyCount: number;
  }>;
  dimensions: {
    storeCount: number;
    productCount: number;
    activityCount: number;
    materialCount: number;
    planCount: number;
    ownerCount: number;
  };
  quality: {
    sheetCount: number;
    anomalyCount: number;
    invalidCellCount: number;
    missingDimensionSheets: number;
  };
  privacy: {
    persistedLevel: string;
    rawRowsPersisted: boolean;
    ownerValuesPersisted: boolean;
    blockedHeaders: string[];
  };
  recordCount: number;
}

export interface AnalyticsIntegrationPayload {
  warehouse: WarehouseSnapshot | null;
  feishu: FeishuSnapshot | null;
  dingtalk: DingTalkSnapshot | null;
  history: Array<{
    id: string;
    sourceId: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    recordCount: number;
    detail: string;
  }>;
}
