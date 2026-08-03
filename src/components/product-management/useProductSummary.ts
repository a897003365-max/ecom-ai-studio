// 商品变化指挥中心 · 数据层
// 把真实 ProductManagementPages 聚合成设计稿总览面板所需的渲染模型，
// 移植设计稿 index.html 的 summary() / radarMetrics() / 趋势拆分逻辑，改读真实字段。
import type {
  ProductManagementPages,
  ProductMatrix,
  ProductDailyTrendItem,
} from "../../types/integration";
import { money, percent, pp, count, days } from "./productCommandFormat";

const clamp = (v: number) => Math.max(0, Math.min(100, v));

export interface Summary {
  received: number;
  prevReceived: number;
  net: number;
  prevNet: number;
  units: number;
  prevUnits: number;
  refundRate: number | null;
  prevRefundRate: number | null;
  margin: number | null;
  prevMargin: number | null;
  grossProfit: number | null;
  prevGrossProfit: number | null;
  avgPrice: number | null;
  prevAvgPrice: number | null;
  customRate: number | null;
  prevCustomRate: number | null;
  shipDays: number | null;
  pendingUnits: number | null;
  prevPendingUnits: number | null;
}

export interface ConclusionCard {
  label: string;
  headline: string;
  sub: string;
  good?: boolean | null;
}

export interface KpiCard {
  label: string;
  value: string;
  previous: string;
  detail: string;
  delta: number | null;
  tone: "green" | "blue" | "orange" | "red";
  inverse: boolean;
  unit: "percent" | "pp";
}

export interface SecondaryMetric {
  label: string;
  value: string;
  prev: string;
  good: boolean;
  up: boolean;
  change: string;
  accent?: "blue" | "orange";
}

export interface RadarModel {
  labels: string[];
  scores: number[];
  overall: number;
  hhi: number;
  n: number;
  salesGrowth: number;
  collectionQuality: number;
  margin: number | null;
  marginDelta: number | null;
  refundRate: number | null;
  refundDelta: number | null;
  shipDays: number | null;
  pendingUnits: number | null;
  pressure: number;
}

export interface TrendSeries {
  days: string[]; // 07-01 ...（当期日期）
  prevDays: string[]; // 与 days 同序的上期对齐日期（按日序第 N 天对第 N 天）
  current: number[];
  previous: (number | null)[];
  refund: number[];
  margin: (number | null)[];
}

export interface CategoryRow {
  name: string;
  net: number;
  prevNet: number | null;
  share: number;
  refundRate: number | null;
  units: number;
  change: number | null;
}

export interface CategoryNote {
  label: string;
  value: string;
  sub: string;
}

export interface ChannelRow {
  name: string;
  received: number;
  net: number;
  share: number;
}

export interface ProductRow {
  name: string;
  code: string;
  spu: string;
  channel: string;
  received: number;
  prev: number | null;
  share: number;
  units: number;
  refundRate: number | null;
  growth: number | null;
  action: string;
}

export interface ProductCommandModel {
  period: { start: string; end: string } | null;
  currentMonth: string | null;
  previousMonth: string | null;
  currentPeriod: { start: string; end: string } | null;
  previousPeriod: { start: string; end: string } | null;
  summary: Summary;
  conclusions: ConclusionCard[];
  kpis: KpiCard[];
  secondary: SecondaryMetric[];
  radar: RadarModel;
  trend: TrendSeries;
  categoryRows: CategoryRow[];
  categoryNotes: CategoryNote[];
  channelRows: ChannelRow[];
  productRows: ProductRow[];
  channelWarehouseMatrix: ProductMatrix;
  channelCategoryMatrix: ProductMatrix;
}

const EMPTY_MODEL: ProductCommandModel = {
  period: null,
  currentMonth: null,
  previousMonth: null,
  currentPeriod: null,
  previousPeriod: null,
  summary: zeroSummary(),
  conclusions: [],
  kpis: [],
  secondary: [],
  radar: emptyRadar(),
  trend: { days: [], prevDays: [], current: [], previous: [], refund: [], margin: [] },
  categoryRows: [],
  categoryNotes: [],
  channelRows: [],
  productRows: [],
  channelWarehouseMatrix: { columns: [], rows: [] },
  channelCategoryMatrix: { columns: [], rows: [] },
};

function zeroSummary(): Summary {
  return {
    received: 0, prevReceived: 0, net: 0, prevNet: 0, units: 0, prevUnits: 0,
    refundRate: null, prevRefundRate: null, margin: null, prevMargin: null,
    grossProfit: null, prevGrossProfit: null, avgPrice: null, prevAvgPrice: null,
    customRate: null, prevCustomRate: null, shipDays: null,
    pendingUnits: null, prevPendingUnits: null,
  };
}

function emptyRadar(): RadarModel {
  return {
    labels: ["销售增长", "回款质量", "利润健康", "退货健康", "渠道均衡", "履约稳定"],
    scores: [0, 0, 0, 0, 0, 0], overall: 0, hhi: 0, n: 0,
    salesGrowth: 0, collectionQuality: 0, margin: null, marginDelta: null,
    refundRate: null, refundDelta: null, shipDays: null, pendingUnits: null, pressure: 0,
  };
}

function median(values: Array<number | null | undefined>): number | null {
  const list = values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

function buildSummary(pm: ProductManagementPages): Summary {
  const k = pm.kpis as Record<string, number | null>;
  const mc = pm.monthlyComparison;
  const prev = mc?.previous ?? {};
  const shipDays = median((pm.fulfillmentByProduct ?? []).map((r) => r.avgShippingDays));
  return {
    received: num(k.totalReceivedAmount),
    prevReceived: num(prev.receivedAmount),
    net: num(k.totalReceivedAmount) - num(k.totalRefundAmount),
    prevNet: prev.netSales != null ? num(prev.netSales) : num(prev.receivedAmount) - num(prev.refundAmount),
    units: num(k.totalSalesUnits),
    prevUnits: num(prev.salesUnits),
    refundRate: k.refundRate ?? null,
    prevRefundRate: prev.refundRate ?? null,
    margin: k.grossMargin ?? null,
    prevMargin: prev.grossMargin ?? null,
    grossProfit: k.totalGrossProfit ?? null,
    prevGrossProfit: prev.grossProfit ?? null,
    avgPrice: k.avgUnitPrice ?? null,
    prevAvgPrice: prev.avgUnitPrice ?? null,
    customRate: k.customRate ?? null,
    prevCustomRate: prev.customRate ?? null,
    shipDays,
    pendingUnits: k.pendingUnits ?? null,
    prevPendingUnits: k.prevPendingUnits ?? null,
  };
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return cur / prev - 1;
}

function buildConclusions(s: Summary): ConclusionCard[] {
  const netChange = pctChange(s.net, s.prevNet);
  const receivedChange = pctChange(s.received, s.prevReceived);
  const refundDelta = s.refundRate != null && s.prevRefundRate != null ? s.refundRate - s.prevRefundRate : null;
  const refundGood = refundDelta == null ? null : refundDelta <= 0;
  const fmtPct = (v: number | null, sign = true) => (v == null ? "-" : `${v >= 0 && sign ? "+" : ""}${(v * 100).toFixed(1)}%`);
  return [
    {
      label: "净销售额",
      headline: netChange == null ? "本期无上期" : `${netChange >= 0 ? "↑ 增长" : "↓ 下滑"} ${fmtPct(netChange, false)}`,
      sub: `上期 ${money(s.prevNet)}`,
    },
    {
      label: "商家实收",
      headline: receivedChange == null ? "本期无上期" : `${receivedChange >= 0 ? "↑ 增长" : "↓ 下滑"} ${fmtPct(receivedChange, false)}`,
      sub: `上期 ${money(s.prevReceived)}`,
    },
    {
      label: "退货率",
      headline: refundDelta == null ? "本期无上期" : `${refundGood ? "↓ 改善" : "↑ 恶化"} ${pp(refundDelta)}`,
      sub: s.refundRate == null ? "当前 -" : `当前 ${(s.refundRate * 100).toFixed(2)}% / 上期 ${s.prevRefundRate == null ? "-" : (s.prevRefundRate * 100).toFixed(2) + "%"}`,
      good: refundGood,
    },
  ];
}

function buildKpis(s: Summary): KpiCard[] {
  return [
    {
      label: "净销售额", value: money(s.net), previous: money(s.prevNet),
      detail: "商家实收 - 退货金额", delta: pctChange(s.net, s.prevNet), tone: "blue", inverse: false, unit: "percent",
    },
    {
      label: "商家实收", value: money(s.received), previous: money(s.prevReceived),
      detail: "本期，同期口径", delta: pctChange(s.received, s.prevReceived), tone: "green", inverse: false, unit: "percent",
    },
    {
      label: "毛利率", value: percent(s.margin, 1), previous: percent(s.prevMargin, 1),
      detail: `总毛利 ${money(s.grossProfit)}`, delta: s.margin != null && s.prevMargin != null ? s.margin - s.prevMargin : null,
      tone: "orange", inverse: false, unit: "pp",
    },
    {
      label: "退货率", value: percent(s.refundRate, 2), previous: percent(s.prevRefundRate, 2),
      detail: "退货金额 / 商家实收",
      delta: s.refundRate != null && s.prevRefundRate != null ? s.refundRate - s.prevRefundRate : null,
      tone: "red", inverse: true, unit: "pp",
    },
  ];
}

function buildSecondary(s: Summary): SecondaryMetric[] {
  const unitsChange = pctChange(s.units, s.prevUnits);
  const grossChange = pctChange(num(s.grossProfit), num(s.prevGrossProfit));
  const priceChange = pctChange(num(s.avgPrice), num(s.prevAvgPrice));
  const customDelta = s.customRate != null && s.prevCustomRate != null ? s.customRate - s.prevCustomRate : null;
  const pendingChange = pctChange(num(s.pendingUnits), num(s.prevPendingUnits));
  const pctLabel = (v: number | null) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
  return [
    { label: "销量", value: `${count(s.units)} 件`, prev: `${count(s.prevUnits)} 件`, good: (unitsChange ?? 0) >= 0, up: (unitsChange ?? 0) >= 0, change: pctLabel(unitsChange) },
    { label: "总毛利", value: money(s.grossProfit), prev: money(s.prevGrossProfit), good: (grossChange ?? 0) >= 0, up: (grossChange ?? 0) >= 0, change: pctLabel(grossChange) },
    { label: "件单价", value: s.avgPrice != null ? `¥${count(s.avgPrice)}` : "-", prev: s.prevAvgPrice != null ? `¥${count(s.prevAvgPrice)}` : "-", good: (priceChange ?? 0) >= 0, up: (priceChange ?? 0) >= 0, change: pctLabel(priceChange) },
    { label: "定制率", value: percent(s.customRate, 1), prev: percent(s.prevCustomRate, 1), good: (customDelta ?? 0) >= 0, up: (customDelta ?? 0) >= 0, change: pp(customDelta) },
    { label: "发货时效中位数", value: days(s.shipDays), prev: "上期 -", good: true, up: false, change: "-", accent: "blue" },
    { label: "待发货件数", value: s.pendingUnits != null ? `${count(s.pendingUnits)} 件` : "-", prev: s.prevPendingUnits != null ? `${count(s.prevPendingUnits)} 件` : "上期 -", good: (pendingChange ?? 0) <= 0, up: (pendingChange ?? 0) >= 0, change: pctLabel(pendingChange), accent: "orange" },
  ];
}

function buildRadar(s: Summary, pm: ProductManagementPages): RadarModel {
  const labels = emptyRadar().labels;
  const rows = pm.channelBreakdown ?? [];
  const scopedNet = rows.reduce((sum, r) => sum + num(r.receivedAmount), 0);
  const n = rows.length;
  const shares = rows.map((r) => num(r.receivedAmount) / Math.max(scopedNet, 1));
  const hhi = shares.reduce((sum, sh) => sum + sh * sh, 0) * 10000;
  const salesGrowth = s.prevNet ? s.net / s.prevNet - 1 : 0;
  const collectionQuality = s.received ? s.net / s.received : 0;
  const marginDelta = s.margin != null && s.prevMargin != null ? s.margin - s.prevMargin : 0;
  const refundDelta = s.refundRate != null && s.prevRefundRate != null ? s.refundRate - s.prevRefundRate : 0;
  const pressure = s.units ? num(s.pendingUnits) / s.units : 0;
  const timeScore = clamp(100 - Math.max(0, num(s.shipDays) - 2) * 18);
  const pressureScore = clamp(100 - pressure * 1200);
  const balanceScore = n > 1 ? clamp((1 - (hhi / 10000 - 1 / n) / (1 - 1 / n)) * 100) : 0;
  const margin = s.margin ?? 0.3;
  const refundRate = s.refundRate ?? 0.08;
  const scores = [
    clamp(50 + salesGrowth * 250),
    clamp(collectionQuality * 100),
    clamp(50 + (margin - 0.3) * 200 + marginDelta * 300),
    clamp(100 - refundRate * 400 + (-refundDelta) * 500),
    balanceScore,
    timeScore * 0.6 + pressureScore * 0.4,
  ];
  return {
    labels, scores, overall: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    hhi: Math.round(hhi), n,
    salesGrowth, collectionQuality, margin: s.margin, marginDelta: s.margin != null && s.prevMargin != null ? marginDelta : null,
    refundRate: s.refundRate, refundDelta: s.refundRate != null && s.prevRefundRate != null ? refundDelta : null,
    shipDays: s.shipDays, pendingUnits: s.pendingUnits, pressure,
  };
}

/** 当期 dailyTrend vs 上期 previousDailyTrend 按日序对齐（第 1 天对第 1 天）。
 * 当期=所选日期范围（x 天），上期=所选范围前一段等长窗口（x 天）。
 * 毛利率按日由累计毛利额 / 累计匹配行商家实收推得，避免对比率做算术平均。 */
function buildTrend(pm: ProductManagementPages): TrendSeries {
  const mc = pm.monthlyComparison;
  const curP = mc?.currentPeriod ?? null;
  const prevP = mc?.previousPeriod ?? null;
  const daily = pm.dailyTrend ?? [];
  const prevDaily = pm.previousDailyTrend ?? [];
  if (!curP) return { days: [], prevDays: [], current: [], previous: [], refund: [], margin: [] };
  const curStart = parseISODate(curP.start);
  const curEnd = parseISODate(curP.end);
  const prevStart = prevP ? parseISODate(prevP.start) : null;
  const span = Math.round((curEnd.getTime() - curStart.getTime()) / 86_400_000) + 1;
  const curByDate = indexDailyByDate(daily);
  const prevByDate = indexDailyByDate(prevDaily);
  const days: string[] = [];
  const prevDays: string[] = [];
  const current: number[] = [];
  const previous: (number | null)[] = [];
  const refund: number[] = [];
  const margin: (number | null)[] = [];
  for (let i = 0; i < span; i++) {
    const curDate = addDays(curStart, i);
    const cur = curByDate.get(formatISODate(curDate));
    if (!cur) continue; // 当期缺日则跳过
    const prevDate = prevStart ? addDays(prevStart, i) : null;
    const prev = prevDate ? prevByDate.get(formatISODate(prevDate)) ?? null : null;
    days.push(`${pad2(curDate.getMonth() + 1)}-${pad2(curDate.getDate())}`);
    prevDays.push(prevDate ? `${pad2(prevDate.getMonth() + 1)}-${pad2(prevDate.getDate())}` : "");
    current.push(cur.received);
    previous.push(prev ? prev.received : null);
    refund.push(cur.received ? (cur.refund / cur.received) * 100 : 0);
    margin.push(cur.matchedReceived > 0 ? (cur.grossProfit / cur.matchedReceived) * 100 : null);
  }
  return { days, prevDays, current, previous, refund, margin };
}

function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatISODate(dt: Date): string {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function addDays(dt: Date, n: number): Date {
  const r = new Date(dt);
  r.setDate(r.getDate() + n);
  return r;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function indexDailyByDate(rows: ProductDailyTrendItem[]): Map<string, { received: number; refund: number; grossProfit: number; matchedReceived: number }> {
  const map = new Map<string, { received: number; refund: number; grossProfit: number; matchedReceived: number }>();
  for (const r of rows) {
    const key = String(r.date ?? "");
    const acc = map.get(key) ?? { received: 0, refund: 0, grossProfit: 0, matchedReceived: 0 };
    acc.received += num(r.receivedAmount);
    acc.refund += num(r.refundAmount);
    acc.grossProfit += num(r.grossProfit);
    acc.matchedReceived += num(r.matchedReceived);
    map.set(key, acc);
  }
  return map;
}

function buildCategories(pm: ProductManagementPages): { rows: CategoryRow[]; notes: CategoryNote[] } {
  const cats = (pm.mattressCategoryBreakdown ?? []).slice().sort((a, b) => num(b.receivedAmount) - num(a.receivedAmount));
  const totalNet = cats.reduce((sum, c) => sum + num(c.receivedAmount), 0) || 1;
  const rows: CategoryRow[] = cats.map((c) => {
    const net = num(c.receivedAmount);
    const prevNet = c.prevReceivedAmount ?? null;
    return {
      name: c.category,
      net,
      prevNet,
      share: net / totalNet,
      refundRate: c.refundRate ?? null,
      units: num(c.salesUnits),
      change: prevNet != null && prevNet > 0 ? net / prevNet - 1 : null,
    };
  });
  if (!rows.length) return { rows: [], notes: [] };
  const largest = rows.reduce((a, b) => (b.net > a.net ? b : a));
  const withChange = rows.filter((r) => r.change != null);
  const fastest = withChange.reduce((a, b) => ((b.change ?? 0) > (a.change ?? 0) ? b : a), withChange[0] ?? rows[0]);
  const riskiest = rows.reduce((a, b) => (num(b.refundRate) > num(a.refundRate) ? b : a));
  const notes: CategoryNote[] = [
    { label: "最大规模类别", value: largest.name, sub: `净销售额 ${money(largest.net)}` },
    { label: "增长最快类别", value: fastest.name, sub: fastest.change != null ? `环比 +${(fastest.change * 100).toFixed(1)}%` : "无上期" },
    { label: "退货关注类别", value: riskiest.name, sub: `退货率 ${percent(riskiest.refundRate, 1)}` },
  ];
  return { rows, notes };
}

function buildChannels(pm: ProductManagementPages): ChannelRow[] {
  const rows = (pm.channelBreakdown ?? []).slice().sort((a, b) => num(b.receivedAmount) - num(a.receivedAmount));
  const totalNet = rows.reduce((sum, r) => sum + num(r.receivedAmount) - num(r.refundAmount), 0) || 1;
  return rows.map((r) => {
    const net = num(r.receivedAmount) - num(r.refundAmount);
    return {
      name: r.channel,
      received: num(r.receivedAmount),
      net,
      share: net / totalNet,
    };
  });
}

function dominantChannel(matrix: ProductMatrix | undefined | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!matrix) return map;
  for (const row of matrix.rows) {
    let best = "";
    let bestVal = -1;
    for (const col of matrix.columns) {
      const v = num(row.values[col]);
      if (v > bestVal) { bestVal = v; best = col; }
    }
    map.set(row.rowKey, best);
  }
  return map;
}

function buildProducts(pm: ProductManagementPages): ProductRow[] {
  const dom = dominantChannel(pm.productChannelMatrix);
  const rows = (pm.productNameOverview ?? []).slice().sort((a, b) => num(b.receivedAmount) - num(a.receivedAmount));
  return rows.map((r) => {
    const received = num(r.receivedAmount);
    const prev = r.prevReceivedAmount ?? null;
    const growth = prev != null && prev > 0 ? received / prev - 1 : null;
    const refundRate = r.refundRate ?? null;
    let action = "保持主推，补充场景素材";
    if (refundRate != null && refundRate >= 0.1) action = "复盘直播承诺与售后原因";
    else if (growth != null && growth < 0) action = "检查价格带，维持搜索投放";
    return {
      name: r.productName,
      code: r.productCode ?? "-",
      spu: r.spu ?? "未识别 SPU",
      channel: dom.get(r.productName) ?? "-",
      received,
      prev,
      share: r.amountShare ?? 0,
      units: num(r.salesUnits),
      refundRate,
      growth,
      action,
    };
  });
}

export function buildProductCommandModel(pm: ProductManagementPages | null): ProductCommandModel {
  if (!pm) return EMPTY_MODEL;
  const summary = buildSummary(pm);
  const cats = buildCategories(pm);
  return {
    period: pm.period,
    currentMonth: pm.monthlyComparison?.currentMonth ?? null,
    previousMonth: pm.monthlyComparison?.previousMonth ?? null,
    currentPeriod: pm.monthlyComparison?.currentPeriod ?? null,
    previousPeriod: pm.monthlyComparison?.previousPeriod ?? null,
    summary,
    conclusions: buildConclusions(summary),
    kpis: buildKpis(summary),
    secondary: buildSecondary(summary),
    radar: buildRadar(summary, pm),
    trend: buildTrend(pm),
    categoryRows: cats.rows,
    categoryNotes: cats.notes,
    channelRows: buildChannels(pm),
    productRows: buildProducts(pm),
    channelWarehouseMatrix: pm.channelWarehouseMatrix ?? { columns: [], rows: [] },
    channelCategoryMatrix: pm.channelCategoryMatrix ?? { columns: [], rows: [] },
  };
}

// 格式化助手重导出，供组件直接使用
export { money, percent, pp, count, days };
