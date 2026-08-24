// 商品变化指挥中心 · 6 次级指标
import type { SecondaryMetric } from "./useProductSummary";

export function ProductSecondaryBand({ metrics }: { metrics: SecondaryMetric[] }) {
  if (!metrics.length) return null;
  return (
    <section className="secondary-band" aria-label="次级指标带">
      {metrics.map((item, index) => {
        const word = item.good ? (item.up ? "增长" : "改善") : item.up ? "恶化" : "下滑";
        const arrow = item.up ? "↑" : "↓";
        return (
          <article className={`submetric${item.accent ? ` accent-${item.accent}` : ""}`} key={index}>
            <span>{item.label}</span>
            <b>{item.value}</b>
            <div className="submetric-foot">
              <small>{item.prev}</small>
              <em className={`sub-delta ${item.good ? "good" : "bad"}`}>{arrow} {word} {item.change}</em>
            </div>
          </article>
        );
      })}
    </section>
  );
}
