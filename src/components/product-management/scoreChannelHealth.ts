// 渠道健康度评分 · 纯函数
// Phase 1 三维评分：产出力 30% / 盈利力 35% / 风险力 35%
// 输入 pm（按全局筛选实时计算），输出评级 / 红黄灯 / 头部建议 / 置信度。
// 无 React 依赖，可被 scripts/test-channel-health.mjs 直接 import。
// 设计文档：docs/CHANNEL-QUALITY-TRANSPARENT-DESIGN.md
import type {
  ProductManagementPages,
  ProductChannelBreakdownItem,
  ProductReturnDimensionBreakdownItem,
} from "../../types/integration";

export type ChannelGrade = "A" | "B" | "C" | "D";

export interface ChannelHealthItem {
  channel: string;
  scores: { output: number; profit: number; risk: number };
  total: number;
  grade: ChannelGrade;
  rootCause: string;
  receivedAmount: number;
  grossMargin: number | null;
  refundRate: number | null;
  amountShare: number;
}

export interface RedLight {
  channel: string;
  level: "P0" | "P1";
  type: string;
  value: string;
  threshold: string;
}

export interface Suggestion {
  priority: "P0" | "P1" | "P2";
  channel: string;
  action: string;
  expectedImpact: string;
  confidence: "high" | "mid" | "low";
  drilldown: "refund" | "category" | "none";
}

export interface ChannelHealthReport {
  summary: string;
  confidence: "high" | "mid" | "low";
  channels: ChannelHealthItem[];
  redLights: RedLight[];
  suggestions: Suggestion[];
}

// 阈值集中配置，便于调参
const THRESHOLDS = {
  refundRed: 0.15,        // 退款率红灯阈值 15%
  refundYellow: 0.10,     // 退款率黄灯阈值 10%
  marginLow: 0.12,        // 毛利率过低阈值 12%
  shareNegligible: 0.01,  // 体量可忽略阈值 1%
};

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

const pct = (v: number | null | undefined, digits = 1): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(digits)}%`;
};

// 标准化到 0-100：基准值=60 分，2 倍基准=100，线性裁剪
const norm = (value: number, baseline: number): number => {
  if (baseline <= 0) return value > 0 ? 60 : 0;
  const score = 60 * (value / baseline);
  return Math.max(0, Math.min(100, Math.round(score)));
};

const median = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function gradeOf(total: number): ChannelGrade {
  if (total >= 85) return "A";
  if (total >= 70) return "B";
  if (total >= 55) return "C";
  return "D";
}

function refundLight(refundRate: number | null, channel: string): RedLight | null {
  if (refundRate === null || !Number.isFinite(refundRate)) return null;
  if (refundRate >= THRESHOLDS.refundRed) {
    return { channel, level: "P0", type: "退款率过高", value: pct(refundRate), threshold: pct(THRESHOLDS.refundRed) };
  }
  if (refundRate >= THRESHOLDS.refundYellow) {
    return { channel, level: "P1", type: "退款率偏高", value: pct(refundRate), threshold: pct(THRESHOLDS.refundYellow) };
  }
  return null;
}

export function scoreChannelHealth(pm: ProductManagementPages): ChannelHealthReport {
  const channels: ProductChannelBreakdownItem[] = pm.channelBreakdown ?? [];
  const returnByChannel: ProductReturnDimensionBreakdownItem[] = pm.returnChannelBreakdown ?? [];

  if (channels.length === 0) {
    return {
      summary: "当前筛选范围暂无渠道数据，请调整筛选条件后重试。",
      confidence: "low",
      channels: [],
      redLights: [],
      suggestions: [],
    };
  }

  // 全渠道基准
  const totalReceived = channels.reduce((s, r) => s + num(r.receivedAmount), 0);
  const avgReceived = totalReceived / channels.length;
  const margins = channels
    .map((r) => r.grossMargin)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  const marginMedian = median(margins);

  // 退款归因 map：channel -> returnChannelBreakdown item
  const returnMap = new Map<string, ProductReturnDimensionBreakdownItem>();
  for (const r of returnByChannel) {
    if (r.dim) returnMap.set(r.dim, r);
  }

  const items: ChannelHealthItem[] = channels.map((r) => {
    const received = num(r.receivedAmount);
    const margin = r.grossMargin ?? null;
    const refundRate = r.refundRate ?? null;

    // 产出力：received / avgReceived，基准=60
    const output = norm(received, avgReceived || 1);

    // 盈利力：毛利率 vs 中位数。中位数=60，超中位按比例加分，无成本数据降权。
    let profit: number;
    if (margin === null) {
      profit = 30;
    } else if (marginMedian > 0) {
      profit = Math.max(0, Math.min(100, Math.round(60 * (margin / marginMedian))));
    } else {
      profit = margin > 0 ? 70 : 40;
    }

    // 风险力：退款率。0%=100，15%=50，30%+=10。发货前退款占比高（冲动消费）额外扣。
    let risk: number;
    if (refundRate === null) {
      risk = 60;
    } else {
      risk = Math.max(0, Math.min(100, Math.round(100 - (refundRate / THRESHOLDS.refundRed) * 50)));
      const ret = returnMap.get(r.channel);
      const preShip = ret?.preShipRefundShare ?? null;
      if (preShip !== null && preShip > 0.5) {
        risk = Math.max(0, risk - Math.round((preShip - 0.5) * 30));
      }
    }

    const total = Math.round(output * 0.3 + profit * 0.35 + risk * 0.35);
    const grade = gradeOf(total);

    // 根因：高分渠道说优点，低分渠道说短板
    let rootCause: string;
    if (grade === "A" || grade === "B") {
      if (refundRate !== null && refundRate < THRESHOLDS.refundYellow) {
        rootCause = `退款率${pct(refundRate)}健康`;
      } else if (margin !== null && margin >= marginMedian) {
        rootCause = `毛利率${pct(margin)}优于中位`;
      } else {
        rootCause = `体量占比${pct(r.amountShare)}`;
      }
    } else {
      const dims = [
        { name: "风险力", s: risk },
        { name: "盈利力", s: profit },
        { name: "产出力", s: output },
      ].sort((a, b) => a.s - b.s);
      const lowest = dims[0];
      if (lowest.name === "风险力" && refundRate !== null) {
        rootCause = `退款率${pct(refundRate)}${refundRate >= THRESHOLDS.refundRed ? "超阈值" : "偏高"}`;
      } else if (lowest.name === "盈利力") {
        rootCause = margin === null ? "成本未匹配" : `毛利率${pct(margin)}${margin < marginMedian ? "低于中位" : ""}`;
      } else {
        rootCause = `体量占比${pct(r.amountShare)}`;
      }
    }

    return {
      channel: r.channel,
      scores: { output, profit, risk },
      total,
      grade,
      rootCause,
      receivedAmount: received,
      grossMargin: margin,
      refundRate,
      amountShare: r.amountShare ?? 0,
    };
  });

  // 按总分降序
  items.sort((a, b) => b.total - a.total);

  // 红黄灯
  const redLights: RedLight[] = [];
  for (const r of channels) {
    const light = refundLight(r.refundRate ?? null, r.channel);
    if (light) redLights.push(light);
    const m = r.grossMargin;
    if (m !== null && m < THRESHOLDS.marginLow) {
      redLights.push({ channel: r.channel, level: "P1", type: "毛利率过低", value: pct(m), threshold: pct(THRESHOLDS.marginLow) });
    }
    if ((r.amountShare ?? 0) < THRESHOLDS.shareNegligible && num(r.receivedAmount) < avgReceived * 0.05) {
      redLights.push({ channel: r.channel, level: "P0", type: "体量可忽略", value: `占比${pct(r.amountShare)}`, threshold: pct(THRESHOLDS.shareNegligible) });
    }
  }

  // 头部建议
  const suggestions: Suggestion[] = [];
  for (const r of channels) {
    const rr = r.refundRate ?? null;
    if (rr !== null && rr >= THRESHOLDS.refundRed) {
      suggestions.push({
        priority: "P0",
        channel: r.channel,
        action: `${r.channel}退款率${pct(rr)}超阈值，本周完成 SKU 级退款归因，锁定 Top3 退款单品下架复核`,
        expectedImpact: "退款率回落预计释放回款",
        confidence: "mid",
        drilldown: "refund",
      });
    }
  }
  const withMargin = channels.filter((r) => r.grossMargin !== null);
  if (withMargin.length >= 2) {
    const sorted = [...withMargin].sort((a, b) => num(a.grossMargin) - num(b.grossMargin));
    const bottom = sorted[0];
    suggestions.push({
      priority: "P1",
      channel: bottom.channel,
      action: `${bottom.channel}毛利率${pct(bottom.grossMargin)}垫底，按床垫类别拆解促销与补贴结构`,
      expectedImpact: "识别低毛利类目后优化定价",
      confidence: "mid",
      drilldown: "category",
    });
  }
  for (const r of channels) {
    if ((r.amountShare ?? 0) < THRESHOLDS.shareNegligible && num(r.receivedAmount) < avgReceived * 0.05) {
      suggestions.push({
        priority: "P0",
        channel: r.channel,
        action: `${r.channel}体量占比${pct(r.amountShare)}可忽略，建议收缩预算迁移至头部渠道`,
        expectedImpact: "资源重分配提升整体效率",
        confidence: "high",
        drilldown: "none",
      });
    }
  }
  if (items.length > 0 && (items[0].grade === "A" || items[0].grade === "B")) {
    const top = items[0];
    suggestions.push({
      priority: "P1",
      channel: top.channel,
      action: `${top.channel}评级${top.grade}为最健康渠道，维持当前策略并复盘可复制经验`,
      expectedImpact: "复制成功经验至其他渠道",
      confidence: "high",
      drilldown: "none",
    });
  }
  const prioOrder = { P0: 0, P1: 1, P2: 2 } as const;
  suggestions.sort((a, b) => prioOrder[a.priority] - prioOrder[b.priority]);

  // 置信度
  const marginCoverage = channels.length > 0 ? margins.length / channels.length : 0;
  let confidence: "high" | "mid" | "low";
  if (marginCoverage >= 0.8) confidence = "high";
  else if (marginCoverage >= 0.3) confidence = "mid";
  else confidence = "low";

  // 主结论
  const topChannel = items[0];
  const worstChannel = items[items.length - 1];
  const redP0 = redLights.filter((l) => l.level === "P0");
  let summary: string;
  if (confidence === "low") {
    summary = "当前筛选范围成本数据匹配率低，毛利率口径不可靠，评分已降权，建议先补齐成本数据。";
  } else if (redP0.length > 0) {
    const p0Names = [...new Set(redP0.map((l) => l.channel))].slice(0, 2).join("、");
    summary = `${topChannel.channel}评级${topChannel.grade}最健康；${redP0.length}个渠道触发 P0 风险，优先处理${p0Names}。`;
  } else {
    summary = `${topChannel.channel}评级${topChannel.grade}为最健康渠道，${worstChannel.channel}评级${worstChannel.grade}需关注${worstChannel.rootCause}。`;
  }

  return { summary, confidence, channels: items, redLights, suggestions };
}
