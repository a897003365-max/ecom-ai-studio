// 商品变化指挥中心 · 月度趋势主图（当期 vs 上期 + 退货率 + 毛利率）
// 左轴=商家实收（万），右轴=百分比刻度（退货率 / 毛利率共用）。
// 悬停改为纵向虚线十字 + 数据标签 tooltip，参考相邻 SpuTrendLineChart 交互。
import { useRef, useState } from "react";
import { money, percent } from "./useProductSummary";
import type { ChartTooltipApi, TipContent } from "./ChartTooltip";
import type { Summary, TrendSeries } from "./useProductSummary";

interface Props {
  trend: TrendSeries;
  summary: Summary;
  currentMonth: string | null;
  previousMonth: string | null;
  tooltip: ChartTooltipApi;
}

const WIDTH = 860;
const HEIGHT = 330;
const PLOT = { left: 54, right: 44, top: 24, bottom: 44 };
const RATE_STEPS = 5;

function buildPath(values: number[], x: (i: number) => number, y: (v: number) => number): string {
  return values.map((value, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`).join(" ");
}

function buildSparsePath(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let path = "";
  let started = false;
  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) {
      started = false;
      return;
    }
    path += `${started ? "L" : "M"} ${x(index).toFixed(2)} ${y(value).toFixed(2)} `;
    started = true;
  });
  return path.trim();
}

export function MonthlyTrendChart({ trend, summary, previousMonth, tooltip }: Props) {
  const { days, prevDays, current, previous, refund, margin } = trend;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (!days.length || !current.length) {
    return (
      <div className="chart-area">
        <div className="trend-svg" style={{ minHeight: 292, display: "grid", placeItems: "center", color: "var(--muted)" }}>
          本期逐日数据不足，暂无趋势图
        </div>
      </div>
    );
  }
  const plotW = WIDTH - PLOT.left - PLOT.right;
  const plotH = HEIGHT - PLOT.top - PLOT.bottom;
  const prevValues = previous.filter((v): v is number => v != null && Number.isFinite(v));
  const max = Math.max(...current, ...prevValues, 1) * 1.18;
  const x = (i: number) => PLOT.left + (i * plotW) / Math.max(current.length - 1, 1);
  const y = (v: number) => PLOT.top + (1 - v / max) * plotH;

  // 次坐标轴（右）：退货率 + 毛利率共用 0~rateCeil 百分比刻度。
  const rateVals = [
    ...refund.filter((v) => Number.isFinite(v) && v > 0),
    ...margin.filter((v): v is number => v != null && Number.isFinite(v) && v > 0),
  ];
  const rateMax = rateVals.length ? Math.max(...rateVals) : 12;
  const rateCeil = Math.max(10, Math.ceil(rateMax / 10) * 10);
  const yRate = (v: number) => PLOT.top + (1 - v / rateCeil) * plotH;

  const currentPath = buildPath(current, x, y);
  const previousPath = buildSparsePath(previous, x, y);
  const refundPath = buildSparsePath(refund, x, yRate);
  const marginPath = buildSparsePath(margin, x, yRate);
  const area = `${currentPath} L ${x(current.length - 1).toFixed(2)} ${PLOT.top + plotH} L ${x(0).toFixed(2)} ${PLOT.top + plotH} Z`;

  const guides = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const yy = PLOT.top + (1 - ratio) * plotH;
    return (
      <g key={ratio}>
        <line className="grid-line" x1={PLOT.left} x2={WIDTH - PLOT.right} y1={yy} y2={yy} />
        <text className="axis-text" x={PLOT.left - 10} y={yy + 4} textAnchor="end">{Math.round((max * ratio) / 10000)}万</text>
      </g>
    );
  });

  const rateGuides = Array.from({ length: RATE_STEPS + 1 }, (_, i) => {
    const v = (rateCeil / RATE_STEPS) * i;
    const yy = yRate(v);
    return <text className="axis-text" key={`r${i}`} x={WIDTH - PLOT.right + 8} y={yy + 4} textAnchor="start">{Math.round(v)}%</text>;
  });

  const ticks = days.map((label, index) => {
    const day = parseInt(label.slice(3, 5), 10);
    if (day === 1 || day % 5 === 0 || index === days.length - 1) {
      return <text className="axis-text" key={index} x={x(index)} y={HEIGHT - 14} textAnchor="middle">{label}</text>;
    }
    return null;
  });

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current || !current.length) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xSvg = ((e.clientX - rect.left) * WIDTH) / rect.width;
    const idx = Math.max(0, Math.min(current.length - 1, Math.round(((xSvg - PLOT.left) / plotW) * Math.max(0, current.length - 1))));
    setHover(idx);
    const value = current[idx];
    const pv = previous[idx];
    const rv = refund[idx];
    const mv = margin[idx];
    const content: TipContent = {
      title: null,
      rows: [
        { label: days[idx], value: `${(value / 10000).toFixed(1)} 万` },
        { label: prevDays[idx] || "上期", value: pv != null ? `${(pv / 10000).toFixed(1)} 万` : "-" },
        { label: "退货率", value: Number.isFinite(rv) ? `${rv.toFixed(1)}%` : "-" },
        { label: "毛利率", value: mv != null ? `${mv.toFixed(1)}%` : "-" },
      ],
    };
    tooltip.show(content, e.clientX, e.clientY);
  }
  function onLeave() {
    setHover(null);
    tooltip.hide();
  }

  const hoverX = hover != null ? x(hover) : null;
  const safeHover = hover ?? -1;
  const pv = previous[safeHover];
  const rv = refund[safeHover];
  const mv = margin[safeHover];

  return (
    <>
      <div className="chart-area">
        <svg
          className="trend-svg"
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="月度趋势对比：当期与上期商家实收、退货率、毛利率"
          onPointerMove={onMove}
          onPointerLeave={onLeave}
        >
          {guides}
          {rateGuides}
          {ticks}
          <path className="trend-area" d={area} />
          {previousPath && <path className="line-previous" d={previousPath} pathLength={1} />}
          <path className="line-current" d={currentPath} pathLength={1} />
          {refundPath && <path className="line-refund" d={refundPath} pathLength={1} />}
          {marginPath && <path className="line-margin" d={marginPath} pathLength={1} />}
          {hoverX != null && (
            <line className="trend-crosshair" x1={hoverX.toFixed(2)} x2={hoverX.toFixed(2)} y1={PLOT.top} y2={PLOT.top + plotH} />
          )}
          {hover != null && (
            <>
              <circle className="trend-hit" cx={hoverX!.toFixed(2)} cy={y(current[hover]).toFixed(2)} r={4} />
              {pv != null && Number.isFinite(pv) && (
                <circle className="trend-hit-prev" cx={hoverX!.toFixed(2)} cy={y(pv).toFixed(2)} r={3.5} />
              )}
              {Number.isFinite(rv) && (
                <circle className="trend-hit-refund" cx={hoverX!.toFixed(2)} cy={yRate(rv).toFixed(2)} r={3.5} />
              )}
              {mv != null && Number.isFinite(mv) && (
                <circle className="trend-hit-margin" cx={hoverX!.toFixed(2)} cy={yRate(mv).toFixed(2)} r={3.5} />
              )}
            </>
          )}
        </svg>
      </div>
      <footer className="trend-foot">
        <span>当前商家实收 <b>{money(summary.received)}</b></span>
        <span>{previousMonth ?? "上期"} 同期 <b>{money(summary.prevReceived)}</b></span>
        <span>退货率 <b className={summary.refundRate != null && summary.prevRefundRate != null && summary.refundRate <= summary.prevRefundRate ? "status-good" : "status-risk"}>{percent(summary.refundRate, 2)}</b></span>
        <span>毛利率 <b>{percent(summary.margin, 1)}</b></span>
      </footer>
    </>
  );
}
