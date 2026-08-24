// 商品变化指挥中心 · 床垫类别分析（条形 + 上期标记 + 注释）
import { money, percent, count } from "./useProductSummary";
import type { CategoryNote, CategoryRow } from "./useProductSummary";
import type { ChartTooltipApi, TipContent } from "./ChartTooltip";

interface Props {
  rows: CategoryRow[];
  notes: CategoryNote[];
  channelScoped: boolean;
  tooltip: ChartTooltipApi;
}

export function MattressCategoryAnalysis({ rows, notes, channelScoped, tooltip }: Props) {
  if (!rows.length) {
    return <div className="category-block"><p style={{ color: "var(--muted)", fontSize: 12 }}>产品主表未同步，无床垫类别数据</p></div>;
  }
  const max = Math.max(...rows.map((r) => r.net), 1);
  return (
    <section className="category-block" aria-labelledby="categoryHeading">
      <div className="category-head">
        <div className="cat-titles">
          <span className="panel-kicker">Mattress Category</span>
          <h3 id="categoryHeading">床垫类别分析</h3>
          <p>全部渠道脱敏聚合，净销售额对比本期 vs 上期。</p>
        </div>
        <span className="cat-chip">{channelScoped ? "全部渠道 · 不随渠道筛选" : "全部渠道口径"}</span>
      </div>
      <div className="category-layout">
        <div className="category-rows" role="list" aria-label="床垫类别净销售额对比">
          {rows.map((r, index) => {
            const good = r.change == null ? null : r.change >= 0;
            const content: TipContent = {
              title: r.name,
              rows: [
                { label: "当前净销售额", value: money(r.net) },
                { label: "上期净销售额", value: r.prevNet != null ? money(r.prevNet) : "-" },
                { label: "环比", value: r.change == null ? "无上期" : `${r.change >= 0 ? "增长 +" : "下滑 "}${percent(r.change, 1)}` },
                { label: "当前占比", value: percent(r.share, 1) },
                { label: "销量", value: `${count(r.units)} 件` },
                { label: "退货率", value: percent(r.refundRate, 1) },
              ],
            };
            return (
              <div
                className="category-row"
                key={r.name}
                role="listitem"
                tabIndex={0}
                onBlur={tooltip.hide}
                onFocus={(e) => tooltip.showOnFocus(e.currentTarget, content)}
                onMouseLeave={tooltip.hide}
                onMouseMove={(e) => tooltip.move(e.clientX, e.clientY)}
                onMouseEnter={(e) => tooltip.show(content, e.clientX, e.clientY)}
                style={{ ["--delay" as string]: `${index * 55}ms` }}
              >
                <span className="cat-name">{r.name}</span>
                <span className="cat-bar">
                  <i className="cat-fill" style={{ width: `${(r.net / max) * 100}%` }} />
                  {r.prevNet != null && <span className="cat-prev" style={{ left: `calc(${(r.prevNet / max) * 100}% - 1px)` }} title={`上期 ${money(r.prevNet)}`} />}
                </span>
                <span className="cat-metrics">
                  <b>{money(r.net)}</b>
                  <em className={`cat-delta ${good == null ? "" : good ? "good" : "bad"}`}>
                    {good == null ? "无上期" : `${good ? "↑ 增长" : "↓ 下滑"} ${r.change! >= 0 ? "+" : ""}${percent(r.change, 1)}`}
                  </em>
                </span>
              </div>
            );
          })}
        </div>
        <div className="category-notes">
          {notes.map((n) => (
            <div key={n.label}>
              <span>{n.label}</span>
              <b>{n.value}</b>
              <small>{n.sub}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
