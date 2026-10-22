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

export interface PowerBiDailyCore {
  date: string;
  year: string;
  month: string;
  day: string;
  productVisitors: number;
  addToCart: number;
  payBuyers: number;
  promotionCarts: number;
  addToCartRate: number | null;
  addToCartCost: number | null;
  payAmount: number;
  paidUnits: number;
  conversionRate: number | null;
  refundAmount: number;
  refundRate: number | null;
  spend: number;
  subsidizedAmount: number;
  subsidizedFeeRate: number | null;
  storeRank: string | null;
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

export interface PowerBiCompetitorDaily {
  period: string;
  brand: string;
  channel: string;
  spendWan: number;
  impressionsWan: number;
  clicksWan: number;
  revenueWan: number;
  roi: number | null;
  ctr: number | null;
  spendShare: number | null;
  visitCost: number | null;
  interestCost: number | null;
  firstPurchaseCost: number | null;
  repurchaseCost: number | null;
  cartCount?: number;
  orders?: number;
  cartRate?: number | null;
  convRate?: number | null;
  cpc?: number | null;
  cartCost?: number | null;
}

/** mds 库天猫店铺日汇总（与钉钉填表同一真值源，独立于生意参谋导出文件链）；
 *  店铺级 11 字段，口径与钉钉「全渠道目标进度表」一致（浏览量≠访客数、GMV≠支付金额，勿与 04 链混排）。 */
export interface PowerBiShopSummaryDaily {
  date: string;
  pageViews: number | null;
  shopCustomers: number | null;
  gmv: number | null;
  refundAmount: number | null;
  addToCart: number | null;
  keywordSpend: number | null;
  audienceSpend: number | null;
  fullSiteSpend: number | null;
  taokeCommission: number | null;
  contentSceneSpend: number | null;
  storeRank: string | null;
}

export interface PowerBiCustomerServiceDaily {
  date: string;
  /** 京东客服按店铺拆分（京东自营/京东POP/全部）；旧快照无此字段时视为自营口径 */
  store?: string;
  agentCount?: number;
  effectiveReceived?: number;
  todayInquiry?: number;
  salesPeople?: number;
  netSales?: number;
  unitPrice?: number;
  inquiryConversionRate?: number | null;
  firstResponse?: number;
  avgResponse?: number;
  answerRatio?: number | null;
  satisfactionRate?: number | null;
  received?: number;
  response30s?: number | null;
  orderAmount?: number;
  conversionRate?: number | null;
  goodReviews?: number;
  badReviews?: number;
  /** 抖音客服：在线总时长（秒，日内合计） */
  onlineSeconds?: number;
  /** 抖音客服：询单转化率 = 支付人数 / 询单人数（SUM/SUM 重算） */
  inquiryConvRate?: number | null;
  /** 天猫新结构(2026-06-29 起)原子字段：询单人数 / 询单最终付款人数 */
  consultNum?: number;
  finalPayCusNum?: number;
  /** 天猫新结构原子字段：收到评价数 / 满意数 / 很满意数 */
  evaluationNum?: number;
  satisfiedNum?: number;
  verySatisfiedNum?: number;
  /** 天猫新结构原子字段：客服消息条数 / 买家消息条数 */
  agentMsgNum?: number;
  buyerMsgNum?: number;
  /** 天线口径标记：strict=严格公式(原子字段齐全)；precomputed=平台预制(旧结构)。strict 区间比率按分母加权=SUM/SUM。 */
  metricsCaliber?: "strict" | "precomputed";
}

export interface PowerBiCustomerServiceAgent {
  date: string;
  agent: string;
  /** 京东客服按店铺拆分；旧快照无此字段时视为自营口径 */
  store?: string;
  groupName?: string;
  skillGroup?: string;
  effectiveReceived?: number;
  /** 天猫客服净销售额（万元，已扣成功退款），与 PowerBiCustomerServiceDaily.netSales 同源字段 */
  netSalesWan?: number;
  firstResponse?: number;
  answerRatio?: number | null;
  avgResponse?: number;
  unitPrice?: number;
  inquiryConvRate?: number | null;
  satisfactionRate?: number | null;
  received?: number;
  orderAmount?: number;
  conversionRate?: number | null;
  goodReviews?: number;
  badReviews?: number;
  /** 抖音客服：在线总时长（秒） */
  onlineSeconds?: number;
  /** 抖音客服：净销售额（元）= 飞鸽「退款后销售额」，与 netSalesWan 同源 */
  netSales?: number;
  inquiryCount?: number;
  payCount?: number;
  evalCount?: number;
  /** 天猫新结构(2026-06-29 起)原子字段：询单人数 / 询单最终付款人数 */
  consultNum?: number;
  finalPayCusNum?: number;
  /** 天猫新结构原子字段：收到评价数 / 满意数 / 很满意数 */
  evaluationNum?: number;
  satisfiedNum?: number;
  verySatisfiedNum?: number;
  /** 天猫新结构原子字段：客服消息条数 / 买家消息条数 */
  agentMsgNum?: number;
  buyerMsgNum?: number;
  /** 天猫口径标记：strict=严格公式(原子字段齐全)；precomputed=平台预制(旧结构)。strict 区间比率按分母加权=SUM/SUM。 */
  metricsCaliber?: "strict" | "precomputed";
}

export interface PowerBiCustomerService {
  period: { start: string; end: string } | null;
  tmall: {
    daily: PowerBiCustomerServiceDaily[];
    byAgent: PowerBiCustomerServiceAgent[];
    groups: string[];
  } | null;
  jd: {
    daily: PowerBiCustomerServiceDaily[];
    serviceDaily: PowerBiCustomerServiceDaily[];
    byAgent: PowerBiCustomerServiceAgent[];
    groups: string[];
  } | null;
  douyin?: {
    daily: PowerBiCustomerServiceDaily[];
    byAgent: PowerBiCustomerServiceAgent[];
    groups: string[];
  } | null;
}

// 单张来源表在所选区间内的实际覆盖：min/max 为区间内首末有数据日（ISO），
// days = 有数据天数，missingDays = 日历日口径缺失天数；days=0 表示区间内整段无数据
export interface PowerBiCoverageEntry {
  min: string | null;
  max: string | null;
  days: number;
  missingDays: number;
}

export interface PowerBiCoverage {
  range: { start: string; end: string };
  base: PowerBiCoverageEntry;
  product: PowerBiCoverageEntry;
  promotion: PowerBiCoverageEntry;
}

export interface PowerBiPages {
  source: "powerbi_local_logic";
  period: { start: string; end: string } | null;
  coverage?: PowerBiCoverage | null;
  overallDaily: PowerBiOverallDaily[];
  dailyCore: PowerBiDailyCore[];
  productDaily: PowerBiProductDaily[];
  productDailyPriorYear: Array<{ productId: string; payAmount: number; refund: number }>;
  promotionSceneDaily: PowerBiPromotionDaily[];
  promotionProductDaily: PowerBiPromotionDaily[];
  competitorDaily: PowerBiCompetitorDaily[];
  /** mds 天猫店铺日汇总（钉钉同源）；2026-10 前的旧快照无此字段，前端按 ?? [] 容错 */
  shopSummaryDaily?: PowerBiShopSummaryDaily[];
  customerService: PowerBiCustomerService;
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
  customRate: number | null;
  pendingUnits: number | null;
  prevPendingUnits: number | null;
}

export interface ProductOverviewItem {
  productCode: string;
  productName: string;
  subName: string;
  category: string;
  brand: string;
  salesUnits: number;
  receivedAmount: number;
  salesAmount: number;
  refundAmount: number;
  orderLines: number;
  collectionRate: number | null;
  refundRate: number | null;
  grossProfit: number | null;
  matchedReceived: number | null;
  grossMargin: number | null;
  prevReceivedAmount: number | null;
}

export interface ProductNameOverviewItem {
  productName: string;
  productCode: string | null;
  spu: string;
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
  prevReceivedAmount: number | null;
  imageUrl: string | null;
}

export interface ProductDailyTrendItem {
  date: string;
  receivedAmount: number;
  salesUnits: number;
  salesAmount: number;
  refundAmount: number;
  orderLines: number;
  grossProfit: number | null;
  matchedReceived: number | null;
  grossMargin: number | null;
}

export interface ProductMonthlyTrendItem {
  month: string;
  receivedAmount: number;
  salesUnits: number;
  salesAmount: number;
  refundAmount: number;
  refundRate: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  orderLines: number;
}

export interface ProductStoreBreakdownItem {
  store: string;
  receivedAmount: number;
  salesUnits: number;
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
  salesUnits: number;
  salesAmount: number;
  refundAmount: number;
  grossProfit: number;
  matchedReceived: number;
  orderLines: number;
  amountShare: number;
  refundRate: number | null;
  grossMargin: number | null;
  prevReceivedAmount: number | null;
}

export interface ProductDarenBreakdownItem {
  daren: string;
  receivedAmount: number;
  salesUnits: number;
  salesAmount: number;
  orderLines: number;
}

export interface ProductCategoryBreakdownItem {
  category: string;
  receivedAmount: number;
  salesUnits: number;
  salesAmount: number;
  refundAmount: number;
  orderLines: number;
}

export interface ProductReturnRankingItem {
  spu: string;
  productName: string;
  refundAmount: number;
  receivedAmount: number;
  orderLines: number;
  refundRate: number | null;
}

export interface ProductReturnDimensionBreakdownItem {
  dim: string;
  refundAmount: number;
  refundUnits: number;
  refundOrderCount: number;
  refundOrderShare: number | null;
  refundRate: number | null;
  preShipRefundShare: number | null;
  fullRefundShare: number | null;
  receivedAmount: number;
  orderLines: number;
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

/** 仓配履约 · 产品名称维度的订单量与发货时效差异（按子名称展开）。父行 = 产品名称（指标为全量子名称汇总），子行 = 子名称明细。 */
export interface ProductFulfillmentHierarchyRow {
  key: string;
  name: string;
  orderCount: number;
  shippedOrderCount: number;
  avgShippingDays: number | null;
  day3Share: number;
  day5Share: number;
  day7Share: number;
  day10Share: number;
  within15DayShare: number;
  hasChildren: boolean;
  children?: ProductFulfillmentHierarchyRow[];
}

export interface ProductFulfillmentHierarchy {
  rows: ProductFulfillmentHierarchyRow[];
}

export interface ProductManagementPages {
  source: "jushuitan_local_logic";
  period: { start: string; end: string } | null;
  kpis: ProductManagementKpis | Record<string, never>;
  productOverview: ProductOverviewItem[];
  productNameOverview: ProductNameOverviewItem[];
  dailyTrend: ProductDailyTrendItem[];
  previousDailyTrend: ProductDailyTrendItem[];
  monthlyTrend: ProductMonthlyTrendItem[];
  storeBreakdown: ProductStoreBreakdownItem[];
  channelBreakdown: ProductChannelBreakdownItem[];
  darenBreakdown: ProductDarenBreakdownItem[];
  categoryBreakdown: ProductCategoryBreakdownItem[];
  mattressCategoryBreakdown: ProductMattressCategoryBreakdownItem[];
  returnRanking: ProductReturnRankingItem[];
  returnChannelBreakdown: ProductReturnDimensionBreakdownItem[];
  returnStoreBreakdown: ProductReturnDimensionBreakdownItem[];
  returnDarenBreakdown: ProductReturnDimensionBreakdownItem[];
  returnCategoryBreakdown: ProductReturnDimensionBreakdownItem[];
  fulfillmentByProduct: ProductFulfillmentByProductItem[];
  fulfillmentByProductHierarchy: ProductFulfillmentHierarchy;
  monthlyComparison: ProductMonthlyComparison | null;
  categoryChannelMatrix: ProductMatrix;
  warehouseStatusMatrix: ProductMatrix;
  dailyChannelMatrix: ProductMatrix;
  dailyWarehouseMatrix: ProductMatrix;
  dailyShipWarehouseMatrix: ProductMatrix;
  dailyCategoryMatrix: ProductMatrix;
  dailyChannelMarginMatrix: ProductMatrix;
  dailyStatusMatrix: ProductMatrix;
  productChannelMatrix: ProductMatrix;
  productStatusMatrix: ProductMatrix;
  productStatusHierarchy: ProductStatusHierarchy;
  productChannelRevenueMatrix: ProductMatrix;
  productChannelRefundMatrix: ProductMatrix;
  channelStatusMatrix: ProductMatrix;
  channelWarehouseMatrix: ProductMatrix;
  channelCategoryMatrix: ProductMatrix;
  availableStatuses: string[];
  availableChannels: string[];
  availableStoreShortNames: string[];
  privacy: { rawRowsExposed: boolean; sourcePathsExposed: boolean };
  priceStructure: ProductPriceStructurePages;
  sizeStructure: ProductSizeStructurePages;
  spuSalesTrend: ProductSpuSalesTrendPages;
  customizationStructure: ProductCustomizationStructurePages;
}

export interface ProductMonthlyComparison {
  currentMonth: string;
  previousMonth: string | null;
  currentPeriod: { start: string; end: string };
  previousPeriod: { start: string; end: string } | null;
  current: Record<string, number | null>;
  previous: Record<string, number | null>;
  deltas: Record<string, number | null>;
}

export interface ProductMatrix {
  columns: string[];
  rows: Array<{ rowKey: string; values: Record<string, number | null>; total: number | null }>;
}

// 产品名称 × 子名称 × 订单状态（销售数量）层级矩阵：父=产品名称，子=子名称
export interface ProductStatusChildRow {
  subName: string;
  values: Record<string, number | null>;
  total: number | null;
}

export interface ProductStatusParentRow {
  productName: string;
  values: Record<string, number | null>;
  total: number | null;
  children: ProductStatusChildRow[];
  hasChildren: boolean;
}

export interface ProductStatusHierarchy {
  columns: string[];
  rows: ProductStatusParentRow[];
}

// ---- 商品管理新增四模块：价格 / 尺寸 / SPU 销量 / 定制结构（推导）----

export interface ProductDimensionCoverage {
  totalOrderLines: number;
  matchedOrderLines: number;
  totalProductCodes: number;
  matchedProductCodes: number;
  ambiguousProductCodes: number;
  orderLineRatio: number | null;
  productCodeRatio: number | null;
}

export interface ProductModuleQuality {
  status: "ready" | "degraded" | "unavailable";
  coverage: ProductDimensionCoverage | null;
  warnings: string[];
}

export interface ProductShareMatrixRow {
  rowKey: string;
  orderLines: number;
  shares: Record<string, number>;
}

export interface ProductShareMatrix {
  columns: string[];
  rows: ProductShareMatrixRow[];
}

// 价格结构
export type ProductPriceBucketCode =
  | "LE_1000"
  | "1001_1500"
  | "1501_2000"
  | "2001_2500"
  | "2501_3000"
  | "3001_4000"
  | "GT_4000";

export interface ProductPriceBucketRow {
  bucket: ProductPriceBucketCode;
  label:
    | "1000以下"
    | "1001–1500"
    | "1501–2000"
    | "2001–2500"
    | "2501–3000"
    | "3001–4000"
    | "4000以上";
  orderLines: number;
  orderLineShare: number;
  salesUnits: number;
  salesUnitsShare: number;
  receivedAmount: number;
  receivedAmountShare: number;
  topProducts: string;
}

export interface ProductPriceStructurePages {
  buckets: ProductPriceBucketRow[];
  channelMatrix: ProductShareMatrix;
  mattressCategoryMatrix: ProductShareMatrix;
  topProductMatrix: ProductShareMatrix;
  validOrderLines: number;
  excludedOrderLines: number;
  totalReceivedAmount: number;
  formula: "商家实收 / 销售数量";
  quality: ProductModuleQuality;
}

// 尺寸结构
export type ProductSizeSource = "q18" | "q27" | "colorSpec" | "unknown";

export interface ProductSizeRow {
  size: string;
  source: ProductSizeSource;
  orderLines: number;
  orderLineShare: number;
  salesUnits: number;
  salesUnitsShare: number;
  receivedAmount: number;
  receivedAmountShare: number;
}

export interface ProductSizeStructurePages {
  sizes: ProductSizeRow[];
  unknownSize: ProductSizeRow;
  mattressCategoryMatrix: ProductShareMatrix;
  topProductMatrix: ProductShareMatrix;
  recognizedOrderLines: number;
  totalOrderLines: number;
  quality: ProductModuleQuality;
}

// SPU 销量趋势
export interface ProductSpuDailyPoint {
  date: string;
  spu: string;
  orderLines: number;
  salesUnits: number;
  receivedAmount: number;
}

export interface ProductCategoryDailyPoint {
  date: string;
  mattressCategory: string;
  salesUnits: number;
  receivedAmount: number;
}

export interface ProductSpuSummary {
  spu: string;
  productName: string;
  /** 该 SPU 覆盖的 pm 主表产品名称列表（按销量降序），供联动矩阵/搜索显示该 SPU 下所有产品。 */
  productNames?: string[];
  orderLines: number;
  salesUnits: number;
  receivedAmount: number;
}

export interface ProductSpuSalesTrendPages {
  spuChannelMatrix: ProductMatrix;
  dailySpuTrend: ProductSpuDailyPoint[];
  categoryDailyTrend: ProductCategoryDailyPoint[];
  availableSpus: string[];
  defaultSpus: string[];
  summaries: ProductSpuSummary[];
  quality: ProductModuleQuality;
}

// 定制结构（对齐 PBI 商家备注打标）
export interface ProductCustomComparisonRow {
  orderType: "常规" | "定制";
  orderLines: number;
  orderLineShare: number;
  salesUnits: number;
  salesUnitsShare: number;
  receivedAmount: number;
  grossMargin: number | null;
  shippedOrderLines: number;
  avgShippingDays: number | null;
  shippedWithin7DaysShare: number | null;
  shippedWithin15DaysShare: number | null;
}

export interface ProductCustomTagRow {
  tag: string;
  orderLines: number;
  customOrderLineShare: number;
}

export interface ProductCustomCategoryRow {
  mattressCategory: string;
  salesUnits: number;
  customSalesUnits: number;
  customSalesShare: number;
  customOrderLines: number;
  customOrderLineShare: number;
}

export interface ProductCustomProductRow {
  productName: string;
  totalOrderLines: number;
  customOrderLines: number;
  customSalesUnits: number;
  customShareWithinProduct: number;
  customReceivedAmount: number;
  shippedCustomOrderLines: number;
  shippedWithin7DaysShare: number | null;
  shippedWithin10DaysShare: number | null;
  shippedWithin15DaysShare: number | null;
}

export interface ProductCustomSpuRow {
  spu: string;
  productName: string;
  salesUnits: number;
  customSalesUnits: number;
  customRate: number;
}

export interface ProductCustomizationStructurePages {
  comparison: ProductCustomComparisonRow[];
  categoryStructure: ProductCustomCategoryRow[];
  tags: ProductCustomTagRow[];
  topProducts: ProductCustomProductRow[];
  spuSummary: ProductCustomSpuRow[];
  derivationNote: string;
  quality: ProductModuleQuality;
}

export interface ProductsPayload {
  productManagement: ProductManagementPages | null;
  refreshedAt: string | null;
  status: "ok" | "stale";
  error?: string;
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
  /** 净回款同比（去年同期同时段回款额），无同期数据时为 null */
  netRevenueYoy?: number | null;
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
  // 渠道级去年同期逐日回款，供切渠道时重算目标进度带；结构与 daily.channels 对齐。
  priorYearDailyChannels?: Array<{
    date: string;
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

export interface DingTalkMetricTrend {
  yoy: number | null;
  mom: number | null;
}

export type DingTalkMetricTrends = Record<
  "gmv" | "netRevenue" | "recoveryRate" | "addToCart" | "spend" | "feeRate" | "refund" | "refundRate",
  DingTalkMetricTrend
>;

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
    // 月度渠道级目标：{ [YYYY-MM]: { [platform]: 目标金额 } }，供前端切渠道取该渠道当月目标。
    monthlyTargetsByPlatform?: Record<string, Record<string, number>>;
    // 月度店铺级目标：{ [YYYY-MM]: { [platform|store]: 目标金额 } }，供店铺明细表计算月完成率。
    monthlyTargetsByStore?: Record<string, Record<string, number>>;
    monthlyOverview?: DingTalkMonthlyOverview;
    monthlyAchievement?: DingTalkMonthlyAchievement[];
    metricTrends?: DingTalkMetricTrends;
    // 渠道级同比/环比，key 为渠道名；服务端预聚合，前端切渠道时取对应渠道的 trends。
    metricTrendsByPlatform?: Record<string, DingTalkMetricTrends>;
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
