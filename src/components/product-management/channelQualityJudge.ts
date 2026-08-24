// 渠道质量判断 · 纯函数
// 从 ChannelQualityPanel.buildCallout 抽出，无 React/JSX 依赖，可被行为测试直接 import。
// 织入 5 个分析维度：毛利率最高渠道+其值、体量占比、毛利额贡献占比、退款率最高渠道+其值、
// 件单价极值渠道+其值，并指出毛利率最低的两个渠道。某维度数据全缺则跳过该分句。
import type { ProductChannelBreakdownItem } from "../../types/integration";

export interface ChannelQualityVerdict {
  title: string;
  text: string;
}

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

// 比率（0.90 表示 90%）转 1 位小数百分数字符串；null/非数返回 "-"。
const pct = (v: number | null | undefined, digits = 1): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(digits)}%`;
};

// 金额/单价转 2 位小数千分位字符串；null/非数返回 "-"。
const price = (v: number | null | undefined): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function judgeChannelQuality(rows: ProductChannelBreakdownItem[]): ChannelQualityVerdict {
  const title = "渠道质量判断";
  const withMargin = rows.filter((r) => r.grossMargin !== null && r.grossMargin !== undefined);

  // 全 null grossMargin：无法计算毛利率，给降级文案。
  if (withMargin.length === 0) {
    return { title, text: "当前筛选范围未匹配到成本数据，暂无法计算渠道毛利率。" };
  }

  // 按毛利率降序，取最高与最低两个。
  const sortedDesc = [...withMargin].sort((a, b) => num(b.grossMargin) - num(a.grossMargin));
  const top = sortedDesc[0];

  // 毛利额贡献 = 该渠道 grossProfit / 全渠道 grossProfit 之和。
  const totalGrossProfit = rows.reduce((s, r) => s + num(r.grossProfit), 0);
  const profitShare = totalGrossProfit > 0 ? num(top.grossProfit) / totalGrossProfit : null;
  const profitClause = profitShare !== null ? `、毛利贡献占${pct(profitShare)}` : "";

  // 退款率最高渠道（refundRate 非 null 才进）。
  const withRefund = rows.filter((r) => r.refundRate !== null && r.refundRate !== undefined);
  const refundTop = withRefund.length
    ? [...withRefund].sort((a, b) => num(b.refundRate) - num(a.refundRate))[0]
    : null;
  const refundClause = refundTop
    ? `${refundTop.channel}退款率${pct(refundTop.refundRate)}偏高，需关注退货质量；`
    : "";

  // 件单价极值渠道（avgUnitPrice 非 null 才进）——取最高，反映定价结构上限。
  const withPrice = rows.filter((r) => r.avgUnitPrice !== null && r.avgUnitPrice !== undefined);
  const priceTop = withPrice.length
    ? [...withPrice].sort((a, b) => num(b.avgUnitPrice) - num(a.avgUnitPrice))[0]
    : null;
  const priceClause = priceTop
    ? `件单价以${priceTop.channel}最高（${price(priceTop.avgUnitPrice)}元）；`
    : "";

  // 单一渠道：无最低对比，提示扩大筛选范围；退款/件单价分句依赖横向对比，此处不带入。
  if (sortedDesc.length === 1) {
    return {
      title,
      text: `${top.channel}毛利率${pct(top.grossMargin)}，体量占${pct(top.amountShare)}${profitClause}；样本仅单一渠道，建议扩大筛选范围复盘。`,
    };
  }

  const lows = sortedDesc.slice(-2);
  const lowNames = lows.map((r) => r.channel).join("与");

  return {
    title,
    text: `${top.channel}毛利率最高（${pct(top.grossMargin)}），体量仅占${pct(top.amountShare)}${profitClause}；${refundClause}${priceClause}${lowNames}毛利率垫底，优先拆解促销与补贴。`,
  };
}
