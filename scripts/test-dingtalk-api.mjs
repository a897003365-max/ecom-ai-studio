import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDingTalkSnapshot, checkDingTalkApi, filterDingTalkSnapshot } from "../server/dingtalk-api.mjs";

assert.deepEqual(checkDingTalkApi().schedule, ["10:00", "12:30", "17:30"], "API 应返回新的每日三次同步计划");
assert.match(
  readFileSync(new URL("./register-dingtalk-schedule.ps1", import.meta.url), "utf8"),
  /\[string\[\]\]\$Times = @\("10:00", "12:30", "17:30"\)/,
  "Windows 计划任务注册脚本应默认创建三个新时间点",
);

function rowWithColumns(entries) {
  const row = [];
  for (const [index, value] of entries) row[index] = value;
  return row;
}

const snapshot = buildDingTalkSnapshot([
  {
    sheet: "全渠道数据表",
    data: [
      ["月份", "月度回款额", "同比", "站内费用", "站外费用", "站内月费率", "站外月费率", "总费率", "总完成率"],
      ["12月", 1560, 0.2, 270, 12, 270 / 1560, 12 / 1560, 282 / 1560, 0.78],
      ["开始日期", "截止日期"],
      ["2024-12-01", "2024-12-02"],
      ["渠道", "GMV", "回款额", "站内费用", "加购人数", "退款金额"],
      ["天猫", 150, 100, 10, 8, 5],
      ["合计", 150, 100, 10, 8, 5],
    ],
  },
  {
    sheet: "销售目标",
    data: [
      ["渠道", "店铺", "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月", "总计"],
      rowWithColumns([[0, "天猫"], [1, "麻大师旗舰店"], [13, 1200], [14, 1200]]),
      rowWithColumns([[0, "抖音"], [1, "抖音1"], [13, 800], [14, 800]]),
      rowWithColumns([[0, "总计"], [1, "总计"], [13, 2000], [14, 2000]]),
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

assert.equal(snapshot.quality.sheetCount, 5);
assert.equal(snapshot.monthly.netRevenue, 1560);
assert.equal(snapshot.recordCount, 4);
assert.equal(snapshot.daily[0].date, "2024-12-01");
assert.equal(snapshot.inventory[4].detectedMetricCount, 0);
assert.deepEqual(snapshot.inventory[4].detectedFields, []);

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
assert.deepEqual(filtered.reporting.monthlyOverview.period, { start: "2024-12-01", end: "2024-12-02" });
assert.equal(filtered.reporting.monthlyOverview.metrics.netRevenue, 1560, "最新月份 MTD 应与全渠道第 3 行回款额对账");
assert.equal(filtered.reporting.monthlyOverview.metrics.priorYearNetRevenue, 1300);
assert.equal(filtered.reporting.monthlyOverview.metrics.onsiteSpend, 270);
assert.equal(filtered.reporting.monthlyOverview.metrics.offsiteSpend, 12);
assert.equal(filtered.reporting.monthlyOverview.metrics.totalFeeRate, 282 / 1560);
assert.equal(filtered.reporting.monthlyOverview.metrics.target, 2000, "月目标应来自销售目标对应月份总计");
assert.equal(filtered.reporting.monthlyOverview.metrics.completionRate, 0.78);
assert.equal(filtered.reporting.monthlyOverview.daily.length, 2);
assert.equal(filtered.reporting.monthlyOverview.daily[1].totalNetRevenue, 760);
assert.equal(filtered.reporting.monthlyOverview.daily[1].channels.find((item) => item.platform === "抖音").netRevenue, 400);
assert.equal(filtered.reporting.latestComparison.asOf, "2024-12-02");
assert.equal(filtered.reporting.latestComparison.previousDate, "2024-12-01");
assert.equal(
  filtered.reporting.latestComparison.channels.find((item) => item.name === "天猫").netRevenueChange,
  360 / 560 - 1,
);
assert.equal(
  filtered.reporting.latestComparison.channels.find((item) => item.name === "抖音").netRevenueChange,
  400 / 240 - 1,
);

const firstDayFiltered = filterDingTalkSnapshot(snapshot, { start: "2024-12-01", end: "2024-12-01" });
assert.deepEqual(firstDayFiltered.reporting.monthlyOverview.period, { start: "2024-12-01", end: "2024-12-01" });
assert.equal(firstDayFiltered.reporting.monthlyOverview.metrics.netRevenue, 800, "历史筛选应按结束日期所在月计算 MTD");
assert.equal(firstDayFiltered.reporting.monthlyOverview.metrics.completionRate, 0.4);

const businessRuleSnapshot = structuredClone(snapshot);
const tmallPlatformRow = businessRuleSnapshot.reporting.dailyPlatforms.find(
  (item) => item.date === "2024-12-02" && item.platform === "天猫",
);
const tmallStoreRow = businessRuleSnapshot.reporting.dailyStores.find(
  (item) => item.date === "2024-12-02" && item.platform === "天猫",
);
businessRuleSnapshot.reporting.dailyPlatforms.push({
  ...tmallPlatformRow,
  platform: "崔氏家具",
  gmv: 100,
  netRevenue: 80,
  spend: 10,
  refund: 20,
});
businessRuleSnapshot.reporting.dailyStores.push({
  ...tmallStoreRow,
  platform: "拼多多",
});
businessRuleSnapshot.reporting.dailyOffsiteSpend = [{ date: "2024-12-02", spend: 12 }];

const businessRuleFiltered = filterDingTalkSnapshot(businessRuleSnapshot, {
  start: "2024-12-02",
  end: "2024-12-02",
});
assert.equal(
  businessRuleFiltered.platforms.some((item) => item.platform === "崔氏家具"),
  false,
  "崔氏家具应并入天猫渠道",
);
assert.equal(businessRuleFiltered.platforms.find((item) => item.platform === "天猫").gmv, 500);
assert.equal(
  businessRuleFiltered.stores.find((item) => item.platform === "天猫" && item.store === "麻大师旗舰店").offsiteSpend,
  12,
);
assert.equal(
  businessRuleFiltered.stores.find((item) => item.platform === "拼多多" && item.store === "麻大师旗舰店").offsiteSpend,
  0,
  "小红书推广费只能归入天猫麻大师旗舰店",
);
console.log("dingtalk-api parser: ok");
