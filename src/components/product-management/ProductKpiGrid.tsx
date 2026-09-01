// 商品变化指挥中心 · 4 主 KPI
import { percent, pp } from "./useProductSummary";
import type { KpiCard } from "./useProductSummary";

export function ProductKpiGrid({ kpis }: { kpis: KpiCard[] }) {
  if (!kpis.length) return null;
  return (
    <section className="kpi-grid" aria-label="四个主 KPI">
      {kpis.map((item, index) => {
        const delta = item.delta;
        const isGood = delta == null ? null : item.inverse ? delta <= 0 : delta >= 0;
        const direction = delta == null
          ? "环比 -"
          : item.inverse
            ? delta <= 0 ? "↓ 改善" : "↑ 恶化"
            : delta >= 0 ? "↑ 增长" : "↓ 下滑";
        const change = delta == null ? "" : item.unit === "pp" ? pp(delta) : `${delta >= 0 ? "+" : ""}${percent(delta, 1)}`;
        return (
          <article className={`kpi-card is-${item.tone}`} key={item.label} style={{ ["--delay" as string]: `${index * 45}ms` }}>
            <span className="kpi-label">{item.label}</span>
            <strong className="kpi-value">{item.value}</strong>
            <div className="kpi-detail">
              <span>上期 {item.previous}</span>
              <em className={`delta ${isGood == null ? "flat" : isGood ? "good" : "bad"}`}>{direction} {change}</em>
              <small className="kpi-note">{item.detail}</small>
            </div>
          </article>
        );
      })}
    </section>
  );
}
