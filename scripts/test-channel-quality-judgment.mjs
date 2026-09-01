// 渠道质量判断 · 行为测试
// 跑法：node --experimental-strip-types scripts/test-channel-quality-judgment.mjs
// 直接 import 纯函数 judgeChannelQuality，喂样本数据，断言 5 维度都织进结论。
import assert from "node:assert/strict";
import { judgeChannelQuality } from "../src/components/product-management/channelQualityJudge.ts";

// 样本：4 渠道，覆盖 5 维度极值。
// 字段序：channel, salesUnits, receivedAmount, refundAmount, grossProfit,
//         matchedReceived, orderLines, amountShare, avgUnitPrice, refundRate, grossMargin
const rows = [
  { channel: "京东自营", salesUnits: 300, receivedAmount: 294000, refundAmount: 1800, grossProfit: 270000, matchedReceived: 300000, orderLines: 300, amountShare: 0.15, avgUnitPrice: 980, refundRate: 0.005, grossMargin: 0.90 },
  { channel: "抖音", salesUnits: 1200, receivedAmount: 960000, refundAmount: 119040, grossProfit: 192000, matchedReceived: 800000, orderLines: 1200, amountShare: 0.50, avgUnitPrice: 800, refundRate: 0.124, grossMargin: 0.24 },
  { channel: "拼多多", salesUnits: 1000, receivedAmount: 500000, refundAmount: 25000, grossProfit: 50000, matchedReceived: 400000, orderLines: 1000, amountShare: 0.26, avgUnitPrice: 500, refundRate: 0.05, grossMargin: 0.125 },
  { channel: "天猫", salesUnits: 280, receivedAmount: 180000, refundAmount: 3600, grossProfit: 72000, matchedReceived: 150000, orderLines: 280, amountShare: 0.09, avgUnitPrice: 642.86, refundRate: 0.02, grossMargin: 0.48 },
];

// 用例 (a)：5 维度断言（全中才过）
const verdict = judgeChannelQuality(rows);
const text = verdict.text;
assert.equal(verdict.title, "渠道质量判断");
assert.ok(text.includes("京东自营"), `缺「京东自营」: ${text}`);
assert.ok(text.includes("抖音"), `缺「抖音」: ${text}`);
assert.ok(text.includes("拼多多"), `缺「拼多多」: ${text}`);
assert.ok(text.includes("90.0"), `缺「90.0」毛利率值: ${text}`);
assert.ok(text.includes("12.4"), `缺「12.4」退款率值: ${text}`);
assert.ok(text.includes("46.2"), `缺「46.2」毛利贡献值: ${text}`);
assert.ok(text.includes("980"), `缺「980」件单价值: ${text}`);
assert.ok(text.includes("退款率"), `缺「退款率」标签: ${text}`);
assert.ok(text.includes("件单价"), `缺「件单价」标签: ${text}`);

// 用例 (b)：全部 grossMargin=null -> 降级文案
const nullMarginRows = rows.map((r) => ({ ...r, grossMargin: null }));
const fallback = judgeChannelQuality(nullMarginRows);
assert.ok(
  fallback.text.includes("未匹配到成本数据"),
  `降级文案缺失: ${fallback.text}`,
);

// 用例 (c)：单渠道 -> 不抛异常、text 含渠道名
const single = judgeChannelQuality([rows[0]]);
assert.ok(
  single.text.includes("京东自营"),
  `单渠道文案缺渠道名: ${single.text}`,
);

console.log("channel quality judgment: ok");
