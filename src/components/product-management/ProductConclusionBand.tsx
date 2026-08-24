// 商品变化指挥中心 · 变化结论摘要（3 卡）
import type { ConclusionCard } from "./useProductSummary";

export function ProductConclusionBand({ cards }: { cards: ConclusionCard[] }) {
  if (!cards.length) return null;
  return (
    <section className="conclusion-band" aria-label="变化结论摘要">
      {cards.map((card, index) => {
        const good = card.good;
        const tone = good === true ? "status-good" : good === false ? "status-risk" : "";
        return (
          <article className="conclusion-card" key={index}>
            <span>{card.label}</span>
            <b className={tone}>{card.headline}</b>
            <small>{card.sub}</small>
          </article>
        );
      })}
    </section>
  );
}
