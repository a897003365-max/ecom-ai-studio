import { useMemo } from "react";
import { useTrendInteraction, smoothTrendPath } from "./useTrendInteraction";

interface DailyPoint { date: string; receivedAmount: number; refundAmount: number; refundRate: number }
interface Props { data: DailyPoint[] }
const MONEY_COLOR = "#12695f", REFUND_COLOR = "#b43c45", RATE_COLOR = "#c86628";
const SERIES = [
  { key: "receivedAmount", name: "商家实收", color: MONEY_COLOR, dash: undefined },
  { key: "refundAmount", name: "退货金额", color: REFUND_COLOR, dash: "6 3" },
  { key: "refundRate", name: "退款金额占比", color: RATE_COLOR, dash: "3 3" },
] as const;

/** Amount and rate axes retain their units at every container width. */
export function DailyTrendChart({ data }: Props) {
  const left = 68, right = 50, height = 330, top = 38, base = 290, chartHeight = base - top;
  const { containerRef, svgRef, width, hover, onMove, onPointerDown, onKeyDown, onLeave, onFocus, closeTooltip } = useTrendInteraction(data.length, left, right);
  const xFor = (index: number) => left + (data.length <= 1 ? (width - left - right) / 2 : index * (width - left - right) / (data.length - 1));
  // Hover only changes the tooltip and guide; grids, coordinates and paths remain cached.
  const geometry = useMemo(() => {
    const maxMoney = Math.max(1, ...data.flatMap((row) => [row.receivedAmount, row.refundAmount]));
    const maxRate = Math.max(0.01, ...data.map((row) => row.refundRate));
    const x = (index: number) => left + (data.length <= 1 ? (width - left - right) / 2 : index * (width - left - right) / (data.length - 1));
    const labelCount = Math.max(2, Math.floor((width - left - right) / 66));
    return <>
      <text x={left} y={18} fontSize={12} fill="var(--muted)">金额（元）</text>
      <text x={width - right} y={18} fontSize={12} textAnchor="end" fill="var(--muted)">退款占比（%）</text>
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <g key={ratio}>
        <line x1={left} y1={base - chartHeight * ratio} x2={width - right} y2={base - chartHeight * ratio} stroke="var(--border)" />
        <text x={left - 6} y={base - chartHeight * ratio + 4} textAnchor="end" fontSize={12} fill="var(--muted)">{maxMoney * ratio >= 10000 ? `¥${(maxMoney * ratio / 10000).toFixed(1)}万` : `¥${Math.round(maxMoney * ratio).toLocaleString()}`}</text>
      </g>)}
      {[0, 0.5, 1].map((ratio) => <text key={ratio} x={width - right + 5} y={base - chartHeight * ratio + 4} fontSize={12} fill="var(--muted)">{(maxRate * ratio * 100).toFixed(1)}%</text>)}
      {SERIES.map((series) => {
        const max = series.key === "refundRate" ? maxRate : maxMoney;
        const points = data.map((row, index) => ({ x: x(index), y: base - row[series.key] / max * chartHeight }));
        return <g key={series.key}>
          <path d={smoothTrendPath(points)} fill="none" stroke={series.color} strokeWidth={2.2} strokeDasharray={series.dash} strokeLinecap="round" />
          {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={2.4} fill={series.color} />)}
        </g>;
      })}
      {data.map((row, index) => index === 0 || index === data.length - 1 || index % Math.ceil(data.length / labelCount) === 0
        ? <text key={row.date} x={x(index)} y={base + 22} textAnchor="middle" fontSize={12} fill="var(--muted)">{row.date.slice(5)}</text> : null)}
    </>;
  }, [data, width]);
  const selected = hover ? data[hover.index] : null;
  return <div ref={containerRef} className="product-trend-chart" onPointerLeave={onLeave} onKeyDown={(event) => { if (event.key === "Escape") closeTooltip(); }}>
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-[12px]">
      {SERIES.map((series) => <span key={series.key} className="inline-flex items-center gap-1.5 text-[var(--muted)]"><i style={{ background: series.color, width: 16, height: 3 }} />{series.name}</span>)}
    </div>
    {!data.length ? <p className="py-8 text-center text-[12px] text-[var(--muted)]">当前筛选范围没有逐日趋势数据，请查看数据覆盖范围。</p> : <>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }} onPointerMove={onMove} onPointerDown={onPointerDown} onKeyDown={onKeyDown} onFocus={onFocus} tabIndex={0} role="img" aria-label="每日商家实收、退货金额与退款占比。点按日期或用左右方向键逐日查看，Home/End 到首末日。">
        {geometry}
        {hover && <line x1={xFor(hover.index)} y1={top} x2={xFor(hover.index)} y2={base} stroke="var(--muted-2)" strokeDasharray="4 4" />}
      </svg>
      {hover && selected && <div className="product-trend-tooltip" style={{ left: Math.max(8, Math.min(width - 268, hover.x + 12)), top: Math.max(30, hover.y - 110) }} aria-live="polite">
        <div className="product-trend-tooltip-heading">
          <strong>{selected.date}</strong>
          <button className="product-trend-tooltip-close" type="button" aria-label="关闭趋势提示" onClick={closeTooltip}>关闭</button>
        </div><table><tbody>
          {SERIES.map((series) => <tr key={series.key}><td>{series.name}</td><td>{series.key === "refundRate" ? `${(selected[series.key] * 100).toFixed(2)}%` : `¥${selected[series.key].toLocaleString()}`}</td></tr>)}
        </tbody></table>
      </div>}
    </>}
  </div>;
}
