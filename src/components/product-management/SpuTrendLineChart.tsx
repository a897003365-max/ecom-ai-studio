import { useMemo } from "react";
import { useTrendInteraction, smoothTrendPath } from "./useTrendInteraction";

export interface SpuTrendSeries { spu: string; productName: string; values: number[]; color: string }
interface Props { series: SpuTrendSeries[]; dates: string[]; emptyHint?: string }
export const SPU_TREND_COLORS = [
  "#12695f", "#356da7", "#8a5a22", "#875f9b", "#177b8b", "#b25f38", "#6a7180",
  "#4f8b72", "#a54d68", "#8a6f2b", "#2f4858", "#c1666b", "#7aa95c", "#5c4d7d",
];

export function SpuTrendLineChart({ series, dates, emptyHint }: Props) {
  const left = 48, right = 20, height = 330, top = 38, base = 290, chartHeight = base - top;
  const { containerRef, svgRef, width, hover, onMove, onPointerDown, onKeyDown, onLeave, onFocus, closeTooltip } = useTrendInteraction(dates.length, left, right);
  const xFor = (index: number) => left + (dates.length <= 1 ? (width - left - right) / 2 : index * (width - left - right) / (dates.length - 1));
  const geometry = useMemo(() => {
    const max = Math.max(1, ...series.flatMap((item) => item.values));
    const x = (index: number) => left + (dates.length <= 1 ? (width - left - right) / 2 : index * (width - left - right) / (dates.length - 1));
    const y = (value: number) => base - value / max * chartHeight;
    const labelCount = Math.max(2, Math.floor((width - left - right) / 66));
    return <>
      <text x={left} y={18} fontSize={12} fill="var(--muted)">单位：件</text>
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <g key={ratio}>
        <line x1={left} y1={base - chartHeight * ratio} x2={width - right} y2={base - chartHeight * ratio} stroke="var(--border)" />
        <text x={left - 6} y={base - chartHeight * ratio + 4} textAnchor="end" fontSize={12} fill="var(--muted)">{Math.round(max * ratio).toLocaleString()}</text>
      </g>)}
      {series.map((item) => {
        const points = dates.map((_, index) => ({ x: x(index), y: y(item.values[index] || 0) }));
        return <g key={item.spu}>
          <path d={smoothTrendPath(points)} fill="none" stroke={item.color} strokeWidth={2.4} strokeLinecap="round" />
          {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={2.8} fill={item.color} />)}
          {series.length === 1 && item.values.map((value, index) => value ? <text key={index} x={x(index)} y={Math.max(30, y(value) - 6)} textAnchor="middle" fontSize={12} fill="var(--text)">{value.toLocaleString()}</text> : null)}
        </g>;
      })}
      {dates.map((date, index) => index === 0 || index === dates.length - 1 || index % Math.ceil(dates.length / labelCount) === 0
        ? <text key={date} x={x(index)} y={base + 22} textAnchor="middle" fontSize={12} fill="var(--muted)">{date.slice(5)}</text> : null)}
    </>;
  }, [series, dates, width]);
  return <div ref={containerRef} className="product-trend-chart" onPointerLeave={onLeave} onKeyDown={(event) => { if (event.key === "Escape") closeTooltip(); }}>
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-[12px]">
      {series.map((item) => <span key={item.spu} className="inline-flex items-center gap-1.5 text-[var(--muted)]"><i style={{ background: item.color, width: 16, height: 3 }} /><span className="text-[var(--text)] font-medium">{item.spu}</span>{item.productName && <span>｜{item.productName}</span>}</span>)}
    </div>
    {!dates.length || !series.length ? <p className="py-8 text-center text-[12px] text-[var(--muted)]">{emptyHint ?? (!series.length ? "请选择 SPU 查看趋势与下方商品表。" : "当前筛选范围没有逐日销量数据，请查看数据覆盖范围。")}</p> : <>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }} onPointerMove={onMove} onPointerDown={onPointerDown} onKeyDown={onKeyDown} onFocus={onFocus} tabIndex={0} role="img" aria-label="SPU 日销量折线趋势。点按日期或用左右方向键逐日查看，Home/End 到首末日。">
        {geometry}
        {hover && <line x1={xFor(hover.index)} y1={top} x2={xFor(hover.index)} y2={base} stroke="var(--muted-2)" strokeDasharray="4 4" />}
      </svg>
      {hover && <div className="product-trend-tooltip" style={{ left: Math.max(8, Math.min(width - 268, hover.x + 12)), top: Math.max(30, hover.y - 120) }} aria-live="polite">
        <div className="product-trend-tooltip-heading">
          <strong>{dates[hover.index]}</strong>
          <button className="product-trend-tooltip-close" type="button" aria-label="关闭趋势提示" onClick={closeTooltip}>关闭</button>
        </div><table><tbody>
          {series.map((item) => <tr key={item.spu}><td><i style={{ background: item.color, display: "inline-block", width: 8, height: 8, marginRight: 4 }} />{item.spu}{item.productName && `｜${item.productName}`}</td><td>{(item.values[hover.index] || 0).toLocaleString()} 件</td></tr>)}
          <tr className="border-t border-[var(--border-2)] font-semibold"><td>当日合计</td><td>{series.reduce((sum, item) => sum + (item.values[hover.index] || 0), 0).toLocaleString()} 件</td></tr>
        </tbody></table>
      </div>}
    </>}
  </div>;
}
