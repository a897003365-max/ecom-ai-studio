// 天猫竞品数据类目聚合：床垫类（默认）与儿童床垫两份同构数据模块的统一入口。
// 数据源各自 AUTO-GENERATED（gen_tmall_competitor_data.py），此处只做按类目分发。
import * as mattress from "./tmallCompetitorData";
import * as kids from "./tmallCompetitorData.kids";
import type { CompetitorPriceItem, CompetitorStore, Top100Dataset } from "../types";
import type { TmallSkuDetail } from "./tmallCompetitorData";

export type TmallCategory = "mattress" | "kids";

export interface TmallDataModule {
  tmallScrapedAt: string;
  tmallCompetitorPrices: CompetitorPriceItem[];
  tmallPricePeriods: Array<{ period: string; label: string; items: CompetitorPriceItem[] }>;
  tmallSkuDetails: Record<string, TmallSkuDetail[]>;
  tmallSkuTrendDays: string[];
  tmallCompetitorStores: CompetitorStore[];
  tmallTop100Fallback: Top100Dataset;
}

export interface TmallCategoryMeta {
  /** 控件显示名 */
  label: string;
  /** SKU 明细子表标题里的尺寸说明 */
  skuSizeLabel: string;
  /** 是否支持「分析主图 / 生成分析报告」（离线分析管线目前只接床垫类） */
  analyzeSupported: boolean;
  data: TmallDataModule;
}

export const TMALL_CATEGORY_ORDER: TmallCategory[] = ["mattress", "kids"];

export const TMALL_CATEGORY_DATA: Record<TmallCategory, TmallCategoryMeta> = {
  mattress: {
    label: "床垫类",
    skuSizeLabel: "1800mm×2000mm",
    analyzeSupported: true,
    data: mattress,
  },
  kids: {
    label: "儿童床垫",
    skuSizeLabel: "全部尺寸",
    analyzeSupported: false,
    data: kids,
  },
};
