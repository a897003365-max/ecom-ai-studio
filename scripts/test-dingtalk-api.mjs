import assert from "node:assert/strict";
import { buildDingTalkSnapshot, filterDingTalkSnapshot } from "../server/dingtalk-api.mjs";

const snapshot = buildDingTalkSnapshot([
  {
    sheet: "全渠道数据表",
    data: [
      ["月份", "月度回款额", "同比", "站内费用", "站外费用", "总费率", "总完成率"],
      ["7月", 100, 0.2, 10, 2, 0.12, 0.5],
      ["开始日期", "截止日期"],
      ["2024-12-01", "2024-12-02"],
      ["渠道", "GMV", "回款额", "站内费用", "加购人数", "退款金额"],
      ["天猫", 150, 100, 10, 8, 5],
      ["合计", 150, 100, 10, 8, 5],
    ],
  },
  {
    sheet: "天猫旗舰店",
    data: [
      ["日期", "浏览量", "店铺客户数", "GMV", "成功退款金额", "回款（减退款）", "总推广费", "日加购", "站内总推广费", "店铺"],
      [45627, 1000, 120, 600, 40, 560, 90, 30, 50, "麻大师旗舰店"],
      [45628, 700, 80, 400, 40, 360, 70, 20, 40, "麻大师旗舰店"],
    ],
  },
  { sheet: "空白业务表", data: [[], ["说明", "无日期明细"]] },
]);

assert.equal(snapshot.quality.sheetCount, 3);
assert.equal(snapshot.monthly.netRevenue, 100);
assert.equal(snapshot.recordCount, 2);
assert.equal(snapshot.daily[0].date, "2024-12-01");
assert.equal(snapshot.inventory[2].detectedMetricCount, 0);
assert.deepEqual(snapshot.inventory[2].detectedFields, []);

assert.equal(snapshot.reporting.completedThrough, "2024-12-02");
assert.equal(snapshot.reporting.availablePeriod.start, "2024-12-01");
assert.equal(snapshot.reporting.dailyStores.length, 2);

const filtered = filterDingTalkSnapshot(snapshot, { start: "2024-12-02", end: "2024-12-02" });
assert.deepEqual(filtered.period, { start: "2024-12-02", end: "2024-12-02" });
assert.equal(filtered.totals.gmv, 400);
assert.equal(filtered.totals.netRevenue, 360);
assert.equal(filtered.totals.spend, 40, "经营费额应优先使用站内总推广费");
assert.equal(filtered.totals.addToCart, 20, "日加购应纳入加购人数");
assert.equal(filtered.totals.recoveryRate, 0.9);
assert.equal(filtered.totals.refundRate, 0.1);
assert.equal(filtered.totals.feeRate, 40 / 360);
assert.equal(filtered.platforms[0].channelShare, 1);
assert.equal(filtered.stores[0].store, "麻大师旗舰店");
assert.equal(filtered.daily.length, 1);
console.log("dingtalk-api parser: ok");
