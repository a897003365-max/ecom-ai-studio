import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import type { DingTalkComparisonItem, DingTalkLatestComparison } from "../types/integration";

interface ComparisonTickerProps {
  comparison: DingTalkLatestComparison;
}

function money(value: number) {
  return value >= 10_000 ? `¥${(value / 10_000).toFixed(1)}万` : `¥${value.toFixed(0)}`;
}

function percent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="ticker-delta is-flat">无昨日基数</span>;
  if (value > 0) return <span className="ticker-delta is-up">+{percent(value)} <ArrowUp size={12} /></span>;
  if (value < 0) return <span className="ticker-delta is-down">{percent(value)} <ArrowDown size={12} /></span>;
  return <span className="ticker-delta is-flat">0.00% <ArrowRight size={12} /></span>;
}

function TickerItem({ item }: { item: DingTalkComparisonItem }) {
  return (
    <div className="comparison-ticker-item">
      <div className="ticker-entity"><span>{item.level === "channel" ? "渠道" : item.platform}</span><b>{item.name}</b></div>
      <div className="ticker-metric"><span>回款</span><b>{money(item.netRevenue)}</b><Delta value={item.netRevenueChange} /></div>
      <div className="ticker-metric"><span>站内费</span><b>{money(item.spend)}</b><Delta value={item.spendChange} /></div>
      <div className="ticker-metric"><span>费比</span><b>{percent(item.feeRate)}</b><Delta value={item.feeRateChange} /></div>
      <div className="ticker-metric"><span>退款率</span><b>{percent(item.refundRate)}</b><Delta value={item.refundRateChange} /></div>
    </div>
  );
}

export function ComparisonTicker({ comparison }: ComparisonTickerProps) {
  const items = [...comparison.channels, ...comparison.stores];
  if (!items.length) return null;
  return (
    <section aria-label={`${comparison.asOf} 经营数据较 ${comparison.previousDate} 环比播报`} className="comparison-ticker">
      <div className="comparison-ticker-label"><span>最新经营播报</span><b>{comparison.asOf}</b><small>对比 {comparison.previousDate}</small></div>
      <div className="comparison-ticker-viewport">
        <div className="comparison-ticker-track">
          {items.map((item, index) => <TickerItem item={item} key={`primary-${item.level}-${item.platform}-${item.name}-${index}`} />)}
          <div aria-hidden="true" className="contents">{items.map((item, index) => <TickerItem item={item} key={`clone-${item.level}-${item.platform}-${item.name}-${index}`} />)}</div>
        </div>
      </div>
    </section>
  );
}
