import { useRef, useState } from "react";

export interface SpuTrendSeries {
  spu: string;
  productName: string;
  values: number[]; // 每日销量，索引对齐 dates
  color: string;
}

interface Props {
  series: SpuTrendSeries[];
  dates: string[];
}

export const SPU_TREND_COLORS = [
  "#12695f", "#356da7", "#8a5a22", "#875f9b", "#177b8b",
  "#b25f38", "#6a7180", "#4f8b72", "#a54d68", "#8a6f2b",
];

/** SPU 日销量多折线趋势图，移植自参考看板 salesLineChart。
 * R1 单选标注、R2 tooltip 跟随+合计、R4 图例线段、R5 变量替换、R8 深色适配。 */
export function SpuTrendLineChart({ series, dates }: Props) {
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 1160, height = 330, left = 48, right = 18, top = 42, base = 270, chartHeight = 190;
  const days = dates.length;
  const chartWidth = width - left - right;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const xFor = (i: number) => left + (days <= 1 ? chartWidth / 2 : (i * chartWidth) / (days - 1));
  const yFor = (val: number) => base - (val / max) * chartHeight;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current || !containerRef.current || days === 0) return;
    const svgRect = svgRef.current.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    const xSvg = ((e.clientX - svgRect.left) * width) / svgRect.width;
    const idx = Math.max(0, Math.min(days - 1, Math.round(((xSvg - left) / chartWidth) * Math.max(0, days - 1))));
    setHover({ index: idx, x: e.clientX - containerRect.left, y: e.clientY - containerRect.top });
  }

  if (days === 0 || series.length === 0) {
    return <div className="py-8 text-center text-[12px] text-[var(--muted)]">暂无趋势数据，请在上方搜索框选择 SPU。</div>;
  }

  const single = series.length === 1;
  const tipWidth = 240;
  const tipHeight = 56 + series.length * 18 + 24;
  const cw = containerRef.current?.clientWidth ?? width;
  let tipLeft = 0;
  let tipTop = 0;
  if (hover) {
    tipLeft = Math.max(8, Math.min(cw - tipWidth - 8, hover.x + 12));
    tipTop = Math.max(8, hover.y - tipHeight - 8);
  }
  const totalForHover = hover ? series.reduce((sum, s) => sum + (s.values[hover.index] || 0), 0) : 0;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-[12px]">
        {series.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-[var(--muted)]">
            <i style={{ background: s.color, width: 16, height: 3, display: "inline-block", borderRadius: 2 }} />
            <span className="text-[var(--text)] font-medium">{s.spu}</span>
            {s.productName ? <span>｜{s.productName}</span> : null}
          </span>
        ))}
      </div>
      {hover && (
        <div
          style={{ position: "absolute", left: tipLeft, top: tipTop, width: tipWidth, pointerEvents: "none", zIndex: 10 }}
          className="bg-[var(--panel-solid)] border border-[var(--border-2)] rounded-md shadow-lg p-2 text-[12px]"
        >
          <div className="font-semibold mb-1 text-[var(--text)]">{dates[hover.index]}</div>
          <table className="w-full">
            <tbody>
              {series.map((s, i) => (
                <tr key={i}>
                  <td className="pr-2 py-0.5 text-[var(--text)]">
                    <i style={{ background: s.color, width: 8, height: 8, display: "inline-block", marginRight: 4 }} />
                    {s.spu}
                    {s.productName ? `｜${s.productName}` : ""}
                  </td>
                  <td className="text-right py-0.5 text-[var(--text)]">{(s.values[hover.index] || 0).toLocaleString()} 件</td>
                </tr>
              ))}
              <tr className="border-t border-[var(--border-2)] font-semibold">
                <td className="pr-2 py-0.5 text-[var(--text)]">当日合计</td>
                <td className="text-right py-0.5 text-[var(--text)]">{totalForHover.toLocaleString()} 件</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto" }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label="SPU 日销量折线趋势"
      >
        <text x={left} y={18} fontSize={10} style={{ fill: "var(--muted)" }}>单位：件（悬停查看当天各 SPU 销量）</text>
        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const y = base - chartHeight * r;
          return (
            <g key={r}>
              <line x1={left} y1={y} x2={width - right} y2={y} style={{ stroke: "var(--border)" }} />
              <text x={left - 8} y={y + 4} textAnchor="end" fontSize={10} style={{ fill: "var(--muted)" }}>{Math.round(max * r).toLocaleString()}</text>
            </g>
          );
        })}
        {hover && (
          <line x1={xFor(hover.index)} y1={top} x2={xFor(hover.index)} y2={base} style={{ stroke: "var(--muted-2)" }} strokeDasharray="4 4" />
        )}
        {series.map((s, si) => {
          const points = dates.map((_, i) => `${xFor(i).toFixed(1)},${yFor(s.values[i] || 0).toFixed(1)}`).join(" ");
          return (
            <g key={si}>
              <polyline points={points} fill="none" stroke={s.color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
              {dates.map((_, i) => (
                <circle key={i} cx={xFor(i)} cy={yFor(s.values[i] || 0)} r={2.8} fill={s.color} />
              ))}
            </g>
          );
        })}
        {single &&
          series[0].values.map((val, i) => {
            if (!val) return null;
            const x = xFor(i);
            const y = Math.max(15, yFor(val) - 4);
            return (
              <text key={i} x={x} y={y} textAnchor="middle" fontSize={8.5} style={{ fill: "var(--text)" }}>{val.toLocaleString()}</text>
            );
          })}
        <line x1={left} y1={base} x2={width - right} y2={base} style={{ stroke: "var(--border)" }} />
        {dates.map((d, i) => {
          const show = days <= 8 || i === 0 || i === days - 1 || i % Math.ceil(days / 6) === 0;
          if (!show) return null;
          return <text key={i} x={xFor(i)} y={294} textAnchor="middle" fontSize={10} style={{ fill: "var(--muted)" }}>{d.slice(5)}</text>;
        })}
      </svg>
    </div>
  );
}
