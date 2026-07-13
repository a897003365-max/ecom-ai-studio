import assert from "node:assert/strict";
import { buildDingTalkSnapshot, filterDingTalkSnapshot } from "../server/dingtalk-api.mjs";

function rowWithColumns(entries) {
  const row = [];
  for (const [index, value] of entries) row[index] = value;
  return row;
}

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
  {
    sheet: "抖音",
    data: [
      rowWithColumns([
        [0, "日期"], [3, "店铺总GMV"], [4, "成功退款金额"], [5, "店铺总回款（减退款）"], [6, "店铺总推广费"],
        [9, "抖1总销售额"], [11, "抖1直播退款金额"], [13, "抖1商品卡退款金额"], [20, "抖1回款（减退款）"], [24, "抖1总千川费用"],
      ]),
      rowWithColumns([[0, 45627], [3, 300], [4, 60], [5, 240], [6, 80], [9, 180], [11, 20], [13, 10], [20, 150], [24, 40]]),
      rowWithColumns([[0, 45628], [3, 500], [4, 100], [5, 400], [6, 100], [9, 300], [11, 30], [13, 20], [20, 250], [24, 60]]),
    ],
  },
  { sheet: "空白业务表", data: [[], ["说明", "无日期明细"]] },
]);

assert.equal(snapshot.quality.sheetCount, 4);
assert.equal(snapshot.monthly.netRevenue, 100);
assert.equal(snapshot.recordCount, 4);
assert.equal(snapshot.daily[0].date, "2024-12-01");
assert.equal(snapshot.inventory[3].detectedMetricCount, 0);
assert.deepEqual(snapshot.inventory[3].detectedFields, []);

assert.equal(snapshot.reporting.completedThrough, "2024-12-02");
assert.equal(snapshot.reporting.availablePeriod.start, "2024-12-01");
assert.equal(snapshot.reporting.dailyStores.length, 4);

const filtered = filterDingTalkSnapshot(snapshot, { start: "2024-12-02", end: "2024-12-02" });
assert.deepEqual(filtered.period, { start: "2024-12-02", end: "2024-12-02" });
assert.equal(filtered.totals.gmv, 900);
assert.equal(filtered.totals.netRevenue, 760);
assert.equal(filtered.totals.spend, 140, "经营费额应优先使用站内总推广费");
assert.equal(filtered.totals.addToCart, 20, "日加购应纳入加购人数");
assert.equal(filtered.totals.recoveryRate, 760 / 900);
assert.equal(filtered.totals.refundRate, 140 / 900);
assert.equal(filtered.totals.feeRate, 140 / 760);
assert.equal(filtered.platforms.find((item) => item.platform === "抖音").channelShare, 400 / 760);
assert.equal(filtered.stores.find((item) => item.store === "麻大师旗舰店").gmv, 400);
assert.equal(filtered.stores.find((item) => item.store === "抖音1").gmv, 300);
assert.equal(filtered.stores.find((item) => item.store === "抖音1").refund, 50);
assert.equal(filtered.daily.length, 1);
console.log("dingtalk-api parser: ok");
