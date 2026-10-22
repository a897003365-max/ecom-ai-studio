// 渠道快照切片 · 行为测试
// 跑法：node --experimental-strip-types scripts/test-channel-snapshot.mjs
// 直接 import selectChannelSnapshot，喂样本钉钉快照，断言切渠道时
// totals/platforms/stores/monthlyOverview/metricTrends/latestComparison 均按渠道联动。
import assert from "node:assert/strict";
import { selectChannelSnapshot } from "../src/utils/channelSnapshot.ts";

function totals(overrides = {}) {
  return {
    exposure: 0, clicks: 0, spend: 0, paidOrders: 0, gmv: 0, netRevenue: 0,
    refund: 0, favorite: 0, addToCart: 0, target: 0, budget: 0, ctr: 0, roi: 0,
    ...overrides,
  };
}

function trends(yoy) {
  const value = { yoy, mom: null };
  return { gmv: value, netRevenue: value, recoveryRate: value, addToCart: value, spend: value, feeRate: value, refund: value, refundRate: value };
}

const snapshot = {
  period: { start: "2026-08-01", end: "2026-08-31" },
  totals: totals({ gmv: 300, netRevenue: 200, spend: 50, refund: 10 }),
  platforms: [
    { platform: "天猫", ...totals({ gmv: 200, netRevenue: 150, spend: 30, refund: 6 }) },
    { platform: "抖音", ...totals({ gmv: 100, netRevenue: 50, spend: 20, refund: 4 }) },
  ],
  stores: [
    { platform: "天猫", store: "麻大师旗舰店", ...totals({ gmv: 200, netRevenue: 150 }) },
    { platform: "抖音", store: "抖音1", ...totals({ gmv: 100, netRevenue: 50 }) },
  ],
  daily: [],
  reporting: {
    dailyPlatforms: [
      { date: "2026-08-01", platform: "天猫", ...totals({ netRevenue: 150, gmv: 200 }) },
      { date: "2026-08-01", platform: "抖音", ...totals({ netRevenue: 50, gmv: 100 }) },
    ],
    monthlyTargetsByPlatform: { "2026-08": { 天猫: 1200, 抖音: 800 } },
    monthlyOverview: {
      month: "2026-08",
      period: { start: "2026-08-01", end: "2026-08-31" },
      metrics: { ...totals({ netRevenue: 200, target: 2000 }), completionRate: 0.1 },
      daily: [{ date: "2026-08-01", totalNetRevenue: 200, channels: [{ platform: "天猫", netRevenue: 150 }, { platform: "抖音", netRevenue: 50 }] }],
      priorYearDaily: [{ date: "2025-08-01", netRevenue: 180 }],
      priorYearDailyChannels: [{ date: "2025-08-01", channels: [{ platform: "天猫", netRevenue: 150 }, { platform: "抖音", netRevenue: 30 }] }],
      source: "test",
    },
    metricTrends: trends(0.5),
    metricTrendsByPlatform: { 天猫: trends(0.2), 抖音: trends(-0.1) },
    latestComparison: {
      asOf: "2026-08-31",
      previousDate: "2026-08-30",
      channels: [
        { level: "channel", platform: "天猫", name: "天猫", netRevenue: 150, netRevenueChange: 0.1, spend: 30, spendChange: null, feeRate: 0.2, feeRateChange: null, refundRate: 0.03, refundRateChange: null },
        { level: "channel", platform: "抖音", name: "抖音", netRevenue: 50, netRevenueChange: -0.2, spend: 20, spendChange: null, feeRate: 0.4, feeRateChange: null, refundRate: 0.04, refundRateChange: null },
      ],
      stores: [
        { level: "store", platform: "天猫", name: "麻大师旗舰店", netRevenue: 150, netRevenueChange: 0.1, spend: 30, spendChange: null, feeRate: 0.2, feeRateChange: null, refundRate: 0.03, refundRateChange: null },
        { level: "store", platform: "抖音", name: "抖音1", netRevenue: 50, netRevenueChange: -0.2, spend: 20, spendChange: null, feeRate: 0.4, feeRateChange: null, refundRate: 0.04, refundRateChange: null },
      ],
    },
  },
};

// 全渠道：原样返回
assert.equal(selectChannelSnapshot(snapshot, "all"), snapshot, "全渠道应原样返回快照");

// 切渠道：绝对值切片
const tmall = selectChannelSnapshot(snapshot, "天猫");
assert.equal(tmall.totals.gmv, 200, "totals 应取该渠道 platform 行");
assert.deepEqual(tmall.platforms.map((item) => item.platform), ["天猫"], "platforms 应过滤到该渠道");
assert.deepEqual(tmall.stores.map((item) => item.store), ["麻大师旗舰店"], "stores 应过滤到该渠道");
assert.equal(tmall.daily[0].netRevenue, 150, "daily 应按渠道重聚合");
assert.equal(tmall.reporting.monthlyOverview.metrics.target, 1200, "月目标应取该渠道目标");

// 切渠道：同比/环比取渠道级 trends（本次修复的核心断言）
assert.equal(tmall.reporting.metricTrends.netRevenue.yoy, 0.2, "同比应取该渠道的 metricTrendsByPlatform 值");
const douyin = selectChannelSnapshot(snapshot, "抖音");
assert.equal(douyin.reporting.metricTrends.netRevenue.yoy, -0.1, "不同渠道的同比应不同");

// 切渠道：最新播报过滤到该渠道
assert.deepEqual(tmall.reporting.latestComparison.channels.map((item) => item.platform), ["天猫"], "最新播报渠道应过滤到所选渠道");
assert.deepEqual(tmall.reporting.latestComparison.stores.map((item) => item.platform), ["天猫"], "最新播报店铺应过滤到所选渠道");

// 渠道无渠道级历史数据：同比显示 “—”，不回退全渠道值
const noHistory = structuredClone(snapshot);
noHistory.platforms.push({ platform: "京东", ...totals({ gmv: 80, netRevenue: 60 }) });
const jd = selectChannelSnapshot(noHistory, "京东");
assert.equal(jd.reporting.metricTrends, undefined, "无渠道级 trends 时不得回退全渠道同比");

// 旧快照（服务端未提供渠道级 trends）：沿用全渠道 trends
const legacy = structuredClone(snapshot);
delete legacy.reporting.metricTrendsByPlatform;
const legacyTmall = selectChannelSnapshot(legacy, "天猫");
assert.equal(legacyTmall.reporting.metricTrends.netRevenue.yoy, 0.5, "旧快照无渠道级数据时应沿用全渠道 trends");

console.log("channel snapshot slicing: ok");
