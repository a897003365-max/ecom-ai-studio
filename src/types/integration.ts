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
  automation?: DingTalkAutomationStatus;
}

export interface DingTalkAutomationStatus {
  enabled: boolean;
  unattended: boolean;
  state: "unknown" | "running" | "healthy" | "degraded" | "failed" | "stale";
  statusLabel: string;
  schedule: string[];
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailure: string | null;
  staleAfterMinutes: number;
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

export interface WarehouseDashboardMetricValues {
  visitors: number;
  payBuyers: number;
  addToCart: number;
  paymentConversion: number;
  addToCartRate: number;
  clientAvgPrice: number;
  itemAvgPrice: number;
  paidUnits: number;
  promotionSpend: number;
  promotionRevenue: number;
  promotionRoi: number;
}

export interface WarehouseMetricTrend {
  yoy: number | null;
  mom: number | null;
}

export interface WarehouseDashboardMetrics {
  source: "powerbi_local_warehouse";
  available: boolean;
  coverageComplete: boolean;
  partial: boolean;
  coverage: { start: string; end: string } | null;
  period: { start: string; end: string } | null;
  domains: { overall: boolean; product: boolean; promotion: boolean } | null;
  metrics: WarehouseDashboardMetricValues | null;
  trends: Record<keyof WarehouseDashboardMetricValues, WarehouseMetricTrend> | null;
  comparisons?: {
    previousPeriod: { start: string; end: string };
    priorYearPeriod: { start: string; end: string };
  };
}

export interface WarehouseUniqueDomain {
  id: string;
  label: string;
  priority: "P0" | "P1" | "support";
  queryCount: number;
  rowCount: number;
  failedFiles: number;
  queries: string[];
}

export interface PowerBiOverallDaily {
  date: string;
  visitors: number;
  productVisitors: number;
  addToCart: number;
  payBuyers: number;
  payAmount: number;
  refund: number;
  fullSiteSpend: number;
  keywordSpend: number;
  audienceSpend: number;
  taokeSpend: number;
  newVisitors: number;
  returningVisitors: number;
  avgStaySeconds: number;
  bounceRate: number;
}

export interface PowerBiProductDaily {
  date: string;
  productId: string;
  productName: string;
  visitors: number;
  addToCart: number;
  payBuyers: number;
  payAmount: number;
  refund: number;
  paidUnits: number;
}

export interface PowerBiPromotionDaily {
  date: string;
  productId?: string;
  scene?: string;
  displayLabel?: string;
  imageUrl?: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  revenue: number;
  carts: number;
  directCarts: number;
  consultations: number;
}

export interface PowerBiPages {
  source: "powerbi_local_logic";
  period: { start: string; end: string } | null;
  overallDaily: PowerBiOverallDaily[];
  productDaily: PowerBiProductDaily[];
  promotionSceneDaily: PowerBiPromotionDaily[];
  promotionProductDaily: PowerBiPromotionDaily[];
  products: Array<{
    productId: string;
    productName: string;
    merchantCode: string;
    imageUrl: string | null;
    sales30d: number;
    cumulativeSales: number;
  }>;
  privacy: {
    rawRowsExposed: boolean;
    sourcePathsExposed: boolean;
    remoteImagesExposed: boolean;
  };
}

export interface ProductManagementKpis {
  productCount: number;
  orderLines: number;
  totalSalesAmount: number;
  totalNetSales: number;
  collectionRate: number | null;
  totalRefundAmount: number;
  refundRate: number | null;
  totalSalesUnits: number;
  avgUnitPrice: number | null;
  totalPaidAmount: number;
  totalReceivedAmount: number;
  totalSubsidyAmount: number;
  totalGrossProfit: number | null;
  grossMargin: number | null;
  matchedProductCount: number | null;
}

export interface ProductOverviewItem {
  productCode: string;
  productName: string;
  category: string;
  brand: string;
  salesUnits: number;
  receivedAmount: number;
  salesAmount: number;
  refundAmount: number;
  orderLines: number;
  collectionRate: number | null;
  refundRate: number | null;
}

export interface ProductNameOverviewItem {
  productName: string;
  category: string;
  salesUnits: number;
  salesAmount: number;
  refundAmount: number;
  receivedAmount: number;
  grossProfit: number;
  matchedReceived: number;
  orderLines: number;
  amountShare: number;
  avgUnitPrice: number | null;
  refundRate: number | null;
  grossMargin: number | null;
}

export interface ProductDailyTrendItem {
  date: string;
  receivedAmount: number;
  salesAmount: number;
  refundAmount: number;
  orderLines: number;
}

export interface ProductMonthlyTrendItem {
  month: string;
  receivedAmount: number;
  salesAmount: number;
  refundAmount: number;
  orderLines: number;
}

export interface ProductStoreBreakdownItem {
  store: string;
  receivedAmount: number;
  salesAmount: number;
  refundAmount: number;
  orderLines: number;
}

export interface ProductChannelBreakdownItem {
  channel: string;
  salesUnits: number;
  receivedAmount: number;
  refundAmount: number;
  grossProfit: number;
  matchedReceived: number;
  orderLines: number;
  amountShare: number;
  avgUnitPrice: number | null;
  refundRate: number | null;
  grossMargin: number | null;
}

export interface ProductMattressCategoryBreakdownItem {
  category: string;
  receivedAmount: number;
  salesAmount: number;
  refundAmount: number;
  grossProfit: number;
  matchedReceived: number;
  orderLines: number;
  amountShare: number;
  refundRate: number | null;
  grossMargin: number | null;
}

export interface ProductDarenBreakdownItem {
  daren: string;
  receivedAmount: number;
  salesAmount: number;
  orderLines: number;
}

export interface ProductCategoryBreakdownItem {
  category: string;
  receivedAmount: number;
  salesAmount: number;
  refundAmount: number;
  orderLines: number;
}

export interface ProductReturnRankingItem {
  productCode: string;
  productName: string;
  refundUnits: number;
  refundAmount: number;
  receivedAmount: number;
  orderLines: number;
  refundRate: number | null;
}

export interface ProductFulfillmentByProductItem {
  productName: string;
  orderCount: number;
  shippedOrderCount: number;
  avgShippingDays: number | null;
  day3Share: number;
  day5Share: number;
  day7Share: number;
  day10Share: number;
  within15DayShare: number;
}

export interface ProductManagementPages {
  source: "jushuitan_local_logic";
  period: { start: string; end: string } | null;
  kpis: ProductManagementKpis | Record<string, never>;
  productOverview: ProductOverviewItem[];
  productNameOverview: ProductNameOverviewItem[];
  dailyTrend: ProductDailyTrendItem[];
  monthlyTrend: ProductMonthlyTrendItem[];
  storeBreakdown: ProductStoreBreakdownItem[];
  channelBreakdown: ProductChannelBreakdownItem[];
  darenBreakdown: ProductDarenBreakdownItem[];
  categoryBreakdown: ProductCategoryBreakdownItem[];
  mattressCategoryBreakdown: ProductMattressCategoryBreakdownItem[];
  returnRanking: ProductReturnRankingItem[];
  fulfillmentByProduct: ProductFulfillmentByProductItem[];
  monthlyComparison: ProductMonthlyComparison | null;
  categoryChannelMatrix: ProductMatrix;
  warehouseStatusMatrix: ProductMatrix;
  dailyChannelMatrix: ProductMatrix;
  dailyStatusMatrix: ProductMatrix;
  productChannelMatrix: ProductMatrix;
  productStatusMatrix: ProductMatrix;
  availableStatuses: string[];
  availableChannels: string[];
  availableStoreShortNames: string[];
  privacy: { rawRowsExposed: boolean; sourcePathsExposed: boolean };
}

export interface ProductMonthlyComparison {
  currentMonth: string;
  previousMonth: string | null;
  current: Record<string, number>;
  previous: Record<string, number>;
  deltas: Record<string, number | null>;
}

export interface ProductMatrix {
  columns: string[];
  rows: Array<{ rowKey: string; values: Record<string, number>; total: number }>;
}

export interface ProductsPayload {
  productManagement: ProductManagementPages | null;
  refreshedAt: string | null;
  status: "ok" | "stale";
}

export interface WarehouseSnapshot {
  source: "local_warehouse";
  scope: "powerbi_unique_only";
  engine: { transform: string; storage: string; query: string };
  refreshedAt: string;
  period: { start: string; end: string } | null;
  totals: Partial<WarehouseMetricTotals>;
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
  uniqueDomains: WarehouseUniqueDomain[];
  powerbiPages: PowerBiPages;
  productManagement: ProductManagementPages;
  dashboard?: WarehouseDashboardMetrics;
  overlapPolicy: {
    authority: "dingtalk";
    excludedQueries: Array<{
      query: string;
      authority: string;
      grain: string;
      overlap: string[];
      reason: string;
    }>;
    partialOverlap: Array<{
      query: string;
      retainBecause: string;
      doNotRepublish: string[];
    }>;
  };
  quality: {
    status: "healthy" | "partial" | "empty";
    queryCount: number;
    excludedQueryCount: number;
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
  priorYearDaily?: Array<{
    date: string;
    netRevenue: number;
  }>;
  priorYearFullMonthNetRevenue?: number;
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

export interface DingTalkMetricTrend {
  yoy: number | null;
  mom: number | null;
}

export interface DingTalkMonthlyAchievement {
  month: string;
  netRevenue: number;
  target: number;
  completionRate: number;
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
    targetYears?: string[];
    monthlyOverview?: DingTalkMonthlyOverview;
    monthlyAchievement?: DingTalkMonthlyAchievement[];
    metricTrends?: Record<"gmv" | "netRevenue" | "recoveryRate" | "addToCart" | "spend" | "feeRate" | "refund" | "refundRate", DingTalkMetricTrend>;
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

export interface DashboardDataStatus {
  expectedDate: string;
  tone: "green" | "orange";
  label: string;
  missing: string[];
}

export interface AnalyticsIntegrationPayload {
  warehouse: WarehouseSnapshot | null;
  feishu: FeishuSnapshot | null;
  dingtalk: DingTalkSnapshot | null;
  dataStatus: DashboardDataStatus;
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
