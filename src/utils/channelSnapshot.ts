import type { DingTalkMetricTotals, DingTalkMonthlyOverview, DingTalkSnapshot } from "../types/integration";

// 可累加的过程/结果指标；ctr/roi/completionRate 为派生值，累加后重算。
const ADDITIVE_METRIC_KEYS = [
  "exposure",
  "clicks",
  "spend",
  "paidOrders",
  "gmv",
  "netRevenue",
  "refund",
  "favorite",
  "addToCart",
  "target",
  "budget",
] as const;

function emptyMetrics(): DingTalkMetricTotals {
  return {
    exposure: 0,
    clicks: 0,
    spend: 0,
    paidOrders: 0,
    gmv: 0,
    netRevenue: 0,
    refund: 0,
    favorite: 0,
    addToCart: 0,
    target: 0,
    budget: 0,
    ctr: 0,
    roi: 0,
  };
}

function sumMetrics(target: DingTalkMetricTotals, source: Partial<DingTalkMetricTotals>): void {
  for (const key of ADDITIVE_METRIC_KEYS) {
    target[key] += Number(source[key] || 0);
  }
}

function withDerived(values: DingTalkMetricTotals): DingTalkMetricTotals {
  return {
    ...values,
    ctr: values.exposure ? values.clicks / values.exposure : 0,
    roi: values.spend ? values.gmv / values.spend : 0,
    completionRate: values.target ? values.netRevenue / values.target : 0,
  };
}

/**
 * 把全渠道 monthlyOverview 切成单渠道视图：去年同期逐日回款、全月回款、月度目标与完成率
 * 全部按渠道重算。目标优先取销售目标表该渠道当月值；缺失时按该渠道去年同期全月回款占
 * 全渠道去年同期全月回款的比例从全渠道目标分摊（仅兜底，非真值）。
 */
function buildChannelMonthlyOverview(
  overview: DingTalkMonthlyOverview,
  targetsByPlatform: Record<string, Record<string, number>> | undefined,
  channel: string,
): DingTalkMonthlyOverview {
  const priorYearDaily = (overview.priorYearDailyChannels ?? []).map((row) => ({
    date: row.date,
    netRevenue: row.channels.find((item) => item.platform === channel)?.netRevenue ?? 0,
  }));
  const priorYearFullMonthNetRevenue = priorYearDaily.reduce((sum, row) => sum + row.netRevenue, 0);

  const channelNetRevenue = overview.daily.reduce(
    (sum, row) => sum + (row.channels.find((item) => item.platform === channel)?.netRevenue ?? 0),
    0,
  );

  const channelTarget = targetsByPlatform?.[overview.month]?.[channel];
  const allChannelPriorFull = overview.priorYearFullMonthNetRevenue ?? 0;
  const derivedTarget = allChannelPriorFull && priorYearFullMonthNetRevenue
    ? (overview.metrics.target || 0) * priorYearFullMonthNetRevenue / allChannelPriorFull
    : 0;
  const target = channelTarget ?? derivedTarget;

  return {
    ...overview,
    priorYearDaily,
    priorYearFullMonthNetRevenue,
    metrics: {
      ...overview.metrics,
      netRevenue: channelNetRevenue,
      target,
      completionRate: target ? channelNetRevenue / target : 0,
    },
  };
}

/**
 * 把全渠道 DingTalk 快照切成单渠道视图：totals 取该渠道的 platform 行，
 * platforms/stores 过滤到该渠道，daily 由 reporting.dailyPlatforms 按日期重聚合，
 * monthlyOverview 按渠道重算目标进度带（去年同期逐日回款 + 渠道月度目标）。
 * channel 为 "all" 或空时原样返回。金额口径沿用 filterDingTalkSnapshot 的 daily 聚合，
 * 不引入新权威源。
 */
export function selectChannelSnapshot(dingtalk: DingTalkSnapshot, channel: string): DingTalkSnapshot {
  if (!channel || channel === "all") return dingtalk;
  const dailyPlatforms = dingtalk.reporting?.dailyPlatforms ?? [];
  const byDate = new Map<string, DingTalkMetricTotals>();
  for (const row of dailyPlatforms) {
    if (row.platform !== channel) continue;
    const acc = byDate.get(row.date) ?? emptyMetrics();
    sumMetrics(acc, row);
    byDate.set(row.date, acc);
  }
  const daily = [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-180)
    .map(([date, values]) => ({ date, ...withDerived(values) }));

  const platform = dingtalk.platforms.find((item) => item.platform === channel);
  const totals: DingTalkMetricTotals = platform ? { ...platform } : emptyMetrics();
  const overview = dingtalk.reporting?.monthlyOverview;
  const reporting = dingtalk.reporting && overview
    ? {
        ...dingtalk.reporting,
        monthlyOverview: buildChannelMonthlyOverview(overview, dingtalk.reporting.monthlyTargetsByPlatform, channel),
      }
    : dingtalk.reporting;
  return {
    ...dingtalk,
    totals,
    platforms: dingtalk.platforms.filter((item) => item.platform === channel),
    stores: dingtalk.stores.filter((item) => item.platform === channel),
    daily,
    reporting,
  };
}

/** 渠道下拉选项：按 GMV 降序，保留所有有数据的渠道（含唯品/小红书）。 */
export function channelOptions(dingtalk: DingTalkSnapshot | null): string[] {
  if (!dingtalk) return [];
  return [...dingtalk.platforms]
    .filter((item) => item.gmv > 0 || item.spend > 0)
    .sort((left, right) => right.gmv - left.gmv)
    .map((item) => item.platform);
}
