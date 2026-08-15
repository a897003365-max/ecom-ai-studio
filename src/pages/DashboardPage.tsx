import { useEffect, useState } from "react";
import { ArrowRight, BarChart3, Database, RefreshCw, SearchCheck, Target } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { getAnalyticsData } from "../services/localApi";
import type { PageId, QueueTask, ToastMessage } from "../types";
import type { AnalyticsIntegrationPayload, DingTalkMetricTotals } from "../types/integration";

interface DashboardPageProps {
  onNavigate: (id: PageId) => void;
  onAction: (title: string, detail?: string, tone?: ToastMessage["tone"]) => void;
  tasks: QueueTask[];
  canCreateTasks: boolean;
}

const compactNumber = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 });

function money(value: number) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 10_000_000) return `¥${(amount / 1_000_000).toFixed(2)}M`;
  if (Math.abs(amount) >= 10_000) return `¥${(amount / 10_000).toFixed(2)}万`;
  return `¥${amount.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

function percent(value?: number | null, digits = 1) {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function signedPercent(value?: number | null) {
  if (value === null || value === undefined) return "无同口径对比";
  return `环比 ${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function withRates<T extends DingTalkMetricTotals>(metric: T) {
  return {
    ...metric,
    feeRate: metric.feeRate ?? (metric.netRevenue ? metric.spend / metric.netRevenue : 0),
    refundRate: metric.refundRate ?? (metric.gmv ? metric.refund / metric.gmv : 0),
  };
}

function periodText(start?: string | null, end?: string | null) {
  if (!start || !end) return "统计周期待确认";
  return `${start} 至 ${end}`;
}

export function DashboardPage({ onNavigate, onAction, tasks }: DashboardPageProps) {
  const [integration, setIntegration] = useState<AnalyticsIntegrationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadWorkbench(showFeedback = false) {
    setLoading(true);
    setError("");
    try {
      const latest = await getAnalyticsData();
      const completedThrough = latest.dingtalk?.reporting?.completedThrough;
      const monthToDate = completedThrough ? { start: `${completedThrough.slice(0, 7)}-01`, end: completedThrough } : null;
      const payload = monthToDate
        && (latest.dingtalk?.period.start !== monthToDate.start || latest.dingtalk.period.end !== monthToDate.end)
        ? await getAnalyticsData(monthToDate)
        : latest;
      setIntegration(payload);
      if (showFeedback) onAction("刷新完成", "工作台已读取最新经营数据");
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "经营数据读取失败";
      setError(message);
      if (showFeedback) onAction("刷新失败", message, "red");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkbench();
  }, []);

  const dingtalk = integration?.dingtalk;

  if (!dingtalk) {
    return (
      <div className="animate-fade-in-up" data-testid="workbench-home">
        <PageHeader
          actions={<button className="btn" disabled={loading} onClick={() => void loadWorkbench(true)} type="button"><RefreshCw className={loading ? "animate-spin" : ""} size={14} />刷新</button>}
          subtitle="看净回款进度、确认异常、安排核查。"
          title="工作台首页"
        />
        <section className="card flex min-h-64 flex-col items-center justify-center text-center">
          <Database className="mb-3 text-[var(--muted-2)]" size={28} />
          <h2 className="text-[16px] font-bold">{loading ? "正在读取经营数据" : "经营数据暂未读取"}</h2>
          <p className="mt-2 max-w-xl text-[13px] leading-6 text-[var(--muted)]">{error || "工作台只使用钉钉权威结果口径；数据可用后再显示预测和核查建议。"}</p>
        </section>
      </div>
    );
  }

  const totals = withRates(dingtalk.totals);
  const reporting = dingtalk.reporting;
  const monthlyOverview = reporting?.monthlyOverview;
  const monthlyMetrics = monthlyOverview?.metrics;
  const target = monthlyMetrics?.target || totals.target || 0;
  const completionRate = target ? totals.netRevenue / target : (monthlyMetrics?.completionRate ?? totals.completionRate ?? 0);
  const periodStart = dingtalk.period.start;
  const periodEnd = dingtalk.period.end;
  const isMonthToDate = Boolean(periodStart && periodEnd && periodStart.endsWith("-01") && periodStart.slice(0, 7) === periodEnd.slice(0, 7));
  const endDay = Number(periodEnd?.slice(8, 10) || 0);
  const priorYearElapsed = (monthlyOverview?.priorYearDaily ?? [])
    .filter((item) => Number(item.date.slice(8, 10)) <= endDay)
    .reduce((sum, item) => sum + item.netRevenue, 0);
  const priorYearFullMonth = monthlyOverview?.priorYearFullMonthNetRevenue ?? 0;
  const priorYearElapsedShare = priorYearFullMonth > 0 ? priorYearElapsed / priorYearFullMonth : 0;
  const forecast = isMonthToDate && priorYearElapsedShare > 0 ? totals.netRevenue / priorYearElapsedShare : null;
  const forecastRate = forecast !== null && target > 0 ? forecast / target : null;
  const forecastDelta = forecast !== null && target > 0 ? forecast - target : null;
  const currentProgress = Math.min(Math.max(completionRate * 100, 0), 100);
  const forecastProgress = forecastRate === null ? 0 : Math.max(0, Math.min(forecastRate * 100, 100) - currentProgress);
  const forecastGood = forecastDelta !== null && forecastDelta >= 0;
  const forecastLabel = forecast === null ? "预测条件不足" : forecastGood ? "预计可达标" : "预计存在缺口";
  const forecastBasis = forecast === null
    ? "当前周期不是月累计口径，或缺少去年同期完整月数据，因此不生成月末预测。"
    : `预测 = 当前净回款 ÷ 去年同期截至同日的月度占比（${percent(priorYearElapsedShare)}）；只提供点预测。`;

  const ratedPlatforms = dingtalk.platforms.map(withRates);
  const highRefundChannels = ratedPlatforms.filter((item) => item.gmv > 0 && item.refundRate >= 0.4);
  const riskStore = dingtalk.stores
    .map(withRates)
    .filter((item) => item.gmv > 0 && item.refund > 0 && item.refundRate >= 0.4)
    .sort((left, right) => right.refundRate - left.refundRate)[0];

  const warehouseDashboard = integration?.warehouse?.dashboard;
  const processPeriodAligned = Boolean(
    warehouseDashboard?.period?.start
    && warehouseDashboard.period.end
    && warehouseDashboard.period.start === periodStart
    && warehouseDashboard.period.end === periodEnd,
  );
  const processMetrics = warehouseDashboard?.available && processPeriodAligned ? warehouseDashboard.metrics : null;
  const processTrends = warehouseDashboard?.available && processPeriodAligned ? warehouseDashboard.trends : null;
  const processScope = processMetrics
    ? warehouseDashboard?.coverageComplete ? "同周期完整覆盖" : "同周期局部覆盖"
    : warehouseDashboard?.available ? "周期未对齐" : "过程数据未覆盖";

  const resultMetrics = [
    { label: "GMV", value: money(totals.gmv), detail: "全渠道成交", tone: "default" },
    { label: "净回款", value: money(totals.netRevenue), detail: "钉钉权威口径", tone: "good" },
    { label: "退款金额", value: money(totals.refund), detail: `退款率 ${percent(totals.refundRate)}`, tone: "warn" },
    { label: "站内推广费", value: money(totals.spend), detail: `费比 ${percent(totals.feeRate)}`, tone: "default" },
  ] as const;

  const processSignals = [
    {
      label: "退款结构",
      scope: "渠道级覆盖",
      evidence: highRefundChannels.length
        ? highRefundChannels.slice(0, 2).map((item) => `${item.platform} ${percent(item.refundRate)}`).join(" / ")
        : "未发现退款率超过 40% 的渠道",
      value: `${highRefundChannels.length} 个渠道`,
      detail: highRefundChannels.length ? "需下钻核查" : "保持观察",
      alert: highRefundChannels.length > 0,
    },
    {
      label: "支付转化",
      scope: processScope,
      evidence: processMetrics ? `访客 ${compactNumber.format(processMetrics.visitors)}` : "不使用未对齐数据判断",
      value: processMetrics ? percent(processMetrics.paymentConversion, 2) : "—",
      detail: processMetrics ? signedPercent(processTrends?.paymentConversion?.mom) : "待补证据",
      alert: false,
    },
    {
      label: "推广效率",
      scope: processScope,
      evidence: processMetrics ? `推广费 ${money(processMetrics.promotionSpend)}` : "不使用未对齐数据判断",
      value: processMetrics ? `ROI ${processMetrics.promotionRoi.toFixed(2)}` : "—",
      detail: processMetrics ? signedPercent(processTrends?.promotionRoi?.mom) : "待补证据",
      alert: false,
    },
  ];

  const verificationItems = [
    ...(riskStore ? [{
      id: "store-scope",
      title: `核对 ${riskStore.platform} · ${riskStore.store} 统计范围`,
      evidence: `退款率 ${percent(riskStore.refundRate)} · 推广费 ${money(riskStore.spend)} · 净回款 ${money(riskStore.netRevenue)}`,
      roles: "数据运营 + 投放运营",
      completion: "店铺归属、期间与金额口径一致",
      status: "未创建",
    }] : []),
    {
      id: "refund-reason",
      title: "确认退款原因明细能否导出",
      evidence: "当前经营接口未提供退款原因明细",
      roles: "售后运营 + 数据运营",
      completion: "可按日期、店铺、SKU、原因和金额汇总",
      status: "待确认",
    },
  ];

  return (
    <div className="animate-fade-in-up" data-testid="workbench-home">
      <PageHeader
        actions={
          <>
            <button className="btn" disabled={loading} onClick={() => void loadWorkbench(true)} type="button"><RefreshCw className={loading ? "animate-spin" : ""} size={14} />刷新</button>
            <button className="btn-primary" onClick={() => onNavigate("analytics")} type="button"><BarChart3 size={14} />查看经营数据</button>
          </>
        }
        subtitle="看净回款进度、确认异常、安排核查。"
        title="工作台首页"
      />

      {error && <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--red)]/40 bg-[var(--red-bg)] px-4 py-3 text-[12px] text-[var(--red)]">刷新失败，当前继续显示上次成功读取的数据：{error}</div>}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--glass-border-strong)] bg-[var(--glass)] px-3 py-2 text-[11px] text-[var(--muted)]">
        <span><b className="text-[var(--text)]">实时工作台</b> · 只显示当前数据能够支撑的判断</span>
        <span>没有依据的结论不进入首页</span>
      </div>

      <section className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="经营数据范围">
        <div className="card !p-3"><span className="text-[10px] text-[var(--muted-2)]">统计周期</span><b className="mt-1 block text-[12px]">{periodText(periodStart, periodEnd)}</b></div>
        <div className="card !p-3"><span className="text-[10px] text-[var(--muted-2)]">对比口径</span><b className="mt-1 block text-[12px]">去年同期完整日</b></div>
        <div className="card !p-3"><span className="text-[10px] text-[var(--muted-2)]">经营范围</span><b className="mt-1 block text-[12px]">全渠道 · 全店铺</b></div>
        <div className="card !p-3"><span className="text-[10px] text-[var(--muted-2)]">数据状态</span><b className="mt-1 block text-[12px]">{integration?.dataStatus.label} · {integration?.dataStatus.expectedDate}</b></div>
      </section>

      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.75fr)]">
        <article className="relative min-h-[310px] overflow-hidden rounded-[var(--radius-overlay)] border border-[var(--glass-border-strong)] bg-[var(--color-surface-feature)] p-5 shadow-[var(--shadow-card)]" data-testid="workbench-net-revenue-hero">
          <div className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-[var(--brand)] opacity-[0.12] blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-[11px] text-[var(--muted)]">本月累计净回款</div>
              <div className="mt-2 font-display text-[42px] font-bold leading-none tracking-[-0.04em] sm:text-[48px]">{money(totals.netRevenue)}</div>
              <div className="mt-2 text-[12px] text-[var(--muted)]">月目标 {target ? money(target) : "未配置"} · 当前完成 {percent(completionRate)}</div>
            </div>
            <div className="min-w-[260px] rounded-[var(--radius-md)] border border-[var(--glass-border-strong)] bg-[var(--glass)] p-4">
              <div className="text-[10px] text-[var(--muted)]">按去年同期回款节奏预计月末</div>
              <div className="mt-2 font-display text-[25px] font-bold text-[var(--brand)]">{forecast === null ? "—" : `${money(forecast)} · ${percent(forecastRate)}`}</div>
              <div className="mt-3 flex items-center justify-between border-t border-[var(--glass-border)] pt-3 text-[11px] text-[var(--muted)]">
                <span>{forecast === null ? "预测状态" : forecastGood ? "预计高于目标" : "预计低于目标"}</span>
                <b className={forecastGood ? "text-[var(--brand)]" : "text-[var(--orange)]"}>{forecastDelta === null ? "条件不足" : money(Math.abs(forecastDelta))}</b>
              </div>
            </div>
          </div>

          <div className="relative mt-6 h-10 overflow-hidden rounded-[6px] border border-[var(--glass-border-strong)] bg-[var(--bg-elevated)]" aria-label="净回款目标进度">
            <span className="absolute inset-y-0 left-0 bg-[var(--glass-border-strong)]" style={{ width: `${currentProgress}%` }} />
            <span className="absolute inset-y-0 bg-[var(--brand)]/35" style={{ left: `${currentProgress}%`, width: `${forecastProgress}%` }} />
            <span className="absolute inset-y-0 right-0 w-[3px] bg-[var(--brand)]" />
          </div>
          <div className="relative mt-2 flex justify-between text-[10px] text-[var(--muted)]"><span>当前累计 {percent(completionRate)}</span><span>{forecast === null ? "月末预测未生成" : `预计月末 ${percent(forecastRate)}`}</span></div>

          <div className="relative mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-[11px] leading-5 text-[var(--muted)]">{forecastBasis}</p>
            <div className="flex gap-2">
              <button className="btn" onClick={() => onAction("月末预测计算", forecastBasis)} type="button">查看计算</button>
              <button className="btn-primary" onClick={() => onNavigate("analytics")} type="button">查看净回款详情 <ArrowRight size={13} /></button>
            </div>
          </div>
        </article>

        <article className="card flex min-h-[310px] flex-col !p-5">
          <div className="flex items-center justify-between gap-3">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${forecastGood ? "border-[var(--green)]/50 bg-[var(--green-bg)] text-[var(--green)]" : "border-[var(--orange)]/50 bg-[var(--orange-bg)] text-[var(--orange)]"}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{forecastLabel}</span>
            <button className="text-[11px] font-bold text-[var(--brand)]" onClick={() => onNavigate("analytics")} type="button">查看经营结构 →</button>
          </div>
          <h2 className="mt-5 text-[22px] font-bold tracking-[-0.02em]">{forecastGood ? "当前不直接调整流程" : "先核查异常，再决定调整"}</h2>
          <p className="mt-2 text-[12px] leading-5 text-[var(--muted)]">转化和投放只在周期对齐时参与判断；局部异常先核查口径，不直接生成流程调整建议。</p>

          <div className="mt-4 border-l-4 border-[var(--orange)] bg-[var(--orange-bg)] p-4">
            <b className="block text-[16px]">{riskStore ? `${riskStore.platform} · ${riskStore.store} 数据需核查` : "当前没有高退款店铺信号"}</b>
            <span className="mt-2 block text-[11px] leading-5 text-[var(--muted)]">{riskStore ? `退款率 ${percent(riskStore.refundRate)}，推广费 ${money(riskStore.spend)}，净回款 ${money(riskStore.netRevenue)}。先确认店铺归属和费用、退款口径。` : "现有店铺数据未发现退款率超过 40% 且有退款金额的记录。"}</span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-[6px] border border-[var(--glass-border)] bg-[var(--bg-elevated)] p-3"><b className="block text-[13px]">{highRefundChannels.length} 个渠道</b><span className="mt-1 block text-[10px] text-[var(--muted)]">退款率超过 40%</span></div>
            <div className="rounded-[6px] border border-[var(--glass-border)] bg-[var(--bg-elevated)] p-3"><b className="block text-[13px]">{integration?.dataStatus.tone === "green" ? "T-1 完整" : "数据待补"}</b><span className="mt-1 block text-[10px] text-[var(--muted)]">{integration?.dataStatus.expectedDate}</span></div>
          </div>
        </article>
      </section>

      <div className="mb-3 flex items-center gap-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--brand)] text-[10px] font-bold text-[var(--on-brand)]">1</span><h2 className="text-[15px] font-bold">经营结果与过程信号</h2><span className="ml-auto text-[10px] text-[var(--muted-2)]">结果并列展示，不把反算残差当成原因</span></div>
      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(390px,.9fr)]" data-testid="workbench-result-signals">
        <article className="card">
          <div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="text-[14px] font-bold">本月经营结果</h3><p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">退款和推广费需要继续下钻，但不能直接等同于销售缺口原因。</p></div><button className="text-[11px] font-bold text-[var(--brand)]" onClick={() => onNavigate("analytics")} type="button">查看口径</button></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {resultMetrics.map((item) => (
              <div className={`rounded-[var(--radius-md)] border p-3 ${item.tone === "good" ? "border-[var(--green)]/35 bg-[var(--green-bg)]" : item.tone === "warn" ? "border-[var(--orange)]/35 bg-[var(--orange-bg)]" : "border-[var(--glass-border)] bg-white/[0.025]"}`} key={item.label}>
                <span className="text-[10px] text-[var(--muted)]">{item.label}</span><b className="mt-2 block font-display text-[20px]">{item.value}</b><span className="mt-1 block text-[10px] text-[var(--muted)]">{item.detail}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2"><button className="btn-primary" onClick={() => onNavigate("analytics")} type="button">查看净回款明细</button><button className="btn" onClick={() => onNavigate("analytics")} type="button">按渠道 / 店铺拆解</button></div>
        </article>

        <article className="card">
          <div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="text-[14px] font-bold">有依据的过程信号</h3><p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">同时展示结果、范围和变化，不替代原因判断。</p></div><span className="rounded-full border border-[var(--blue)]/40 bg-[var(--blue-bg)] px-2.5 py-1 text-[10px] font-bold text-[var(--blue)]">3 个信号</span></div>
          <div className="grid gap-2">
            {processSignals.map((signal) => (
              <div className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--glass-border)] bg-white/[0.025] p-3 sm:grid-cols-[95px_minmax(0,1fr)_auto] sm:items-center" key={signal.label}>
                <div><b className="block text-[12px]">{signal.label}</b><span className="mt-1 block text-[10px] text-[var(--muted-2)]">{signal.scope}</span></div>
                <b className="text-[11px] font-semibold text-[var(--muted)]">{signal.evidence}</b>
                <div className="text-left sm:text-right"><strong className={signal.alert ? "text-[var(--orange)]" : "text-[var(--text)]"}>{signal.value}</strong><span className="mt-1 block text-[10px] text-[var(--muted-2)]">{signal.detail}</span></div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <div className="mb-3 flex items-center gap-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--brand)] text-[10px] font-bold text-[var(--on-brand)]">2</span><h2 className="text-[15px] font-bold">现在先核查什么</h2><span className="ml-auto text-[10px] text-[var(--muted-2)]">没有完成核查前，不生成调整建议</span></div>
      <section className="mb-5 grid gap-2" data-testid="workbench-verification-list">
        {verificationItems.map((item) => (
          <article className="card grid gap-3 !p-3 md:grid-cols-[36px_210px_minmax(0,1fr)_190px_auto] md:items-center" key={item.id}>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--orange)] text-[10px] font-bold text-[var(--on-orange)]">核</span>
            <div><b className="block text-[12px]">{item.title}</b><span className="mt-1 block text-[10px] text-[var(--muted-2)]">{item.roles}</span></div>
            <p className="text-[11px] leading-5 text-[var(--muted)]">{item.evidence}</p>
            <div><b className="block text-[11px]">完成条件</b><span className="mt-1 block text-[10px] leading-4 text-[var(--muted-2)]">{item.completion}</span></div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-[var(--orange)]/40 bg-[var(--orange-bg)] px-2 py-1 text-[10px] font-bold text-[var(--orange)]">{item.status}</span>
              <button className="btn" onClick={() => onNavigate("analytics")} type="button">查看数据</button>
            </div>
          </article>
        ))}
        <div className="rounded-[var(--radius-md)] border-l-4 border-[var(--brand)] bg-[var(--brand-dim)] px-4 py-3 text-[11px] text-[var(--muted)]"><b className="text-[var(--text)]">转化与投放当前保持观察：</b>只有同周期过程数据支持恶化判断时，才进入流程调整。</div>
      </section>

      <div className="mb-3 flex items-center gap-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--brand)] text-[10px] font-bold text-[var(--on-brand)]">3</span><h2 className="text-[15px] font-bold">待办状态</h2><span className="ml-auto text-[10px] text-[var(--muted-2)]">真实行动创建后才显示负责人、截止时间和回看</span></div>
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)]" data-testid="workbench-action-state">
        <article className="card overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-[11px]">
              <thead className="border-b border-[var(--glass-border)] text-[10px] text-[var(--muted-2)]"><tr><th className="px-4 py-3">核查事项</th><th className="px-4 py-3">数据依据</th><th className="px-4 py-3">建议协作岗位</th><th className="px-4 py-3">完成条件</th><th className="px-4 py-3">状态</th></tr></thead>
              <tbody>{verificationItems.map((item) => <tr className="border-b border-[var(--glass-border)] last:border-0" key={item.id}><td className="px-4 py-3 font-bold">{item.title}</td><td className="px-4 py-3 text-[var(--muted)]">{item.evidence}</td><td className="px-4 py-3">{item.roles}</td><td className="px-4 py-3 text-[var(--muted)]">{item.completion}</td><td className="px-4 py-3"><span className="rounded-full border border-[var(--orange)]/40 bg-[var(--orange-bg)] px-2 py-1 text-[10px] font-bold text-[var(--orange)]">{item.status}</span></td></tr>)}</tbody>
            </table>
          </div>
        </article>

        <article className="card flex flex-col !p-5">
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-[14px] font-bold">当前未关联经营行动</h3><p className="mt-1 text-[11px] text-[var(--muted)]">核查事项不等同于行动任务。</p></div><span className="rounded-full border border-[var(--glass-border-strong)] px-2 py-1 text-[10px] font-bold">0 个</span></div>
          <div className="my-4 rounded-[var(--radius-md)] border border-[var(--glass-border)] bg-white/[0.025] p-4"><div className="flex items-center gap-2 font-bold"><SearchCheck className="text-[var(--brand)]" size={16} />先完成口径核查</div><p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">确认需要调整后，再补负责人、截止时间、基线、预期结果与回看窗口。</p></div>
          <p className="mb-4 text-[10px] leading-5 text-[var(--muted-2)]">全站任务队列当前有 {tasks.length} 个任务，但尚未与本页经营核查建立关联。</p>
          <button className="btn mt-auto" onClick={() => onNavigate("tasks")} type="button">查看现有任务队列 <ArrowRight size={13} /></button>
        </article>
      </section>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--muted-2)]"><span>钉钉为全渠道经营结果权威口径，PowerBI 仅补充周期对齐的过程数据</span><span className="inline-flex items-center gap-1"><Target size={12} />数据截至 {periodEnd || "待确认"}</span></footer>
    </div>
  );
}
