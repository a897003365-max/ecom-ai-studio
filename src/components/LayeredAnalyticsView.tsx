import { Filter } from "lucide-react";
import { Card } from "./Card";
import { ChannelPerformanceCharts } from "./ChannelPerformanceCharts";
import { ChannelShareChart } from "./ChannelShareChart";
import { ComparisonTicker } from "./ComparisonTicker";
import { FunnelMini } from "./FunnelMini";
import { KpiCardLarge } from "./KpiCardLarge";
import { KpiSection } from "./KpiSection";
import { MonthlyOverview } from "./MonthlyOverview";
import { MonthlyAchievementChart } from "./MonthlyAchievementChart";
import { PlatformBadge } from "./PlatformBadge";
import { RiskAlertCard } from "./RiskAlertCard";
import { StatusTag } from "./StatusTag";
import { TableShell } from "./TableShell";
import type { KpiMetric, Platform } from "../types";
import type { DingTalkMetricTrend, DingTalkSnapshot, WarehouseDashboardMetrics } from "../types/integration";

interface LayeredAnalyticsViewProps {
  dingtalk: DingTalkSnapshot;
  chartChannels: string[];
  activeChartChannel: string;
  onChannelChange: (channel: string) => void;
  metrics: KpiMetric[]; // 现有 8 张卡的完整清单，用于兜底
  warehouseDashboard: WarehouseDashboardMetrics | null;
  platforms: Array<{ platform: string; gmv: number; netRevenue: number; spend: number; feeRate: number; addToCart: number; recoveryRate: number; refund: number; refundRate: number; channelShare?: number }>;
  stores: Array<{ platform: string; store: string; gmv: number; netRevenue: number; spend: number; feeRate: number; addToCart: number; recoveryRate: number; refund: number; refundRate: number; offsiteSpend?: number }>;
}

const compactNumber = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const currencyNumber = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", notation: "compact", maximumFractionDigits: 1 });

function money(value: number) {
  return currencyNumber.format(value || 0);
}
function count(value: number) {
  return compactNumber.format(value || 0);
}
function percent(value?: number) {
  return `${((value || 0) * 100).toFixed(2)}%`;
}

function trendValue(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { label: "—", direction: "flat" as const };
  }
  return {
    label: `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`,
    direction: value > 0 ? "up" as const : value < 0 ? "down" as const : "flat" as const,
  };
}

function trendProps(trend?: DingTalkMetricTrend | null) {
  const yoy = trendValue(trend?.yoy);
  const mom = trendValue(trend?.mom);
  return {
    yoy: yoy.label,
    mom: mom.label,
    yoyTrend: yoy.direction,
    momTrend: mom.direction,
  };
}

function buildWarehouseMetrics(dashboard: WarehouseDashboardMetrics | null): {
  clientAvgPrice: KpiMetric;
  itemAvgPrice: KpiMetric;
  addToCartRate: KpiMetric;
  promotionFeeRate: KpiMetric;
  visitors: KpiMetric;
  orders: KpiMetric;
  paymentConversion: KpiMetric;
} {
  const values = dashboard?.available && dashboard.coverageComplete ? dashboard.metrics : null;
  const coverage = dashboard?.coverage ? `${dashboard.coverage.start} 至 ${dashboard.coverage.end}` : "暂无可用数据";
  const noData = dashboard?.partial
    ? `当前筛选期仅有部分数据，已停止展示指标 · 可选 ${coverage}`
    : `当前日期无数据 · 可选 ${coverage}`;
  return {
    clientAvgPrice: { label: "客单价", value: values ? money(values.clientAvgPrice) : "—", detail: values ? undefined : noData, tone: "blue" },
    itemAvgPrice: { label: "件单价", value: values ? money(values.itemAvgPrice) : "—", detail: values ? undefined : noData, tone: "blue" },
    addToCartRate: { label: "加购转化", value: values ? percent(values.addToCartRate) : "—", detail: values ? "加购人数 / 访客" : noData, tone: "purple" },
    promotionFeeRate: { label: "推广费比", value: values ? percent(values.promotionSpend / values.promotionRevenue) : "—", detail: values ? "推广花费 / 推广成交金额" : noData, tone: "orange" },
    visitors: { label: "访客数", value: values ? count(values.visitors) : "—", detail: values ? undefined : noData, tone: "blue" },
    orders: { label: "成交客户数", value: values ? count(values.payBuyers) : "—", detail: values ? undefined : noData, tone: "blue" },
    paymentConversion: { label: "支付转化率", value: values ? percent(values.paymentConversion) : "—", detail: values ? "支付买家 / 访客" : noData, tone: "green" },
  };
}

export function LayeredAnalyticsView({
  dingtalk,
  chartChannels,
  activeChartChannel,
  onChannelChange,
  metrics,
  warehouseDashboard,
  platforms,
  stores,
}: LayeredAnalyticsViewProps) {
  const reporting = dingtalk.reporting;
  const warehouseKpis = buildWarehouseMetrics(warehouseDashboard);
  const warehouseValues = warehouseDashboard?.available && warehouseDashboard.coverageComplete ? warehouseDashboard.metrics : null;
  const warehouseTrends = warehouseDashboard?.available && warehouseDashboard.coverageComplete ? warehouseDashboard.trends : null;

  // L1 层：从 metrics 中提取真实的 GMV / 回款额 / 回款率
  const gmvMetric = metrics.find((m) => m.label === "GMV");
  const netRevenueMetric = metrics.find((m) => m.label === "回款额");
  const recoveryRateMetric = metrics.find((m) => m.label === "回款率");

  // L3 层：站内费额 / 费比来自钉钉，推广费比来自 PowerBI 本地数仓
  const spendMetric = metrics.find((m) => m.label === "站内费额");
  const feeRateMetric = metrics.find((m) => m.label === "费比");

  // L5 层：退款金额 / 退款率
  const refundMetric = metrics.find((m) => m.label === "退款金额");
  const refundRateMetric = metrics.find((m) => m.label === "退款率");
  const addToCartMetric = metrics.find((m) => m.label === "加购人数");

  // 高风险店铺 (refundRate >= 40%)
  const highRiskStores = [...stores]
    .filter((s) => s.refundRate >= 0.4)
    .sort((a, b) => b.refundRate - a.refundRate)
    .slice(0, 3)
    .map((s) => ({ label: `${s.platform} · ${s.store}`, value: percent(s.refundRate) }));

  const highestRefundChannel = [...platforms].sort((a, b) => b.refundRate - a.refundRate)[0];
  const highestFeeStore = [...stores].sort((a, b) => b.feeRate - a.feeRate)[0];
  const leadingChannel = [...platforms].sort((a, b) => (b.channelShare || 0) - (a.channelShare || 0))[0];

  return (
    <>
      {reporting?.latestComparison && (
        <div className="mb-5" data-testid="comparison-ticker">
          <ComparisonTicker comparison={reporting.latestComparison} />
        </div>
      )}

      {/* 销售业绩（无 L1 标签） */}
      <KpiSection layerCode="L1" title="销售业绩" subtitle="全渠道成交结果" tone="green" showLayerLabel={false}>
        {gmvMetric && <KpiCardLarge metric={gmvMetric} {...trendProps(reporting?.metricTrends?.gmv)} />}
        {netRevenueMetric && <KpiCardLarge metric={netRevenueMetric} {...trendProps(reporting?.metricTrends?.netRevenue)} />}
        {recoveryRateMetric && <KpiCardLarge metric={recoveryRateMetric} {...trendProps(reporting?.metricTrends?.recoveryRate)} />}
      </KpiSection>

      {/* 流量转化（无 L4 标签） */}
      <KpiSection layerCode="L4" title="流量转化" subtitle="旗舰店流量与转化漏斗" tone="blue" showLayerLabel={false}>
        <KpiCardLarge metric={warehouseKpis.visitors} {...trendProps(warehouseTrends?.visitors)} />
        <KpiCardLarge metric={warehouseKpis.orders} {...trendProps(warehouseTrends?.payBuyers)} />
        <KpiCardLarge metric={warehouseKpis.paymentConversion} {...trendProps(warehouseTrends?.paymentConversion)} />
        <div className="col-span-full sm:col-span-2 lg:col-span-1">
          <FunnelMini
            stages={[
              { label: "访客", value: warehouseValues?.visitors || 0, display: warehouseKpis.visitors.value },
              { label: "加购", value: warehouseValues?.addToCart || 0, display: warehouseValues ? count(warehouseValues.addToCart) : "—" },
              { label: "成交", value: warehouseValues?.payBuyers || 0, display: warehouseKpis.orders.value },
            ]}
          />
        </div>
      </KpiSection>

      {/* 客户价值（无 L2 标签） */}
      <KpiSection layerCode="L2" title="客户价值" subtitle="客单件单与加购行为" tone="purple" showLayerLabel={false}>
        <KpiCardLarge metric={warehouseKpis.clientAvgPrice} {...trendProps(warehouseTrends?.clientAvgPrice)} />
        <KpiCardLarge metric={warehouseKpis.itemAvgPrice} {...trendProps(warehouseTrends?.itemAvgPrice)} />
        {addToCartMetric && <KpiCardLarge metric={addToCartMetric} {...trendProps(reporting?.metricTrends?.addToCart)} />}
        <KpiCardLarge metric={warehouseKpis.addToCartRate} {...trendProps(warehouseTrends?.addToCartRate)} />
      </KpiSection>

      {/* 投放成本（无 L3 标签） */}
      <KpiSection layerCode="L3" title="投放成本" subtitle="站内费用与投产比" tone="orange" showLayerLabel={false}>
        {spendMetric && <KpiCardLarge metric={spendMetric} {...trendProps(reporting?.metricTrends?.spend)} />}
        {feeRateMetric && <KpiCardLarge metric={feeRateMetric} {...trendProps(reporting?.metricTrends?.feeRate)} />}
        <KpiCardLarge metric={warehouseKpis.promotionFeeRate} />
      </KpiSection>

      {/* 风险预警（无 L5 标签） */}
      <KpiSection layerCode="L5" title="风险预警" subtitle="退款金额、退款率及高风险店铺" tone="red" showLayerLabel={false}>
        {refundMetric && (
          <RiskAlertCard
            metric={refundMetric}
            threshold="占 GMV 超 40% 触发红色"
          />
        )}
        {refundRateMetric && (
          <RiskAlertCard
            metric={refundRateMetric}
            threshold="≥ 40% 高风险"
            alerts={highRiskStores}
          />
        )}
      </KpiSection>

      {/* 平台趋势多图表区域（无 L6 标签） */}
      {reporting?.monthlyOverview && (
        <div className="mb-5 space-y-4">
          {/* 主折线图 */}
          <section className="monthly-overview" data-testid="monthly-overview">
            <div className="monthly-overview-heading">
              <div>
                <span>月度经营概览</span>
                <small>{reporting.monthlyOverview.period.start} 至 {reporting.monthlyOverview.period.end}</small>
              </div>
              <label className="channel-filter">
                <Filter aria-hidden="true" size={13} />
                <span>渠道</span>
                <select
                  aria-label="筛选图表渠道"
                  onChange={(event) => onChannelChange(event.target.value)}
                  value={activeChartChannel}
                >
                  <option value="all">全部渠道</option>
                  {chartChannels.map((channel) => (
                    <option key={channel} value={channel}>{channel}</option>
                  ))}
                </select>
              </label>
            </div>
            <div><MonthlyOverview overview={reporting.monthlyOverview} selectedChannel={activeChartChannel} /></div>
          </section>

          {/* 双图表行：渠道完成率条形图 + 逐月目标达成率 */}
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <ChannelShareChart platforms={platforms} />
            <MonthlyAchievementChart data={reporting.monthlyAchievement ?? []} />
          </div>
        </div>
      )}

      {/* 原渠道经营汇总表改为规模、效率和风险条形图 */}
      <ChannelPerformanceCharts platforms={platforms} />

      <Card title="店铺经营明细" className="mb-5" action={<StatusTag label={`${stores.length} 个店铺`} tone="blue" dot />}>
        <TableShell minWidth={1260}>
          <thead>
            <tr>
              <th>排名</th><th>渠道</th><th>店铺</th><th>GMV</th><th>回款额</th>
              <th>站内费额</th><th>费比</th><th>加购人数</th><th>回款率</th>
              <th>退款金额</th><th>退款率</th><th>小红书推广费</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((item, index) => (
              <tr key={`${item.platform}-${item.store}`}>
                <td>{index + 1}</td>
                <td><PlatformBadge platform={item.platform as Platform} /></td>
                <td className="font-semibold">{item.store}</td>
                <td>{money(item.gmv)}</td>
                <td>{money(item.netRevenue)}</td>
                <td>{money(item.spend)}</td>
                <td className={item.feeRate >= 0.5 ? "font-bold text-[var(--red)]" : ""}>{percent(item.feeRate)}</td>
                <td>{count(item.addToCart)}</td>
                <td>{percent(item.recoveryRate)}</td>
                <td>{money(item.refund)}</td>
                <td>{percent(item.refundRate)}</td>
                <td>{item.offsiteSpend ? money(item.offsiteSpend) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Card>

      <Card title="当前经营提示">
        <div className="insight-grid">
          <div className="insight-row"><span>GMV 贡献最高</span><b>{leadingChannel?.platform ?? "—"} · {percent(leadingChannel?.channelShare)}</b></div>
          <div className="insight-row"><span>退款率最高渠道</span><b className="text-[var(--red)]">{highestRefundChannel?.platform ?? "—"} · {percent(highestRefundChannel?.refundRate)}</b></div>
          <div className="insight-row"><span>费比最高店铺</span><b className="text-[var(--orange)]">{highestFeeStore?.store ?? "—"} · {percent(highestFeeStore?.feeRate)}</b></div>
          <div className="insight-note">缺少数据的日期显示“—”，不使用其他日期补值。</div>
        </div>
      </Card>
    </>
  );
}
