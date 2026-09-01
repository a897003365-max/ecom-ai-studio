import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReportFacts, createBaselineNarrative, renderReportHtml, renderReportMarkdown } from "../server/intelligence-report.mjs";

const period = "2026-08-25";
const top100 = {
  samplePeriod: period,
  items: Array.from({ length: 100 }, (_, index) => ({
    row: index + 1,
    cpRank: index + 1,
    productName: `测试商品 ${index + 1}`,
    brand: `品牌 ${index % 10}`,
    shop: `店铺 ${index % 20}`,
    priceRange: `${1000 + index} ~ ${2000 + index}`,
    marketingCore: index % 2 ? "信任背书" : "价格促销",
    biggestAdvantage: "信息层级清晰",
    biggestProblem: "场景不足",
    hasGift: index % 2 ? "是" : "否",
    scores: { CP_total: 3 + (index % 3) * 0.5, CN_urgency: index % 5 },
    isOwnBrand: index === 6,
  })),
};
const brandRanking = {
  ranking: Array.from({ length: 10 }, (_, index) => ({
    rank: index + 1,
    brand: `品牌 ${index}`,
    count: 10,
    avgCP: 4 - index * 0.1,
    isOwnBrand: index === 6,
  })),
};
const insights = {
  schools: [{ id: "A", name: "大促爆款派", subtitle: "转化天花板", features: ["价格锚点", "限时窗口"] }],
  ownBrandActions: {
    p0: [{ title: "增加倒计时", action: "加入明确的大促时间窗口" }],
    p1: [{ title: "降低标签噪音", action: "合并同类促销标签" }],
  },
};
const priceSnapshot = {
  period,
  label: period,
  items: [
    { id: "p1", brand: "品牌 1", productName: "价格商品 1", couponPrice: "￥1000", previousPrice: "￥1200", priceChange: "▼ 16.7%", warningStatus: "重点预警" },
    { id: "p2", brand: "品牌 2", productName: "价格商品 2", couponPrice: "￥2000", previousPrice: "-", priceChange: "-", warningStatus: "无变化" },
    { id: "p3", brand: "品牌 3", productName: "价格商品 3", couponPrice: "￥3300", previousPrice: "￥3000", priceChange: "▲ 10.0%", warningStatus: "观察" },
  ],
};

const facts = buildReportFacts({ top100, brandRanking, insights, priceSnapshot });
assert.equal(facts.top100Items.length, 100, "必须使用完整 100 条数据");
assert.equal(facts.top100Items.at(-1).evidenceId, "T100", "证据编号必须覆盖到 T100");
assert.equal(facts.metrics.itemCount, 100);
assert.equal(facts.metrics.priceCount, 3);
assert.equal(facts.metrics.priceBaselineCount, 2, "缺失价格基线不得参与涨跌口径");
assert.equal(facts.metrics.priceAlertCount, 2);
assert.equal(facts.metrics.ownRank, 7, "我方排名必须来自动态品牌数据");

const narrative = createBaselineNarrative(facts);
const html = renderReportHtml(facts, narrative, { provider: "test", model: "fixture", generatedAt: "2026-08-28T00:00:00.000Z" });
const markdown = renderReportMarkdown(facts, narrative, { provider: "test", model: "fixture", generatedAt: "2026-08-28T00:00:00.000Z" });
assert.match(html, /TOP100 · 76—100/, "HTML 必须包含完整 TOP100 末页");
assert.match(html, /T100/, "HTML 必须保留末条证据编号");
assert.match(markdown, /\| 100 \| T100 \|/, "Markdown 必须包含第 100 条");
assert.match(markdown, /P003/, "Markdown 必须包含完整价格快照");
assert.throws(
  () => buildReportFacts({ top100, brandRanking, insights, priceSnapshot: { ...priceSnapshot, period: "2026-08-24" } }),
  /缺少与 TOP100 同周期/,
  "不同周期价格快照必须拒绝",
);
assert.throws(
  () => buildReportFacts({ top100: { ...top100, items: top100.items.slice(0, 99) }, brandRanking, insights, priceSnapshot }),
  /TOP100 数据不完整/,
  "少于 100 条必须拒绝",
);
assert.throws(
  () => renderReportHtml(facts, { ...narrative, findings: [{ ...narrative.findings[0], evidenceIds: ["X999"] }, ...narrative.findings.slice(1)] }),
  /无效证据编号/,
  "无效证据编号必须拒绝",
);

const serverSource = readFileSync(new URL("../server/index.mjs", import.meta.url), "utf8");
assert.match(serverSource, /\/api\/intelligence\/reports\//, "必须提供同源报告下载路由");
assert.match(serverSource, /Content-Disposition/, "下载接口必须设置附件响应头");
assert.doesNotMatch(serverSource, /\/api\/intelligence\/save-report/, "不得保留任意路径报告保存接口");

console.log("intelligence report contract: ok");
