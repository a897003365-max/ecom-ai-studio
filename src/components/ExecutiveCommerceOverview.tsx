import { useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { BarChart3, BadgeDollarSign, CircleGauge, Megaphone, RefreshCcw, Share2, Target } from "lucide-react";
import type { Platform } from "../types";
import type {
  DingTalkMetricTrend,
  DingTalkMetricTotals,
  DingTalkSnapshot,
  ProductManagementPages,
} from "../types/integration";
import { Card } from "./Card";
import { ChannelRevenueChart } from "./ChannelRevenueChart";
import { ComparisonTicker } from "./ComparisonTicker";
import { PlatformBadge } from "./PlatformBadge";

interface ExecutiveCommerceOverviewProps {
  dingtalk: DingTalkSnapshot;
  productManagement: ProductManagementPages | null;
  selectedChannel?: string;
}

interface ExecutiveKpi {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone: "green" | "blue" | "orange" | "red";
  trend?: DingTalkMetricTrend | null;
  inverseTrend?: boolean;
}

const moneyFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat("zh-CN", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const countFormat = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const chartWidth = 920;
const chartHeight = 330;
const chartPlot = { left: 58, right: 18, top: 26, bottom: 42 };

function money(value: number) {
  return `¥${moneyFormat.format((value || 0) / 10_000)}万`;
}

function count(value: number) {
  return countFormat.format(value || 0);
}

function percent(value?: number | null) {
  return percentFormat.format(Number.isFinite(value) ? value || 0 : 0);
}

function yoy(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="exec-yoy is-flat">—</span>;
  return <span className={`exec-yoy ${value >= 0 ? "is-up" : "is-down"}`}>{value >= 0 ? "+" : ""}{percent(value)}</span>;
}

function rate(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}

function withRates<T extends DingTalkMetricTotals>(metric: T): T & {
  feeRate: number;
  recoveryRate: number;
  refundRate: number;
} {
  return {
    ...metric,
    feeRate: metric.feeRate ?? rate(metric.spend, metric.netRevenue),
    recoveryRate: metric.recoveryRate ?? rate(metric.netRevenue, metric.gmv),
    refundRate: metric.refundRate ?? rate(metric.refund, metric.gmv),
  };
}

function shortDate(value: string) {
  return value.slice(5);
}

function axisMaximum(value: number) {
  if (value <= 10_000) return 10_000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const before = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    const control1 = {
      x: current.x + (next.x - before.x) / 6,
      y: current.y + (next.y - before.y) / 6,
    };
    const control2 = {
      x: next.x - (after.x - current.x) / 6,
      y: next.y - (after.y - current.y) / 6,
    };
    path += ` C ${control1.x.toFixed(2)} ${control1.y.toFixed(2)}, ${control2.x.toFixed(2)} ${control2.y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return path;
}

function trendText(trend?: DingTalkMetricTrend | null) {
  if (trend?.yoy === null || trend?.yoy === undefined) return "同比 —";
  return `同比 ${trend.yoy >= 0 ? "+" : ""}${percent(trend.yoy)}`;
}

function ExecutiveKpiCard({ item, index }: { item: ExecutiveKpi; index: number }) {
  const trend = item.trend?.yoy;
  const isGood = trend === null || trend === undefined
    ? null
    : item.inverseTrend
      ? trend <= 0
      : trend >= 0;
  return (
    <article
      className={`exec-kpi is-${item.tone}`}
      style={{ "--exec-delay": `${index * 55}ms` } as CSSProperties}
    >
      <div className="exec-kpi-icon" aria-hidden="true">{item.icon}</div>
      <div className="exec-kpi-copy">
        <span>{item.label}</span>
        <b>{item.value}</b>
        <div>
          <small>{item.detail}</small>
          {item.trend && (
            <em className={isGood === null ? "is-flat" : isGood ? "is-good" : "is-bad"}>
              {trendText(item.trend)}
            </em>
          )}
        </div>
      </div>
    </article>
  );
}

function DailyBusinessTrend({ dingtalk }: { dingtalk: DingTalkSnapshot }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const reporting = dingtalk.reporting?.monthlyOverview;
  const daily = dingtalk.daily;
  const target = reporting?.metrics.target || dingtalk.totals.target || 0;
  const priorYearDaily = reporting?.priorYearDaily ?? [];
  const priorYearFullMonthNetRevenue = reporting?.priorYearFullMonthNetRevenue
    ?? priorYearDaily.reduce((sum, item) => sum + item.netRevenue, 0);
  const priorByDay = useMemo(
    () => new Map(priorYearDaily.map((item) => [item.date.slice(8, 10), item.netRevenue])),
    [priorYearDaily],
  );
  const points = daily.map((item) => {
    const priorDayNetRevenue = Number(priorByDay.get(item.date.slice(8, 10)) || 0);
    const targetReference = priorYearFullMonthNetRevenue
      ? target * priorDayNetRevenue / priorYearFullMonthNetRevenue
      : 0;
    return { ...item, targetReference };
  });
  const hasReference = points.some((item) => item.targetReference > 0);
  const maxValue = axisMaximum(Math.max(
    ...points.flatMap((item) => [item.gmv, item.netRevenue, item.spend, item.targetReference * 1.08]),
    0,
  ));
  const plotWidth = chartWidth - chartPlot.left - chartPlot.right;
  const plotHeight = chartHeight - chartPlot.top - chartPlot.bottom;
  const x = (index: number) => chartPlot.left + (points.length <= 1 ? 0 : index * plotWidth / (points.length - 1));
  const y = (value: number) => chartPlot.top + (1 - value / maxValue) * plotHeight;
  const series = {
    gmv: points.map((item, index) => ({ x: x(index), y: y(item.gmv) })),
    netRevenue: points.map((item, index) => ({ x: x(index), y: y(item.netRevenue) })),
    spend: points.map((item, index) => ({ x: x(index), y: y(item.spend) })),
    target: points.map((item, index) => ({ x: x(index), y: y(item.targetReference) })),
  };
  const netArea = series.netRevenue.length
    ? `${smoothPath(series.netRevenue)} L ${series.netRevenue.at(-1)?.x} ${chartPlot.top + plotHeight} L ${series.netRevenue[0].x} ${chartPlot.top + plotHeight} Z`
    : "";
  const upperBand = points.map((item, index) => `${x(index).toFixed(2)},${y(item.targetReference * 1.08).toFixed(2)}`);
  const lowerBand = [...points].reverse().map((item, reverseIndex) => {
    const index = points.length - reverseIndex - 1;
    return `${x(index).toFixed(2)},${y(item.targetReference * 0.92).toFixed(2)}`;
  });
  const bandPolygon = [...upperBand, ...lowerBand].join(" ");
  const hovered = hoveredIndex === null ? null : points[hoveredIndex];
  const tooltipLeft = hoveredIndex === null || points.length <= 1 ? 50 : x(hoveredIndex) / chartWidth * 100;

  function move(event: ReactPointerEvent<SVGRectElement>) {
    if (!points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const local = Math.max(0, Math.min(plotWidth, (event.clientX - bounds.left) / bounds.width * plotWidth));
    setHoveredIndex(Math.round(local / plotWidth * (points.length - 1)));
  }

  return (
    <section className="exec-panel exec-trend-panel" data-search-anchor="analytics-daily-trend" data-testid="executive-daily-trend">
      <header className="exec-panel-head">
        <div>
          <span className="exec-panel-kicker"><BarChart3 size={14} />经营主趋势</span>
          <h2>日经营趋势</h2>
          <p>目标进度带按去年同期逐日回款分布分摊，不采用平均日目标。</p>
        </div>
        <div className="exec-chart-legend" aria-label="图例">
          <span className="is-gmv"><i />GMV</span>
          <span className="is-net"><i />净回款</span>
          <span className="is-spend"><i />站内推广费</span>
          <span className="is-target"><i />目标进度带（去年同期回款节奏）</span>
        </div>
      </header>

      <div className="exec-chart-wrap">
        <svg aria-label="全渠道日经营趋势图" role="img" viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
          <defs>
            <linearGradient id="execNetArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#49bfe3" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#49bfe3" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="execTargetBand" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#d5e3de" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#d5e3de" stopOpacity="0.035" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const rowY = chartPlot.top + (1 - ratio) * plotHeight;
            return (
              <g key={ratio}>
                <line className="exec-chart-grid" x1={chartPlot.left} x2={chartWidth - chartPlot.right} y1={rowY} y2={rowY} />
                <text className="exec-chart-axis" x={chartPlot.left - 10} y={rowY + 4}>{money(maxValue * ratio)}</text>
              </g>
            );
          })}
          {points.map((item, index) => {
            const stride = Math.max(1, Math.ceil(points.length / 6));
            return index % stride === 0 || index === points.length - 1
              ? <text className="exec-chart-x" key={item.date} x={x(index)} y={chartHeight - 13}>{shortDate(item.date)}</text>
              : null;
          })}
          {hasReference && <polygon className="exec-target-band" fill="url(#execTargetBand)" points={bandPolygon} />}
          {hasReference && <path className="exec-target-line" d={smoothPath(series.target)} fill="none" />}
          <path d={netArea} fill="url(#execNetArea)" />
          <path className="exec-line is-gmv" d={smoothPath(series.gmv)} fill="none" pathLength="1" />
          <path className="exec-line is-net" d={smoothPath(series.netRevenue)} fill="none" pathLength="1" />
          <path className="exec-line is-spend" d={smoothPath(series.spend)} fill="none" pathLength="1" />
          {hoveredIndex !== null && hovered && (
            <g>
              <line className="exec-hover-line" x1={x(hoveredIndex)} x2={x(hoveredIndex)} y1={chartPlot.top} y2={chartPlot.top + plotHeight} />
              <circle cx={x(hoveredIndex)} cy={y(hovered.gmv)} fill="var(--brand)" r="4" stroke="var(--bg)" strokeWidth="2" />
              <circle cx={x(hoveredIndex)} cy={y(hovered.netRevenue)} fill="var(--blue)" r="4" stroke="var(--bg)" strokeWidth="2" />
            </g>
          )}
          <rect fill="transparent" height={plotHeight} onPointerLeave={() => setHoveredIndex(null)} onPointerMove={move} width={plotWidth} x={chartPlot.left} y={chartPlot.top} />
        </svg>
        {hovered && (
          <div className={`exec-chart-tooltip ${tooltipLeft > 67 ? "is-left" : ""}`} style={{ left: `${tooltipLeft}%` }}>
            <b>{hovered.date}</b>
            <span><i className="is-gmv" />GMV <strong>{money(hovered.gmv)}</strong></span>
            <span><i className="is-net" />净回款 <strong>{money(hovered.netRevenue)}</strong></span>
            <span><i className="is-spend" />站内推广费 <strong>{money(hovered.spend)}</strong></span>
            {hasReference && <span><i className="is-target" />同期节奏目标 <strong>{money(hovered.targetReference)}</strong></span>}
          </div>
        )}
      </div>

      <footer className="exec-trend-summary">
        <span>期间 GMV <b>{money(dingtalk.totals.gmv)}</b></span>
        <span>净回款 <b className="is-blue">{money(dingtalk.totals.netRevenue)}</b></span>
        <span>站内推广费 <b className="is-orange">{money(dingtalk.totals.spend)}</b></span>
        <span>目标完成 <b>{percent(reporting?.metrics.completionRate)}</b></span>
        <span>日均 GMV <b>{money(rate(dingtalk.totals.gmv, Math.max(1, points.length)))}</b></span>
        <small>{hasReference ? "参考：去年同期逐日回款分布" : "去年同期逐日回款数据暂不可用"}</small>
      </footer>
    </section>
  );
}

function RevenueQualityBridge({ totals }: { totals: DingTalkMetricTotals }) {
  const metric = withRates(totals);
  const adjustment = metric.gmv - metric.refund - metric.netRevenue;
  const afterRefund = metric.gmv - metric.refund;
  const afterSpend = metric.netRevenue - metric.spend;
  const width = 620;
  const height = 260;
  const baseline = 216;
  const plotTop = 34;
  const barWidth = 58;
  const gap = 43;
  const xPositions = Array.from({ length: 6 }, (_, index) => 16 + index * (barWidth + gap));
  const maxValue = Math.max(metric.gmv, 1);
  const y = (value: number) => baseline - Math.max(0, value) / maxValue * (baseline - plotTop);
  const bars = [
    { label: "GMV", display: money(metric.gmv), start: 0, end: metric.gmv, kind: "positive" },
    { label: "退款金额", display: `-${money(metric.refund)}`, start: metric.gmv, end: afterRefund, kind: "negative" },
    {
      label: "其他调整",
      display: `${adjustment >= 0 ? "-" : "+"}${money(Math.abs(adjustment))}`,
      start: afterRefund,
      end: metric.netRevenue,
      kind: adjustment >= 0 ? "negative" : "positive",
    },
    { label: "净回款", display: money(metric.netRevenue), start: 0, end: metric.netRevenue, kind: "net" },
    { label: "站内推广费", display: `-${money(metric.spend)}`, start: metric.netRevenue, end: afterSpend, kind: "negative" },
    { label: "投放后回款", display: money(afterSpend), start: 0, end: afterSpend, kind: "positive" },
  ] as const;

  return (
    <section className="exec-panel exec-quality-panel" data-search-anchor="analytics-revenue-quality" data-testid="revenue-quality-bridge">
      <header className="exec-panel-head">
        <div>
          <span className="exec-panel-kicker"><BadgeDollarSign size={14} />经营结果拆解</span>
          <h2>回款质量拆解</h2>
          <p>从成交规模到投放后回款，识别退款与费用侵蚀。</p>
        </div>
        <div className="exec-bridge-legend">
          <span><i className="is-positive" />正向</span>
          <span><i className="is-negative" />扣减</span>
          <span><i className="is-net" />净回款</span>
        </div>
      </header>
      <div className="exec-bridge-wrap">
        <svg aria-label="回款质量瀑布图" role="img" viewBox={`0 0 ${width} ${height}`}>
          <line className="exec-bridge-base" x1="8" x2={width - 8} y1={baseline} y2={baseline} />
          {bars.map((bar, index) => {
            const isTotal = index === 0 || index === 3 || index === 5;
            const startY = y(bar.start);
            const endY = y(bar.end);
            const top = isTotal ? endY : Math.min(startY, endY);
            const barHeight = isTotal ? baseline - endY : Math.max(3, Math.abs(startY - endY));
            const connectorLevel = isTotal ? bar.end : bar.end;
            return (
              <g className={`exec-bridge-step is-${bar.kind}`} key={bar.label}>
                {index < bars.length - 1 && (
                  <line
                    className="exec-bridge-connector"
                    x1={xPositions[index] + barWidth}
                    x2={xPositions[index + 1]}
                    y1={y(connectorLevel)}
                    y2={y(connectorLevel)}
                  />
                )}
                <rect height={barHeight} rx="2" width={barWidth} x={xPositions[index]} y={top} />
                <text className="exec-bridge-value" x={xPositions[index] + barWidth / 2} y={Math.max(18, top - 8)}>{bar.display}</text>
                <text className="exec-bridge-label" x={xPositions[index] + barWidth / 2} y={baseline + 22}>{bar.label}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <footer className="exec-quality-summary">
        <div><span>回款率</span><b>{percent(metric.recoveryRate)}</b><small>净回款 ÷ GMV</small></div>
        <div><span>费比</span><b>{percent(metric.feeRate)}</b><small>推广费 ÷ 净回款</small></div>
      </footer>
    </section>
  );
}

function ChannelQualityTable({ platforms }: { platforms: DingTalkSnapshot["platforms"] }) {
  const rows = [...platforms]
    .sort((left, right) => right.gmv - left.gmv)
    .map(withRates);
  const maxGmv = Math.max(...rows.map((item) => item.gmv), 1);
  const totalNetRevenue = rows.reduce((sum, item) => sum + item.netRevenue, 0);
  const summary = rows.reduce((total, item) => ({
    gmv: total.gmv + item.gmv,
    netRevenue: total.netRevenue + item.netRevenue,
    spend: total.spend + item.spend,
    refund: total.refund + item.refund,
  }), { gmv: 0, netRevenue: 0, spend: 0, refund: 0 });

  return (
    <section className="exec-panel exec-channel-panel" data-search-anchor="analytics-channel-quality" data-testid="executive-channel-quality">
      <header className="exec-panel-head">
        <div>
          <span className="exec-panel-kicker"><CircleGauge size={14} />渠道经营</span>
          <h2>渠道贡献与回款质量</h2>
        </div>
        <span className="exec-panel-unit">单位：万元</span>
      </header>
      <div className="exec-channel-table-wrap">
        <table className="exec-channel-table">
          <thead>
            <tr>
              <th>渠道</th><th>GMV</th><th>净回款</th><th>回款率</th><th>推广费</th><th>费比</th><th>退款率</th><th>占比</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const refundPending = item.platform === "京东" && item.gmv > 0 && item.refund === 0;
              return (
                <tr key={item.platform}>
                  <td><PlatformBadge platform={item.platform as Platform} /></td>
                  <td>
                    <span className="exec-table-bar">
                      <i style={{ width: `${item.gmv / maxGmv * 100}%` }} />
                      <b>{money(item.gmv)}</b>
                    </span>
                  </td>
                  <td className="is-net">{money(item.netRevenue)}</td>
                  <td>{percent(item.recoveryRate)}</td>
                  <td>{money(item.spend)}</td>
                  <td className={item.feeRate >= 0.3 ? "is-warning" : ""}>{percent(item.feeRate)}</td>
                  <td className={refundPending || item.refundRate >= 0.4 ? "is-risk" : ""}>
                    {refundPending ? "待核对" : percent(item.refundRate)}
                  </td>
                  <td>{percent(totalNetRevenue ? item.netRevenue / totalNetRevenue : 0)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>{rows.length} 渠道小计</td><td>{money(summary.gmv)}</td>
              <td>{money(summary.netRevenue)}</td>
              <td>{percent(rate(summary.netRevenue, summary.gmv))}</td>
              <td>{money(summary.spend)}</td>
              <td>{percent(rate(summary.spend, summary.netRevenue))}</td>
              <td>{percent(rate(summary.refund, summary.gmv))}</td>
              <td>{percent(1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function StoreQualityTable({ stores, totalsYoy }: { stores: DingTalkSnapshot["stores"]; totalsYoy?: number | null }) {
  const rows = [...stores]
    .sort((left, right) => right.netRevenue - left.netRevenue)
    .map(withRates);
  const maxGmv = Math.max(...rows.map((item) => item.gmv), 1);
  const totalNetRevenue = rows.reduce((sum, item) => sum + item.netRevenue, 0);
  const summary = rows.reduce((total, item) => ({
    gmv: total.gmv + item.gmv,
    netRevenue: total.netRevenue + item.netRevenue,
    spend: total.spend + item.spend,
    refund: total.refund + item.refund,
    offsiteSpend: total.offsiteSpend + Number(item.offsiteSpend || 0),
  }), { gmv: 0, netRevenue: 0, spend: 0, refund: 0, offsiteSpend: 0 });

  return (
    <section className="exec-panel exec-channel-panel" data-search-anchor="analytics-store-quality" data-testid="executive-store-quality">
      <header className="exec-panel-head">
        <div>
          <span className="exec-panel-kicker"><CircleGauge size={14} />店铺经营</span>
          <h2>店铺明细与回款质量</h2>
        </div>
        <span className="exec-panel-unit">单位：万元</span>
      </header>
      <div className="exec-channel-table-wrap">
        <table className="exec-channel-table">
          <thead>
            <tr>
              <th>排名</th><th>渠道</th><th>店铺</th><th>GMV</th><th>净回款</th><th>净回款同比</th><th>回款率</th><th>推广费</th><th>费比</th><th>退款率</th><th>小红书推广费</th><th>占比</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => {
              const refundPending = item.platform === "京东" && item.gmv > 0 && item.refund === 0;
              return (
                <tr key={`${item.platform}-${item.store}`}>
                  <td>{index + 1}</td>
                  <td><PlatformBadge platform={item.platform as Platform} /></td>
                  <td className="font-semibold">{item.store}</td>
                  <td>
                    <span className="exec-table-bar">
                      <i style={{ width: `${item.gmv / maxGmv * 100}%` }} />
                      <b>{money(item.gmv)}</b>
                    </span>
                  </td>
                  <td className="is-net">{money(item.netRevenue)}</td>
                  <td>{yoy(item.netRevenueYoy)}</td>
                  <td>{percent(item.recoveryRate)}</td>
                  <td>{money(item.spend)}</td>
                  <td className={item.feeRate >= 0.3 ? "is-warning" : ""}>{percent(item.feeRate)}</td>
                  <td className={refundPending || item.refundRate >= 0.4 ? "is-risk" : ""}>
                    {refundPending ? "待核对" : percent(item.refundRate)}
                  </td>
                  <td>{item.offsiteSpend ? money(item.offsiteSpend) : "—"}</td>
                  <td>{percent(totalNetRevenue ? item.netRevenue / totalNetRevenue : 0)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>{rows.length} 店铺小计</td>
              <td>{money(summary.gmv)}</td>
              <td>{money(summary.netRevenue)}</td>
              <td>{yoy(totalsYoy)}</td>
              <td>{percent(rate(summary.netRevenue, summary.gmv))}</td>
              <td>{money(summary.spend)}</td>
              <td>{percent(rate(summary.spend, summary.netRevenue))}</td>
              <td>{percent(rate(summary.refund, summary.gmv))}</td>
              <td>{summary.offsiteSpend ? money(summary.offsiteSpend) : "—"}</td>
              <td>{percent(1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function CategoryPerformance({ productManagement }: { productManagement: ProductManagementPages | null }) {
  const rows = [...(productManagement?.mattressCategoryBreakdown ?? [])]
    .sort((left, right) => right.salesAmount - left.salesAmount);
  const maxValue = Math.max(...rows.map((item) => item.salesAmount), 1);
  return (
    <section className="exec-panel exec-category-panel" data-search-anchor="analytics-category-performance" data-testid="executive-category-performance">
      <header className="exec-panel-head">
        <div>
          <span className="exec-panel-kicker"><Target size={14} />商品结构</span>
          <h2>核心品类销售额</h2>
          <p>{productManagement?.period ? `${productManagement.period.start} 至 ${productManagement.period.end}` : "商品经营数据暂未同步"}</p>
        </div>
      </header>
      {rows.length ? (
        <div className="exec-category-list">
          {rows.map((item, index) => (
            <div className="exec-category-row" key={item.category}>
              <span><em>{String(index + 1).padStart(2, "0")}</em>{item.category}</span>
              <div><i style={{ width: `${item.salesAmount / maxValue * 100}%` }} /></div>
              <b>{money(item.salesAmount)}</b>
            </div>
          ))}
        </div>
      ) : <div className="exec-empty">暂无可用的品类销售数据</div>}
    </section>
  );
}

function ChannelSpendEfficiency({ platforms }: { platforms: DingTalkSnapshot["platforms"] }) {
  const rows = [...platforms]
    .sort((left, right) => right.spend - left.spend)
    .map(withRates);
  const maxSpend = Math.max(...rows.map((item) => item.spend), 1);
  const maxFeeRate = Math.max(...rows.map((item) => item.feeRate), 0.01);
  return (
    <section className="exec-panel exec-spend-panel" data-search-anchor="analytics-channel-spend" data-testid="executive-channel-spend">
      <header className="exec-panel-head">
        <div>
          <span className="exec-panel-kicker"><Megaphone size={14} />投放效率</span>
          <h2>渠道推广费与费比</h2>
          <p>推广费额 · 费比（推广费 ÷ 净回款）</p>
        </div>
        <div className="exec-spend-legend"><span><i />推广费</span><span><i />费比</span></div>
      </header>
      <div className="exec-spend-list">
        {rows.map((item) => (
          <div className="exec-spend-row" key={item.platform}>
            <PlatformBadge platform={item.platform as Platform} />
            <div className="exec-spend-bars">
              <span title={`${item.platform}推广费 ${money(item.spend)}`}><i style={{ width: `${item.spend / maxSpend * 100}%` }} /><b>{money(item.spend)}</b></span>
              <span title={`${item.platform}费比 ${percent(item.feeRate)}`}><i style={{ width: `${item.feeRate / maxFeeRate * 100}%` }} /><b>{percent(item.feeRate)}</b></span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PromotionFunnelPanel({ totals, scope }: { totals: DingTalkMetricTotals; scope: string }) {
  const metric = withRates(totals);
  const stages = [
    { label: "曝光", value: metric.exposure, rate: null as number | null },
    { label: "点击", value: metric.clicks, rate: metric.exposure ? metric.clicks / metric.exposure : null },
    { label: "加购", value: metric.addToCart, rate: metric.clicks ? metric.addToCart / metric.clicks : null },
    { label: "成交订单", value: metric.paidOrders, rate: metric.addToCart ? metric.paidOrders / metric.addToCart : null },
  ];
  const maxValue = Math.max(...stages.map((stage) => stage.value), 1);
  return (
    <section className="exec-panel exec-funnel-panel" data-search-anchor="analytics-funnel" data-testid="promotion-funnel">
      <header className="exec-panel-head">
        <div>
          <span className="exec-panel-kicker"><Megaphone size={14} />推广漏斗</span>
          <h2>曝光 → 点击 → 加购 → 成交</h2>
          <p>{scope}推广过程指标，按钉钉每日明细聚合；选渠道后随渠道切换。</p>
        </div>
        <span className="exec-panel-unit">曝光点击率 <b>{percent(metric.ctr)}</b></span>
      </header>
      <div className="exec-funnel-list">
        {stages.map((stage, index) => (
          <div className="exec-funnel-row" key={stage.label}>
            <span><em>{String(index + 1).padStart(2, "0")}</em>{stage.label}</span>
            <div><i style={{ width: `${(stage.value / maxValue) * 100}%` }} /></div>
            <b>{stage.value > 0 ? count(stage.value) : "-"}</b>
            <small>{stage.rate === null ? "起点" : `转化 ${percent(stage.rate)}`}</small>
          </div>
        ))}
      </div>
      {metric.paidOrders === 0 && (
        <footer className="exec-quality-summary"><small>成交订单数暂无明细，末端以加购为参考；成交金额见 GMV 卡。</small></footer>
      )}
    </section>
  );
}

function dateSequence(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function buildChannelDailyTrend(
  dailyPlatforms: Array<{ date: string; platform: string; netRevenue: number }> | undefined,
  fallbackDaily: Array<{ date: string; totalNetRevenue: number; channels: Array<{ platform: string; netRevenue: number }> }> | undefined,
  period: { start: string | null; end: string | null } | undefined,
) {
  const start = period?.start;
  const end = period?.end;
  if (!dailyPlatforms || !start || !end) return fallbackDaily ?? [];

  const platformMap = new Map<string, Map<string, number>>();
  const totalMap = new Map<string, number>();
  for (const row of dailyPlatforms) {
    if (row.date < start || row.date > end) continue;
    const channels = platformMap.get(row.date) ?? new Map<string, number>();
    channels.set(row.platform, (channels.get(row.platform) || 0) + row.netRevenue);
    platformMap.set(row.date, channels);
    totalMap.set(row.date, (totalMap.get(row.date) || 0) + row.netRevenue);
  }

  return dateSequence(start, end).map((date) => {
    const channels = platformMap.get(date);
    return {
      date,
      totalNetRevenue: totalMap.get(date) || 0,
      channels: channels
        ? [...channels.entries()].map(([platform, netRevenue]) => ({ platform, netRevenue }))
        : [],
    };
  });
}

export function ExecutiveCommerceOverview({ dingtalk, productManagement, selectedChannel }: ExecutiveCommerceOverviewProps) {
  const totals = withRates(dingtalk.totals);
  const reporting = dingtalk.reporting;
  const monthly = reporting?.monthlyOverview?.metrics;
  const targetGap = Math.max(0, (monthly?.target || totals.target || 0) - (monthly?.netRevenue || totals.netRevenue));
  const scope = selectedChannel && selectedChannel !== "all" ? `${selectedChannel}` : "全渠道";
  // 小红书推广费（站外）由服务端归入天猫麻大师旗舰店行，随渠道筛选联动
  const offsiteSpend = dingtalk.stores.reduce((sum, item) => sum + Number(item.offsiteSpend || 0), 0);
  const offsiteFeeRate = rate(offsiteSpend, totals.netRevenue);
  // 渠道每日回款折线图按时间筛选器所选起止日期联动，不再固定从 1 号开始
  const channelDailyTrend = useMemo(
    () => buildChannelDailyTrend(
      reporting?.dailyPlatforms?.map((row) => ({ date: row.date, platform: row.platform, netRevenue: row.netRevenue })),
      reporting?.monthlyOverview?.daily,
      dingtalk.period,
    ),
    [reporting?.dailyPlatforms, reporting?.monthlyOverview?.daily, dingtalk.period],
  );
  const kpis: ExecutiveKpi[] = [
    {
      label: "净回款",
      value: money(totals.netRevenue),
      detail: "扣除退款后的经营回款",
      icon: <BadgeDollarSign size={21} />,
      tone: "blue",
      trend: reporting?.metricTrends?.netRevenue,
    },
    {
      label: "月目标完成",
      value: percent(monthly?.completionRate ?? totals.completionRate),
      detail: `距目标 ${money(targetGap)}`,
      icon: <Target size={21} />,
      tone: "green",
    },
    {
      label: "站内推广费",
      value: money(totals.spend),
      detail: "筛选期站内投放",
      icon: <Megaphone size={21} />,
      tone: "green",
      trend: reporting?.metricTrends?.spend,
      inverseTrend: true,
    },
    {
      label: "站内推广费比",
      value: percent(totals.feeRate),
      detail: "推广费 ÷ 净回款",
      icon: <CircleGauge size={21} />,
      tone: "orange",
      trend: reporting?.metricTrends?.feeRate,
      inverseTrend: true,
    },
    {
      label: "退款率",
      value: percent(totals.refundRate),
      detail: `${money(totals.refund)} 退款金额`,
      icon: <RefreshCcw size={21} />,
      tone: "red",
      trend: reporting?.metricTrends?.refundRate,
      inverseTrend: true,
    },
    {
      label: "小红书推广费",
      value: money(offsiteSpend),
      detail: "筛选期小红书站外投放",
      icon: <Share2 size={21} />,
      tone: "green",
    },
    {
      label: "小红书推广费比",
      value: percent(offsiteFeeRate),
      detail: "小红书推广费 ÷ 净回款",
      icon: <CircleGauge size={21} />,
      tone: "orange",
    },
  ];

  const latestComparison = reporting?.latestComparison;
  const ratedPlatforms = dingtalk.platforms.map(withRates);
  const ratedStores = dingtalk.stores.map(withRates);
  const highestRefund = ratedPlatforms.length ? [...ratedPlatforms].sort((left, right) => right.refundRate - left.refundRate)[0] : undefined;
  const highestFeeStore = ratedStores.length ? [...ratedStores].sort((left, right) => right.feeRate - left.feeRate)[0] : undefined;
  const leadingChannel = ratedPlatforms.length ? [...ratedPlatforms].sort((left, right) => (right.channelShare || 0) - (left.channelShare || 0))[0] : undefined;

  return (
    <div className="executive-overview" data-search-anchor="analytics-top" data-testid="executive-commerce-overview">
      <div className="exec-kpi-grid">
        {kpis.map((item, index) => <ExecutiveKpiCard index={index} item={item} key={item.label} />)}
      </div>

      <div className="exec-main-grid">
        <DailyBusinessTrend dingtalk={dingtalk} />
        <RevenueQualityBridge totals={dingtalk.totals} />
      </div>

      {latestComparison && (
        <ComparisonTicker comparison={latestComparison} />
      )}

      {channelDailyTrend.length > 0 && (
        <div className="exec-mid-grid">
          <section className="exec-panel exec-channel-trend-panel" data-testid="executive-channel-trend">
            <ChannelRevenueChart daily={channelDailyTrend} selectedChannel={selectedChannel ?? "all"} />
          </section>
          <CategoryPerformance productManagement={productManagement} />
          <PromotionFunnelPanel totals={dingtalk.totals} scope={scope} />
        </div>
      )}

      <Card title="当前经营提示">
        <div className="insight-grid">
          <div className="insight-row"><span>回款贡献最高</span><b>{leadingChannel?.platform ?? "-"} · {percent(leadingChannel?.channelShare)}</b></div>
          <div className="insight-row"><span>退款率最高渠道</span><b className="text-[var(--red)]">{highestRefund?.platform ?? "-"} · {percent(highestRefund?.refundRate)}</b></div>
          <div className="insight-row"><span>费比最高店铺</span><b className="text-[var(--orange)]">{highestFeeStore?.store ?? "-"} · {percent(highestFeeStore?.feeRate)}</b></div>
          <div className="insight-note">月度概览按所选结束日累计；最新播报使用最近完整日期。</div>
        </div>
      </Card>

      <div className="exec-bottom-grid">
        <ChannelQualityTable platforms={dingtalk.platforms} />
        <ChannelSpendEfficiency platforms={dingtalk.platforms} />
      </div>
      <StoreQualityTable stores={dingtalk.stores} totalsYoy={reporting?.metricTrends?.netRevenue?.yoy} />
    </div>
  );
}
