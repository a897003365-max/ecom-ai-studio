// 渠道健康度评分 · 行为测试
// 跑法：node --experimental-strip-types scripts/test-channel-health.mjs
// 直接 import 纯函数 scoreChannelHealth，喂样本 pm，断言评级/红黄灯/建议/置信度/降级。
import assert from "node:assert/strict";
import { scoreChannelHealth } from "../src/components/product-management/scoreChannelHealth.ts";

// 样本：4 渠道，覆盖健康/退款超阈值/毛利率垫底/体量可忽略四类场景。
// 字段对齐 ProductChannelBreakdownItem
const channelBreakdown = [
  { channel: "京东", salesUnits: 4800, receivedAmount: 4775771, refundAmount: 0, grossProfit: 1432000, matchedReceived: 4775771, orderLines: 4800, amountShare: 0.40, avgUnitPrice: 995, refundRate: 0.005, grossMargin: 0.30 },
  { channel: "抖音", salesUnits: 5200, receivedAmount: 2581532, refundAmount: 2202479, grossProfit: 620000, matchedReceived: 2581532, orderLines: 5200, amountShare: 0.22, avgUnitPrice: 497, refundRate: 0.46, grossMargin: 0.24 },
  { channel: "拼多多", salesUnits: 4100, receivedAmount: 2168328, refundAmount: 1692684, grossProfit: 271000, matchedReceived: 2168328, orderLines: 4100, amountShare: 0.18, avgUnitPrice: 529, refundRate: 0.438, grossMargin: 0.125 },
  { channel: "唯品", salesUnits: 30, receivedAmount: 28732, refundAmount: 0, grossProfit: 0, matchedReceived: 0, orderLines: 30, amountShare: 0.002, avgUnitPrice: 958, refundRate: 0, grossMargin: null },
];

// returnChannelBreakdown：渠道退款归因（dim=渠道名）
const returnChannelBreakdown = [
  { dim: "京东", refundAmount: 0, refundUnits: 0, refundOrderCount: 0, refundOrderShare: 0, refundRate: 0.005, preShipRefundShare: 0.2, fullRefundShare: 0.3, receivedAmount: 4775771, orderLines: 4800 },
  { dim: "抖音", refundAmount: 2202479, refundUnits: 2300, refundOrderCount: 2200, refundOrderShare: 0.42, refundRate: 0.46, preShipRefundShare: 0.71, fullRefundShare: 0.64, receivedAmount: 2581532, orderLines: 5200 },
  { dim: "拼多多", refundAmount: 1692684, refundUnits: 1800, refundOrderCount: 1700, refundOrderShare: 0.41, refundRate: 0.438, preShipRefundShare: 0.55, fullRefundShare: 0.5, receivedAmount: 2168328, orderLines: 4100 },
];

const pm = {
  source: "jushuitan_local_logic",
  period: { start: "2026-05-01", end: "2026-05-31" },
  channelBreakdown,
  returnChannelBreakdown,
  returnRanking: [],
};

// 用例 (a)：正常多渠道评级
const report = scoreChannelHealth(pm);
assert.equal(report.channels.length, 4, `渠道数应为 4，实际 ${report.channels.length}`);

// 京东应是最健康（A 或 B）
const jd = report.channels.find((c) => c.channel === "京东");
assert.ok(jd, "缺京东");
assert.ok(jd.grade === "A" || jd.grade === "B", `京东应为 A/B，实际 ${jd.grade}`);

// 抖音退款率超阈值 → P0 红灯
const dyP0 = report.redLights.find((l) => l.channel === "抖音" && l.level === "P0");
assert.ok(dyP0, `抖音应触发 P0 红灯: ${JSON.stringify(report.redLights)}`);

// 唯品体量可忽略 → P0 红灯 + 收缩迁移建议
const wpP0 = report.redLights.find((l) => l.channel === "唯品" && l.level === "P0");
assert.ok(wpP0, `唯品应触发 P0 体量可忽略: ${JSON.stringify(report.redLights)}`);
const wpSug = report.suggestions.find((s) => s.channel === "唯品");
assert.ok(wpSug, `唯品应有收缩迁移建议`);

// 抖音应有退款归因建议（drilldown=refund）
const dySug = report.suggestions.find((s) => s.channel === "抖音" && s.drilldown === "refund");
assert.ok(dySug, `抖音应有退款归因建议: ${JSON.stringify(report.suggestions.map((s) => s.channel))}`);
assert.ok(dySug.action.includes("46.0%"), `抖音建议应含退款率值: ${dySug.action}`);

// 拼多多毛利率垫底 → 品类归因建议
const pddSug = report.suggestions.find((s) => s.channel === "拼多多" && s.drilldown === "category");
assert.ok(pddSug, `拼多多应有品类归因建议`);

// 置信度：3/4 有 margin = 0.75 → mid
assert.equal(report.confidence, "mid", `置信度应为 mid，实际 ${report.confidence}`);

// 主结论应含最健康渠道名
assert.ok(report.summary.includes("京东"), `主结论缺京东: ${report.summary}`);

// 用例 (b)：全 null grossMargin → 置信度 low + 降级文案
const pmNullMargin = {
  ...pm,
  channelBreakdown: channelBreakdown.map((r) => ({ ...r, grossMargin: null })),
};
const reportNull = scoreChannelHealth(pmNullMargin);
assert.equal(reportNull.confidence, "low", `全 null 毛利应置信度 low，实际 ${reportNull.confidence}`);
assert.ok(reportNull.summary.includes("成本数据"), `全 null 毛利应降级提示: ${reportNull.summary}`);

// 用例 (c)：空渠道 → 降级文案
const reportEmpty = scoreChannelHealth({ ...pm, channelBreakdown: [] });
assert.ok(reportEmpty.summary.includes("暂无渠道数据"), `空渠道应降级: ${reportEmpty.summary}`);
assert.equal(reportEmpty.channels.length, 0);

// 用例 (d)：单渠道不抛异常 + 含渠道名
const reportSingle = scoreChannelHealth({ ...pm, channelBreakdown: [channelBreakdown[0]] });
assert.equal(reportSingle.channels.length, 1);
assert.ok(reportSingle.summary.includes("京东"), `单渠道主结论缺渠道名: ${reportSingle.summary}`);

// 用例 (e)：退款率低于阈值不触发红灯
const pmHealthy = {
  ...pm,
  channelBreakdown: channelBreakdown.map((r) => ({ ...r, refundRate: 0.02 })),
};
const reportHealthy = scoreChannelHealth(pmHealthy);
const refundRedLights = reportHealthy.redLights.filter((l) => l.type === "退款率过高");
assert.equal(refundRedLights.length, 0, `退款率 2% 不应触发红灯，实际 ${refundRedLights.length}`);

console.log("channel health scoring: ok");
