import { useEffect, useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { AnalyticsDateFilter } from "../components/AnalyticsDateFilter";
import { AnalyticsLoadingState } from "../components/AnalyticsLoadingState";
import { Card } from "../components/Card";
import { ExecutiveCommerceOverview } from "../components/ExecutiveCommerceOverview";
import { MetricCard } from "../components/MetricCard";
import { MonthlyOverview } from "../components/MonthlyOverview";
import { PageHeader } from "../components/PageHeader";
import { PlatformBadge } from "../components/PlatformBadge";
import { PowerBiReplica } from "../components/PowerBiReplica";
import { StatusTag } from "../components/StatusTag";
import { TableShell } from "../components/TableShell";
import { useAnalyticsViewMode, ViewModeToggle } from "../components/ViewModeToggle";
import { getAnalyticsData, syncAnalyticsData } from "../services/localApi";
import { channelOptions, selectChannelSnapshot } from "../utils/channelSnapshot";
import { useSearchTarget } from "../hooks/useSearchTarget";
import type { KpiMetric, Platform, RegenerationSuggestion } from "../types";
import type { AnalyticsIntegrationPayload, DingTalkMetricTotals, DingTalkSnapshot } from "../types/integration";
import type { SearchTarget } from "../types/search";

interface AnalyticsPageProps {
  onAction: (title: string, detail?: string) => void;
  onCreateTask: (suggestion: RegenerationSuggestion) => void;
  canManage: boolean;
  searchTarget?: SearchTarget | null;
  onSearchConsumed?: () => void;
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

function yoyCell(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-[var(--muted)]">—</span>;
  return (
    <span className={value >= 0 ? "font-bold text-[var(--green)]" : "font-bold text-[var(--red)]"}>
      {value >= 0 ? "+" : ""}{percent(value)}
    </span>
  );
}

function withBusinessRates<T extends DingTalkMetricTotals>(metric: T): T & Required<Pick<DingTalkMetricTotals, "feeRate" | "recoveryRate" | "refundRate">> {
  return {
    ...metric,
    feeRate: metric.feeRate ?? (metric.netRevenue ? metric.spend / metric.netRevenue : 0),
    recoveryRate: metric.recoveryRate ?? (metric.gmv ? metric.netRevenue / metric.gmv : 0),
    refundRate: metric.refundRate ?? (metric.gmv ? metric.refund / metric.gmv : 0),
  };
}

function liveKpis(snapshot: DingTalkSnapshot, channel = "all"): KpiMetric[] {
  const totals = withBusinessRates(snapshot.totals);
  const scope = channel === "all" ? "全渠道" : channel;
  return [
    { label: "GMV", value: money(totals.gmv), detail: `${scope}成交口径`, tone: "green" },
    { label: "回款额", value: money(totals.netRevenue), detail: "扣除退款后的经营回款", tone: "blue" },
    { label: "回款率", value: percent(totals.recoveryRate), detail: "回款额 / GMV", tone: "green" },
    { label: "站内费额", value: money(totals.spend), detail: "按全渠道表站内费用口径", tone: "orange" },
    { label: "费比", value: percent(totals.feeRate), detail: "站内费额 / 回款额", tone: "orange" },
    { label: "推广ROI", value: totals.spend ? totals.roi.toFixed(2) : "-", detail: "GMV / 站内费额", tone: "green" },
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

function isProductPeriodAligned(
  productPeriod: { start: string; end: string } | null | undefined,
  globalPeriod: { start: string; end: string } | null,
) {
  return Boolean(
    productPeriod?.start
    && productPeriod?.end
    && globalPeriod?.start
    && globalPeriod?.end
    && productPeriod.start === globalPeriod.start
    && productPeriod.end === globalPeriod.end,
  );
}

export function AnalyticsPage({ onAction, canManage, searchTarget, onSearchConsumed }: AnalyticsPageProps) {
  const [integration, setIntegration] = useState<AnalyticsIntegrationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<"analytics" | "warehouse" | "feishu" | "dingtalk" | null>(null);
  const [error, setError] = useState("");
  const [selectedChannel, setSelectedChannel] = useState("all");
  const [viewMode, setViewMode] = useAnalyticsViewMode("layered");

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

  // 顶部智能找数：应用日期/渠道筛选并定位到经营区域
  const searchFilters = searchTarget?.page === "analytics" ? searchTarget.filters : undefined;
  const searchRequestId = searchTarget?.requestId;
  useEffect(() => {
    if (searchTarget?.page !== "analytics") return;
    if (searchFilters?.channel) setSelectedChannel(searchFilters.channel);
    if (searchFilters?.start || searchFilters?.end) {
      void loadAnalytics({ start: searchFilters.start!, end: searchFilters.end! });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRequestId]);

  useSearchTarget(
    searchTarget?.page === "analytics" ? searchTarget : null,
    Boolean(integration?.dingtalk),
    () => onSearchConsumed?.(),
    () => onAction("已进入对应数据页", "目标区域暂未加载"),
  );

  const dingtalk = integration?.dingtalk ?? null;
  const reporting = dingtalk?.reporting;
  const globalPeriod = dingtalk?.period.start && dingtalk.period.end
    ? { start: dingtalk.period.start, end: dingtalk.period.end }
    : null;
  const productManagement = integration?.warehouse?.productManagement ?? null;
  const alignedProductManagement = isProductPeriodAligned(productManagement?.period, globalPeriod)
    ? productManagement
    : null;
  const dataStatus = integration?.dataStatus;
  const channelDingtalk = useMemo(
    () => (dingtalk ? selectChannelSnapshot(dingtalk, selectedChannel) : null),
    [dingtalk, selectedChannel],
  );
  const viewDingtalk = channelDingtalk ?? dingtalk;
  const metrics = viewDingtalk ? liveKpis(viewDingtalk, selectedChannel) : [];
  const platforms = useMemo(() => (viewDingtalk?.platforms ?? []).map(withBusinessRates), [viewDingtalk]);
  const stores = useMemo(() => (viewDingtalk?.stores ?? []).map(withBusinessRates), [viewDingtalk]);
  const latestSync = integration?.history.find((item) => item.sourceId === "dingtalk" && item.status === "success")?.finishedAt
    ?? dingtalk?.refreshedAt;
  const chartChannels = useMemo(() => channelOptions(dingtalk), [dingtalk]);
  const activeChartChannel = selectedChannel === "all" || chartChannels.includes(selectedChannel) ? selectedChannel : "all";

  async function syncDashboard() {
    if (!canManage) {
      onAction("当前账号无同步权限", "请联系管理员开通“同步运营数据”权限");
      return;
    }
    setSyncing("analytics");
    onAction("开始同步", "正在同步钉钉经营数据与本地数仓（含 PowerBI 独有模块）");
    try {
      const syncResult = await syncAnalyticsData();
      await loadAnalytics();
      if (syncResult.status === "partial") {
        onAction("同步完成（部分）", `已更新 ${syncResult.runs.map((item) => item.sourceId === "dingtalk" ? "钉钉" : "本地数仓").join("、")}；${syncResult.failures.map((item) => `${item.sourceId === "dingtalk" ? "钉钉" : "本地数仓"}：${item.detail}`).join("；")}`);
      } else if (syncResult.status === "failed") {
        onAction("同步失败", syncResult.failures.map((item) => item.detail).join("；") || "钉钉与本地数仓均未更新");
      } else {
        onAction("同步完成", "钉钉与本地数仓均已更新，PowerBI 独有模块已纳入");
      }
    } catch (syncError) {
      onAction("同步失败", syncError instanceof Error ? syncError.message : "钉钉或本地数仓不可用");
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="全渠道经营总览"
        subtitle={`成交、回款、投放与渠道质量一屏决策 · 最近同步 ${dateTime(latestSync)} · 每日同步计划 ${dingtalk?.schedule?.join(" / ") || "11:00 / 13:00 / 17:30"}`}
        actions={
          <>
            <ViewModeToggle mode={viewMode} onChange={setViewMode} />
            <button className="btn" disabled={syncing !== null || !canManage} onClick={() => void syncDashboard()} title={canManage ? "同步钉钉经营数据与本地数仓" : "当前账号仅可查看，不能同步数据"} type="button">
              {syncing === "analytics" ? "同步中..." : "同步数据"}
            </button>
            {dingtalk && (
              <label className="channel-filter" data-testid="global-channel-filter">
                <Filter aria-hidden="true" size={13} />
                <span>渠道</span>
                <select aria-label="筛选全局渠道" onChange={(event) => setSelectedChannel(event.target.value)} value={activeChartChannel}>
                  <option value="all">全部渠道</option>
                  {chartChannels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
                </select>
              </label>
            )}
            {dingtalk && reporting && (
              <AnalyticsDateFilter
                available={reporting.availablePeriod}
                completedThrough={reporting.completedThrough}
                loading={loading}
                onApply={loadAnalytics}
                period={globalPeriod ?? { start: reporting.availablePeriod.start, end: reporting.completedThrough }}
              />
            )}
            {dataStatus && (
              <span
                aria-label={`${dataStatus.label}，检查日期 ${dataStatus.expectedDate}`}
                className={`dashboard-data-status is-${dataStatus.tone}`}
                data-testid="dashboard-data-status"
                title={dataStatus.missing.length ? dataStatus.missing.join("；") : `所有应更新的 T-1 数据已完成同步（${dataStatus.expectedDate}）`}
              >
                <i aria-hidden="true" />
                {dataStatus.tone === "green" ? "T-1 已更新" : "数据缺失"}
              </span>
            )}
          </>
        }
      />

      {error && <div className="mb-4 rounded-md border border-[var(--red)]/40 bg-[var(--red-bg)] px-3 py-2 text-xs text-[var(--red)]">{error}</div>}

      {loading && !dingtalk ? (
        <AnalyticsLoadingState />
      ) : dingtalk ? (
        <PowerBiReplica period={globalPeriod} searchTarget={searchTarget?.page === "analytics" ? searchTarget : null} warehouse={integration?.warehouse ?? null} overview={
          viewMode === "layered" ? (
            <ExecutiveCommerceOverview
              dingtalk={viewDingtalk!}
              productManagement={alignedProductManagement}
              selectedChannel={activeChartChannel}
            />
          ) : (
            <>
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
                  <div><MonthlyOverview overview={reporting.monthlyOverview} /></div>
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
                  <thead><tr><th>排名</th><th>渠道</th><th>店铺</th><th>GMV</th><th>回款额</th><th>回款额同比</th><th>站内费额</th><th>费比</th><th>加购人数</th><th>回款率</th><th>退款金额</th><th>退款率</th><th>小红书推广费</th></tr></thead>
                  <tbody>
                    {stores.map((item, index) => (
                      <tr key={`${item.platform}-${item.store}`}>
                        <td>{index + 1}</td><td><PlatformBadge platform={item.platform as Platform} /></td><td className="font-semibold">{item.store}</td>
                        <td>{money(item.gmv)}</td><td>{money(item.netRevenue)}</td><td>{yoyCell(item.netRevenueYoy)}</td><td>{money(item.spend)}</td><td className={item.feeRate >= 0.5 ? "font-bold text-[var(--red)]" : ""}>{percent(item.feeRate)}</td>
                        <td>{count(item.addToCart)}</td><td>{percent(item.recoveryRate)}</td><td>{money(item.refund)}</td><td>{percent(item.refundRate)}</td><td>{item.offsiteSpend ? money(item.offsiteSpend) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              </Card>
            </>
          )
        } />
      ) : (
        <Card><div className="py-16 text-center text-sm text-[var(--muted)]">钉钉经营数据尚未同步，请先点击“同步数据”。</div></Card>
      )}
    </div>
  );
}
