import { useRef, useState } from "react";

interface DailyPoint {
  date: string;
  receivedAmount: number;
  refundAmount: number;
  refundRate: number; // 0–1
}

interface Props {
  data: DailyPoint[];
}

const MONEY_COLOR = "#12695f";
const REFUND_COLOR = "#b43c45";
const RATE_COLOR = "#c86628";

/** 双轴折线图：左轴金额（商家实收 + 退货金额），右轴百分比（退款金额占比）。 */
export function DailyTrendChart({ data }: Props) {
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 1160, height = 380, left = 60, right = 48, top = 42, base = 310, chartHeight = 260;
  const days = data.length;
  const chartWidth = width - left - right;
  const maxMoney = Math.max(1, ...data.map((d) => d.receivedAmount), ...data.map((d) => d.refundAmount));
  const maxRate = Math.max(0.01, ...data.map((d) => d.refundRate));
  const xFor = (i: number) => left + (days <= 1 ? chartWidth / 2 : (i * chartWidth) / (days - 1));
  const yMoney = (v: number) => base - (v / maxMoney) * chartHeight;
  const yRate = (v: number) => base - (v / maxRate) * chartHeight;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current || !containerRef.current || days === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * width) / rect.width;
    const idx = Math.max(0, Math.min(days - 1, Math.round(((x - left) / chartWidth) * Math.max(0, days - 1))));
    const cr = containerRef.current.getBoundingClientRect();
    setHover({ index: idx, x: e.clientX - cr.left, y: e.clientY - cr.top });
  }

  if (days === 0) {
    return <div className="py-8 text-center text-[12px] text-[var(--muted)]">暂无趋势数据。</div>;
  }

  const tipWidth = 220;
  const tipHeight = 80;
  const cw = containerRef.current?.clientWidth ?? width;
  let tipLeft = 0, tipTop = 0;
  if (hover) {
    tipLeft = Math.max(8, Math.min(cw - tipWidth - 8, hover.x + 12));
    tipTop = Math.max(8, hover.y - tipHeight - 8);
  }
  const h = hover ? data[hover.index] : null;

  // 金额轴刻度（5 条横线）
  const moneyGrid = [0, 0.25, 0.5, 0.75, 1].map((r) => {
    const y = base - chartHeight * r;
    return (
      <g key={`m${r}`}>
        <line x1={left} y1={y} x2={width - right} y2={y} style={{ stroke: "var(--border)" }} />
        <text x={left - 6} y={y + 4} textAnchor="end" fontSize={10} style={{ fill: "var(--muted)" }}>
          {`¥${Math.round(maxMoney * r).toLocaleString()}`}
        </text>
      </g>
    );
  });

  // 比率轴刻度（3 条）
  const rateGrid = [0, 0.5, 1].map((r) => {
    const y = base - chartHeight * r;
    return (
      <g key={`r${r}`}>
        <text x={width - right + 6} y={y + 4} textAnchor="start" fontSize={10} style={{ fill: "var(--muted)" }}>
          {`${(maxRate * r * 100).toFixed(1)}%`}
        </text>
      </g>
    );
  });

  // 多折线 helper
  function polyline(key: string, values: number[], yFn: (v: number) => number, color: string, dash?: string) {
    if (days === 0) return null;
    const pts = data.map((_, i) => `${xFor(i).toFixed(1)},${yFn(values[i]).toFixed(1)}`).join(" ");
    return (
      <g key={key}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth={2.2} strokeDasharray={dash ?? "none"} strokeLinecap="round" strokeLinejoin="round" />
        {data.map((_, i) => (
          <circle key={i} cx={xFor(i)} cy={yFn(values[i])} r={2.4} fill={color} />
        ))}
      </g>
    );
  }

  const dates = data.map((d) => d.date);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-[12px]">
        <span className="inline-flex items-center gap-1.5 text-[var(--muted)]">
          <i style={{ background: MONEY_COLOR, width: 16, height: 3, display: "inline-block", borderRadius: 2 }} />
          <span className="text-[var(--text)] font-medium">商家实收</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-[var(--muted)]">
          <i style={{ background: REFUND_COLOR, width: 16, height: 3, display: "inline-block", borderRadius: 2 }} />
          <span className="text-[var(--text)]">退货金额</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-[var(--muted)]">
          <i style={{ background: RATE_COLOR, width: 16, height: 3, display: "inline-block", borderRadius: 2 }} />
          <span className="text-[var(--text)]">退款金额占比</span>
        </span>
      </div>
      {hover && h && (
        <div
          style={{ position: "absolute", left: tipLeft, top: tipTop, width: tipWidth, pointerEvents: "none", zIndex: 10 }}
          className="bg-[var(--panel-solid)] border border-[var(--border-2)] rounded-md shadow-lg p-2 text-[12px]"
        >
          <div className="font-semibold mb-1 text-[var(--text)]">{h.date}</div>
          <table className="w-full">
            <tbody>
              <tr><td className="pr-2 py-0.5"><i style={{ background: MONEY_COLOR, width: 8, height: 8, display: "inline-block", marginRight: 4 }} />商家实收</td><td className="text-right py-0.5 text-[var(--text)]">¥{h.receivedAmount.toLocaleString()}</td></tr>
              <tr><td className="pr-2 py-0.5"><i style={{ background: REFUND_COLOR, width: 8, height: 8, display: "inline-block", marginRight: 4 }} />退货金额</td><td className="text-right py-0.5 text-[var(--text)]">¥{h.refundAmount.toLocaleString()}</td></tr>
              <tr><td className="pr-2 py-0.5"><i style={{ background: RATE_COLOR, width: 8, height: 8, display: "inline-block", marginRight: 4 }} />退款金额占比</td><td className="text-right py-0.5 text-[var(--text)]">{(h.refundRate * 100).toFixed(2)}%</td></tr>
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
        aria-label="每日商家实收/退货金额/退款占比趋势"
      >
        <text x={left} y={18} fontSize={10} style={{ fill: "var(--muted)" }}>金额（元）</text>
        <text x={width - right} y={18} fontSize={10} textAnchor="end" style={{ fill: "var(--muted)" }}>退款占比（%）</text>
        {moneyGrid}
        {rateGrid}
        {hover && (
          <line x1={xFor(hover.index)} y1={top} x2={xFor(hover.index)} y2={base} style={{ stroke: "var(--muted-2)" }} strokeDasharray="4 4" />
        )}
        {polyline("money", data.map((d) => d.receivedAmount), yMoney, MONEY_COLOR)}
        {polyline("refund", data.map((d) => d.refundAmount), yMoney, REFUND_COLOR, "6 3")}
        {polyline("rate", data.map((d) => d.refundRate), yRate, RATE_COLOR, "3 3")}
        <line x1={left} y1={base} x2={width - right} y2={base} style={{ stroke: "var(--border)" }} />
        {dates.map((d, i) => {
          const show = days <= 8 || i === 0 || i === days - 1 || i % Math.ceil(days / 12) === 0;
          if (!show) return null;
          return <text key={i} x={xFor(i)} y={base + 16} textAnchor="middle" fontSize={10} style={{ fill: "var(--muted)" }}>{d.slice(5)}</text>;
        })}
      </svg>
    </div>
  );
}