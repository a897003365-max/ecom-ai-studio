// 商品变化指挥中心 · 经营健康雷达（6 维 0-100）
import { percent, pp, count } from "./useProductSummary";
import type { RadarModel } from "./useProductSummary";
import type { ChartTooltipApi, TipContent } from "./ChartTooltip";

interface Props {
  radar: RadarModel;
  tooltip: ChartTooltipApi;
}

const CX = 160;
const CY = 126;
const RADIUS = 86;

function point(value: number, index: number, labels: number): [number, number] {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / labels;
  const r = (RADIUS * value) / 100;
  return [CX + Math.cos(angle) * r, CY + Math.sin(angle) * r];
}

function polygon(values: number[]): string {
  return values.map((value, index) => point(value, index, values.length).map((n) => n.toFixed(2)).join(",")).join(" ");
}

function vertexContent(radar: RadarModel, index: number): TipContent {
  const label = radar.labels[index];
  const score = Math.round(radar.scores[index]);
  let rows: { label: string; value: string }[];
  if (index === 0) rows = [{ label: "净销售额环比", value: `${radar.salesGrowth >= 0 ? "+" : ""}${(radar.salesGrowth * 100).toFixed(1)}%` }];
  else if (index === 1) rows = [{ label: "净额 / 商家实收", value: percent(radar.collectionQuality, 1) }];
  else if (index === 2) rows = [{ label: "毛利率", value: percent(radar.margin, 1) }, { label: "环比", value: pp(radar.marginDelta) }];
  else if (index === 3) rows = [{ label: "退货率", value: percent(radar.refundRate, 2) }, { label: "环比", value: `${radar.refundDelta != null && radar.refundDelta <= 0 ? "改善 " : "恶化 "}${pp(radar.refundDelta)}` }];
  else if (index === 4) rows = [{ label: "HHI 实际值", value: `${radar.hhi}` }, { label: "渠道数", value: `${radar.n}${radar.n === 1 ? " · 单渠道筛选" : ""}` }];
  else rows = [{ label: "发货时效中位数", value: radar.shipDays != null ? `${radar.shipDays.toFixed(1)} 天` : "-" }, { label: "待发货件数", value: `${count(radar.pendingUnits)} 件` }, { label: "待发货压力", value: `${(radar.pressure * 100).toFixed(1)}%` }];
  return { title: label, rows: [{ label: "健康度", value: `${score}` }, ...rows] };
}

export function HealthRadar({ radar, tooltip }: Props) {
  const labels = radar.labels;
  const scores = radar.scores;
  const rings = [0.33, 0.66, 1].map((ratio) => (
    <polygon className="radar-grid" key={ratio} points={labels.map((_, index) => point(ratio * 100, index, labels.length).map((n) => n.toFixed(2)).join(",")).join(" ")} />
  ));
  const axes = labels.map((label, index) => {
    const [x2, y2] = point(105, index, labels.length);
    const anchor = x2 < CX - 10 ? "end" : x2 > CX + 10 ? "start" : "middle";
    return (
      <g key={label}>
        <line className="radar-grid" x1={CX} y1={CY} x2={x2} y2={y2} />
        <text className="radar-label" x={x2} y={y2 + 4} textAnchor={anchor}>{label}</text>
      </g>
    );
  });
  const vertices = scores.map((value, index) => {
    const [px, py] = point(value, index, labels.length);
    const content = vertexContent(radar, index);
    return (
      <circle
        className="radar-vertex"
        cx={px.toFixed(2)}
        cy={py.toFixed(2)}
        data-dim={index}
        key={index}
        r={4.5}
        role="button"
        tabIndex={0}
        aria-label={`${labels[index]} 健康度 ${Math.round(value)}`}
        onBlur={tooltip.hide}
        onFocus={(e) => tooltip.showOnFocus(e.currentTarget, content)}
        onMouseLeave={tooltip.hide}
        onMouseMove={(e) => tooltip.move(e.clientX, e.clientY)}
        onMouseEnter={(e) => tooltip.show(content, e.clientX, e.clientY)}
      />
    );
  });
  return (
    <div className="radar-wrap">
      <svg className="radar-svg" viewBox="0 0 320 260" role="img" aria-label="经营健康雷达图">
        {rings}
        {axes}
        <polygon className="radar-current" points={polygon(scores)} />
        {vertices}
      </svg>
      <div className="radar-note">
        <div><span>综合健康度</span><b>{radar.overall}</b></div>
        <div><span>渠道 HHI</span><b>{radar.hhi}{radar.n === 1 ? " · 单渠道" : ""}</b></div>
        <p className="radar-meta">原型健康度 0–100；悬停查看实际口径；渠道均衡按当前净销售额 HHI 实算</p>
      </div>
    </div>
  );
}
