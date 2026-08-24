// 商品变化指挥中心 · 当前渠道结构（条形 + tooltip）
import { money, percent } from "./useProductSummary";
import type { ChannelRow } from "./useProductSummary";
import type { ChartTooltipApi, TipContent } from "./ChartTooltip";

interface Props {
  rows: ChannelRow[];
  tooltip: ChartTooltipApi;
}

export function ChannelStructurePanel({ rows, tooltip }: Props) {
  if (!rows.length) {
    return <div className="channel-list"><p style={{ color: "var(--muted)", fontSize: 12 }}>当前筛选条件下暂无渠道数据</p></div>;
  }
  const max = Math.max(...rows.map((r) => r.net), 1);
  return (
    <div className="channel-list">
      {rows.map((r) => {
        const content: TipContent = {
          title: r.name,
          rows: [
            { label: "净销售额", value: money(r.net) },
            { label: "商家实收", value: money(r.received) },
            { label: "当前占比", value: percent(r.share, 1) },
          ],
        };
        return (
          <div
            className="channel-row"
            key={r.name}
            role="button"
            tabIndex={0}
            aria-label={`${r.name}：净销售额 ${money(r.net)}，占比 ${percent(r.share, 1)}`}
            onBlur={tooltip.hide}
            onFocus={(e) => tooltip.showOnFocus(e.currentTarget, content)}
            onMouseLeave={tooltip.hide}
            onMouseMove={(e) => tooltip.move(e.clientX, e.clientY)}
            onMouseEnter={(e) => tooltip.show(content, e.clientX, e.clientY)}
          >
            <span className="platform-badge">{r.name}</span>
            <span className="bar-track"><i style={{ width: `${(r.net / max) * 100}%` }} /></span>
            <b>{percent(r.share, 1)}</b>
          </div>
        );
      })}
    </div>
  );
}
