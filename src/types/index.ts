import type { ReactNode } from "react";

export type PageId =
  | "dashboard"
  | "assets"
  | "content"
  | "images"
  | "analytics"
  | "intelligence"
  | "tasks"
  | "products"
  | "settings"
  | "access";

export type Tone =
  | "green"
  | "blue"
  | "orange"
  | "red"
  | "purple"
  | "pink"
  | "muted";

export type Platform = "天猫" | "京东" | "抖音" | "快手" | "小红书" | "拼多多" | "TikTok";

export type TaskType =
  | "content_generate"
  | "script_generate"
  | "image_process"
  | "competitor_crawl"
  | "top100_crawl"
  | "data_sync"
  | "quality_check"
  | "export_package";

export type TaskStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "waiting"
  | "retrying"
  | "cancelled";

export type ProductStatus =
  | TaskStatus
  | "review"
  | "confirmed";

export interface NavItem {
  id: PageId;
  label: string;
  icon: string;
  group: string;
}

export interface ToastMessage {
  id: number;
  title: string;
  detail?: string;
  tone?: Tone;
}

export interface KpiMetric {
  label: string;
  value: string;
  detail?: string;
  delta?: string;
  trend?: "up" | "down" | "flat";
  tone?: Tone;
  progress?: number;
}

export interface ModuleOverview {
  id: PageId;
  icon: string;
  title: string;
  desc: string;
  status: string;
  tone: Tone;
  progress: number;
  meta: string;
}

export interface BusinessLineOverview {
  id: PageId;
  icon: string;
  title: string;
  desc: string;
  progress: number;
  outputToday: string;
  exceptionCount: number;
  nextAction: string;
  tone: Tone;
}

export interface SystemStatusItem {
  label: string;
  value: string;
  tone: Tone;
}

export interface DataSourceStatus {
  name: string;
  value: string;
  status: string;
  tone: Tone;
}

export interface ProductAsset {
  id: string;
  name: string;
  sku: string;
  category: string;
  priceBand: string;
  materialSource: string;
  imageCount: number;
  videoCount: number;
  contentReady: boolean;
  missingFields: string[];
  lastUpdated: string;
  owner: string;
}

export interface ProductAssetSummary {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

export interface PipelineStep {
  id: string;
  title: string;
  desc: string;
  status: string;
  tone: Tone;
  progress: number;
  meta: string;
}

export interface StoryboardShot {
  shot: number;
  visual: string;
  voiceover: string;
  subtitle: string;
  duration: string;
  propScene: string;
  risk: string;
}

export interface GenerationResult {
  title: string;
  sellingPoints: string[];
  seedingCopy: string;
  videoVoiceover: string;
  liveScript: string;
  detailCopy: string;
  storyboard: StoryboardShot[];
}

export interface ContentProduct {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: string;
  coreSellingPoint: string;
  targetPlatform: Platform;
  materialSource: string;
  status: ProductStatus;
  confirmationStatus: "待确认" | "已确认" | "需重审";
  qualityScore: number;
  batch: string;
  result: GenerationResult;
}

export interface ImageTask {
  id: string;
  thumb: string;
  productName: string;
  sku: string;
  processType: string;
  sizeRule: string;
  status: TaskStatus;
  beforePreview: string;
  afterPreview: string;
  failReason: string;
  updatedAt: string;
}

export interface PlatformStatus {
  platform: Platform;
  status: string;
  tone: Tone;
  planCount: number;
  assetCount: number;
  impressions: string;
  clicks: string;
  gmv: string;
}

export interface MaterialPerformance {
  rank: string;
  name: string;
  thumb: string;
  platform: Platform;
  impressions: string;
  ctr: string;
  conversion: string;
  favoriteRate: string;
  spend: string;
  roi: string;
  winRate: string;
}

export interface RegenerationSuggestion {
  id: string;
  kind: "content_generate" | "image_process";
  type: string;
  title: string;
  desc: string;
  reason: string;
  uplift: string;
  target: string;
  product: string;
  thumb: string;
}

export interface Top100Item {
  rank: number;
  mainImage: string;
  productName: string;
  store: string;
  brand: string;
  platform: Platform;
  price: string;
  campaignPrice: string;
  heat: string;
  campaignTag: string;
  crawledAt: string;
  monitored: boolean;
}

export interface CompetitorStore {
  store: string;
  platform: Platform;
  brand: string;
  productCount: number;
  warningCount: number;
  lastCrawl: string;
  status: string;
}

export interface CompetitorPriceItem {
  id: string;
  productName: string;
  mainImage: string;
  store: string;
  brand: string;
  platform: Platform;
  originalPrice: string;
  couponPrice: string;
  campaignInfo: string;
  previousPrice: string;
  priceChange: string;
  low30d: string;
  newStatus: string;
  warningStatus: string;
  alertThreshold: string;
  alertReason: string;
  suggestedAction: string;
  tone: Tone;
}

export interface QueueTask {
  id: string;
  name: string;
  type: TaskType;
  module: string;
  batch: string;
  progress: number;
  successCount: number;
  failedCount: number;
  waitingConfirmCount: number;
  status: TaskStatus;
  startedAt: string;
  updatedAt: string;
  logEntry: string;
  timeline: string[];
  inputFiles: string[];
  outputFiles: string[];
  failureReason: string;
}

export interface TaskCreateInput {
  name: string;
  type: TaskType;
  module: string;
  batch: string;
  status?: TaskStatus;
  progress?: number;
  successCount?: number;
  failedCount?: number;
  waitingConfirmCount?: number;
  inputFiles?: string[];
  outputFiles?: string[];
  timeline?: string[];
  failureReason?: string;
}

export interface ConfigItem {
  name: string;
  desc: string;
  status: string;
  tone: Tone;
  value: string;
}

export interface AgentResponsibility {
  businessLine: string;
  ai: string[];
  human: string[];
}

export interface TableColumn<T> {
  key: string;
  label: string;
  width?: string;
  render: (item: T) => ReactNode;
}

// ---------- 竞品情报 · TOP100 真实数据（Stage A） ----------
// 数据源：竞品主图分析/analysis/batch{1-10}_results.json (60 行 × 85 字段)
// 由 scripts/build-intelligence-dataset.mjs 压平后落地到 local-data/intelligence/

export interface Top100ItemScores {
  CH_clarity: number | null;      // 信息清晰度
  CI_sellpoint: number | null;    // 卖点表达
  CJ_diff: number | null;         // 差异化
  CK_price: number | null;        // 价格吸引力
  CL_gift: number | null;         // 赠品吸引力
  CM_trust: number | null;        // 信任建立
  CN_urgency: number | null;      // 紧迫感
  CO_visual: number | null;       // 视觉完成度
  CP_total: number | null;        // 综合转化潜力
}

export interface Top100ItemV2 {
  row: number;
  ranking: number;
  cpRank: number;
  productName: string;
  brand: string;
  shop: string;
  platform: string;
  priceRange: string;
  salesRange: string;
  keywords: string;
  imageFile: string | null;
  scores: Top100ItemScores;
  // 精选字段
  headline: string;
  subheadline: string;
  keyNumbers: string;
  visualFocus1: string;
  visualFocus2: string;
  mainTheme: string;
  marketingCategory: string;
  marketingCore: string;
  marketingStrength: string;
  sellPointCore: string;
  sellPointExtra: string;
  userBenefit: string;
  painPoints: string;
  hasGift: string;
  giftContent: string;
  priceExpression: string;
  urgencySource: string;
  layoutType: string;
  mainColor: string;
  audience: string;
  scene: string;
  conversionFormula: string;
  biggestAdvantage: string;
  biggestProblem: string;
  worthLearning: string;
  // 完整原始 85 字段
  raw: Record<string, unknown>;
  isOwnBrand: boolean;
}

export interface Top100Dataset {
  generatedAt: string;
  samplePeriod: string;
  sourceCount: number;
  fieldCount: number;
  items: Top100ItemV2[];
}

export interface BrandRankingItem {
  rank: number;
  brand: string;
  count: number;
  avgCP: number;
  rows: number[];
  isOwnBrand: boolean;
}

export interface BrandRankingDataset {
  generatedAt: string;
  ranking: BrandRankingItem[];
}

export interface InsightSchool {
  id: "A" | "B" | "C" | "D";
  name: string;
  subtitle: string;
  representatives: string[];
  features: string[];
  tone: Tone;
  isOwnSchool?: boolean;
}

export interface OwnBrandAction {
  id: string;
  title: string;
  issue: string;
  action: string;
  expectedGain: string;
}

export interface InsightsDataset {
  generatedAt: string;
  schools: InsightSchool[];
  ownBrandActions: {
    brand: string;
    currentScore: number;
    currentRank: string;
    p0: OwnBrandAction[];
    p1: OwnBrandAction[];
  };
}
