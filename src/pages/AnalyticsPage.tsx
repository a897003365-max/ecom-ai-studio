import { useEffect, useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { AnalyticsDateFilter } from "../components/AnalyticsDateFilter";
import { Card } from "../components/Card";
import { ComparisonTicker } from "../components/ComparisonTicker";
import { MetricCard } from "../components/MetricCard";
import { MonthlyOverview } from "../components/MonthlyOverview";
import { PageHeader } from "../components/PageHeader";
import { PlatformBadge } from "../components/PlatformBadge";
import { PowerBiReplica } from "../components/PowerBiReplica";
import { StatusTag } from "../components/StatusTag";
import { TableShell } from "../components/TableShell";
import { getAnalyticsData, syncDataSource } from "../services/localApi";
import type { KpiMetric, Platform, RegenerationSuggestion } from "../types";
import type { AnalyticsIntegrationPayload, DingTalkMetricTotals, DingTalkSnapshot } from "../types/integration";

interface AnalyticsPageProps {
  onAction: (title: string, detail?: string) => void;
  onCreateTask: (suggestion: RegenerationSuggestion) => void;
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

function withBusinessRates<T extends DingTalkMetricTotals>(metric: T): T & Required<Pick<DingTalkMetricTotals, "feeRate" | "recoveryRate" | "refundRate">> {
  return {
    ...metric,
    feeRate: metric.feeRate ?? (metric.netRevenue ? metric.spend / metric.netRevenue : 0),
    recoveryRate: metric.recoveryRate ?? (metric.gmv ? metric.netRevenue / metric.gmv : 0),
    refundRate: metric.refundRate ?? (metric.gmv ? metric.refund / metric.gmv : 0),
  };
}

function liveKpis(snapshot: DingTalkSnapshot): KpiMetric[] {
  const totals = withBusinessRates(snapshot.totals);
  return [
    { label: "GMV", value: money(totals.gmv), detail: "全渠道成交口径", tone: "green" },
    { label: "回款额", value: money(totals.netRevenue), detail: "扣除退款后的经营回款", tone: "blue" },
    { label: "回款率", value: percent(totals.recoveryRate), detail: "回款额 / GMV", tone: "green" },
    { label: "站内费额", value: money(totals.spend), detail: "按全渠道表站内费用口径", tone: "orange" },
    { label: "费比", value: percent(totals.feeRate), detail: "站内费额 / 回款额", tone: "orange" },
    { label: "退款金额", value: money(totals.refund), detail: "成功退款聚合", tone: "pink" },
    { label: "退款率", value: percent(totals.refundRate), detail: "退款金额 / GMV", tone: "red" },
    { label: "加购人数", value: count(totals.addToCart), detail: "含“加购人数 / 日加购”", tone: "purple" },
  ];
}

function dateTime(value?: string | null) {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value)).replaceAll("/", "-");
}

export function AnalyticsPage({ onAction }: AnalyticsPageProps) {
  const [integration, setIntegration] = useState<AnalyticsIntegrationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<"warehouse" | "feishu" | "dingtalk" | null>(null);
  const [error, setError] = useState("");
  const [selectedChannel, setSelectedChannel] = useState("all");

  async function loadAnalytics(period?: { start: string; end: string }) {
    setLoading(true);
    setError("");
    try {
      setIntegration(await getAnalyticsData(period));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "经营数据读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAnalytics();
  }, []);

  const dingtalk = integration?.dingtalk ?? null;
  const reporting = dingtalk?.reporting;
  const metrics = dingtalk ? liveKpis(dingtalk) : [];
  const platforms = useMemo(() => (dingtalk?.platforms ?? []).map(withBusinessRates), [dingtalk]);
  const stores = useMemo(() => (dingtalk?.stores ?? []).map(withBusinessRates), [dingtalk]);
  const latestSync = integration?.history.find((item) => item.sourceId === "dingtalk" && item.status === "success")?.finishedAt
    ?? dingtalk?.refreshedAt;
  const chartChannels = useMemo(
    () => reporting?.monthlyOverview?.daily[0]?.channels.map((item) => item.platform) ?? [],
    [reporting?.monthlyOverview],
  );
  const activeChartChannel = selectedChannel === "all" || chartChannels.includes(selectedChannel) ? selectedChannel : "all";

  const highestRefund = [...platforms].sort((left, right) => right.refundRate - left.refundRate)[0];
  const highestFeeStore = [...stores].sort((left, right) => right.feeRate - left.feeRate)[0];
  const leadingChannel = [...platforms].sort((left, right) => (right.channelShare || 0) - (left.channelShare || 0))[0];

  async function sync(source: "warehouse" | "feishu" | "dingtalk") {
    setSyncing(source);
    onAction("开始同步", source === "dingtalk" ? "正在读取钉钉经营表并重建按日渠道、店铺聚合" : "正在更新本地数据源");
    try {
      await syncDataSource(source);
      const currentPeriod = dingtalk?.period.start && dingtalk.period.end ? { start: dingtalk.period.start, end: dingtalk.period.end } : undefined;
      await loadAnalytics(source === "dingtalk" ? undefined : currentPeriod);
      onAction("同步完成", source === "dingtalk" ? "钉钉经营口径与日期范围已更新" : "本地数据源已更新");
    } catch (syncError) {
      onAction("同步失败", syncError instanceof Error ? syncError.message : "本地数据源不可用");
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="运营数据看板"
        subtitle={`每日同步计划 ${dingtalk?.schedule?.join(" / ") || "10:00 / 12:30 / 17:30"} · 最近同步 ${dateTime(latestSync)}`}
        actions={
          <>
            <button className="btn" disabled={syncing !== null} onClick={() => void sync("dingtalk")} type="button">
              {syncing === "dingtalk" ? "同步中..." : "同步钉钉"}
            </button>
            {dingtalk && reporting && (
              <AnalyticsDateFilter
                available={reporting.availablePeriod}
                completedThrough={reporting.completedThrough}
                loading={loading}
                onApply={loadAnalytics}
                period={dingtalk.period as { start: string; end: string }}
              />
            )}
          </>
        }
      />

      {error && <div className="mb-4 rounded-md border border-[var(--red)]/40 bg-[var(--red-bg)] px-3 py-2 text-xs text-[var(--red)]">{error}</div>}

      {loading && !dingtalk ? (
        <Card><div className="py-16 text-center text-sm text-[var(--muted)]">正在读取钉钉经营数据...</div></Card>
      ) : dingtalk ? (
        <PowerBiReplica dingtalk={dingtalk} warehouse={integration?.warehouse ?? null} overview={<>
          {reporting?.latestComparison && (
            <div className="mb-5" data-testid="comparison-ticker"><ComparisonTicker comparison={reporting.latestComparison} /></div>
          )}

          {reporting?.monthlyOverview && (
            <section className="monthly-overview mb-5" data-testid="monthly-overview">
              <div className="monthly-overview-heading">
                <div><span>月度经营概览</span><small>{reporting.monthlyOverview.period.start} 至 {reporting.monthlyOverview.period.end}</small></div>
                <label className="channel-filter">
                  <Filter aria-hidden="true" size={13} />
                  <span>渠道</span>
                  <select aria-label="筛选图表渠道" onChange={(event) => setSelectedChannel(event.target.value)} value={activeChartChannel}>
                    <option value="all">全部渠道</option>
                    {chartChannels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
                  </select>
                </label>
              </div>
              <div><MonthlyOverview overview={reporting.monthlyOverview} selectedChannel={activeChartChannel} /></div>
            </section>
          )}

          <div className="metric-grid mb-5" data-testid="analytics-kpis">
            {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
          </div>

          <Card title="渠道经营汇总" className="mb-5" action={<StatusTag label={`${platforms.length} 个渠道`} tone="green" dot />}>
            <TableShell minWidth={1120}>
              <thead><tr><th>渠道</th><th>GMV</th><th>回款额</th><th>站内费额</th><th>费比</th><th>加购人数</th><th>回款率</th><th>退款金额</th><th>退款率</th><th>渠道占比</th></tr></thead>
              <tbody>
                {platforms.map((item) => (
                  <tr key={item.platform}>
                    <td><PlatformBadge platform={item.platform as Platform} /></td><td>{money(item.gmv)}</td><td>{money(item.netRevenue)}</td><td>{money(item.spend)}</td>
                    <td>{percent(item.feeRate)}</td><td>{count(item.addToCart)}</td><td>{percent(item.recoveryRate)}</td><td>{money(item.refund)}</td>
                    <td className={item.refundRate >= 0.4 ? "font-bold text-[var(--red)]" : ""}>{percent(item.refundRate)}</td><td>{percent(item.channelShare)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="font-bold"><td>总计</td><td>{money(dingtalk.totals.gmv)}</td><td>{money(dingtalk.totals.netRevenue)}</td><td>{money(dingtalk.totals.spend)}</td><td>{percent(dingtalk.totals.feeRate)}</td><td>{count(dingtalk.totals.addToCart)}</td><td>{percent(dingtalk.totals.recoveryRate)}</td><td>{money(dingtalk.totals.refund)}</td><td>{percent(dingtalk.totals.refundRate)}</td><td>100.00%</td></tr></tfoot>
            </TableShell>
          </Card>

          <Card title="店铺经营明细" className="mb-5" action={<StatusTag label={`${stores.length} 个店铺`} tone="blue" dot />}>
            <TableShell minWidth={1260}>
              <thead><tr><th>排名</th><th>渠道</th><th>店铺</th><th>GMV</th><th>回款额</th><th>站内费额</th><th>费比</th><th>加购人数</th><th>回款率</th><th>退款金额</th><th>退款率</th><th>小红书推广费</th></tr></thead>
              <tbody>
                {stores.map((item, index) => (
                  <tr key={`${item.platform}-${item.store}`}>
                    <td>{index + 1}</td><td><PlatformBadge platform={item.platform as Platform} /></td><td className="font-semibold">{item.store}</td>
                    <td>{money(item.gmv)}</td><td>{money(item.netRevenue)}</td><td>{money(item.spend)}</td><td className={item.feeRate >= 0.5 ? "font-bold text-[var(--red)]" : ""}>{percent(item.feeRate)}</td>
                    <td>{count(item.addToCart)}</td><td>{percent(item.recoveryRate)}</td><td>{money(item.refund)}</td><td>{percent(item.refundRate)}</td><td>{item.offsiteSpend ? money(item.offsiteSpend) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </Card>

          <Card title="当前经营提示">
              <div className="insight-grid">
                <div className="insight-row"><span>回款贡献最高</span><b>{leadingChannel?.platform ?? "—"} · {percent(leadingChannel?.channelShare)}</b></div>
                <div className="insight-row"><span>退款率最高渠道</span><b className="text-[var(--red)]">{highestRefund?.platform ?? "—"} · {percent(highestRefund?.refundRate)}</b></div>
                <div className="insight-row"><span>费比最高店铺</span><b className="text-[var(--orange)]">{highestFeeStore?.store ?? "—"} · {percent(highestFeeStore?.feeRate)}</b></div>
                <div className="insight-note">提示跟随日期筛选；月度概览按筛选结束日所在月计算 MTD，滚动播报固定使用最新完整日期。</div>
              </div>
          </Card>
        </>} />
      ) : (
        <Card><div className="py-16 text-center text-sm text-[var(--muted)]">钉钉经营数据尚未同步，请先点击“同步钉钉”。</div></Card>
      )}
    </div>
  );
}
