import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDingTalkSnapshot, checkDingTalkApi, filterDingTalkSnapshot } from "../server/dingtalk-api.mjs";

assert.deepEqual(checkDingTalkApi().schedule, ["10:30", "13:00", "17:30"], "API 应返回新的每日三次同步计划");
assert.match(
  readFileSync(new URL("./register-dingtalk-schedule.ps1", import.meta.url), "utf8"),
  /\$Times = @\("10:30", "13:00", "17:30"\)/,
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
      rowWithColumns([[13, 45627]]),
      rowWithColumns([[13, 45657]]),
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
assert.deepEqual(
  snapshot.reporting.monthlyTargets,
  { "2024-12": 2000 },
  "销售目标必须绑定目标表日期行中的年份，不得只按月份复用到其他年份",
);

const filtered = filterDingTalkSnapshot(snapshot, { start: "2024-12-02", end: "2024-12-02" });
assert.deepEqual(filtered.period, { start: "2024-12-02", end: "2024-12-02" });
assert.equal(filtered.totals.gmv, 900);
assert.equal(filtered.totals.netRevenue, 760);
assert.equal(filtered.totals.spend, 140, "经营费额应优先使用站内总推广费");
assert.equal(filtered.totals.addToCart, 20, "日加购应纳入加购人数");
assert.equal(filtered.totals.recoveryRate, 760 / 900);
assert.equal(filtered.totals.refundRate, 140 / 900);
assert.equal(filtered.totals.feeRate, 140 / 760);
assert.equal(filtered.platforms.find((item) => item.platform === "抖音").channelShare, 500 / 900, "渠道占比应使用 GMV 口径");
assert.equal(filtered.stores.find((item) => item.store === "麻大师旗舰店").gmv, 400);
assert.equal(filtered.stores.find((item) => item.store === "抖音1").gmv, 300);
assert.equal(filtered.stores.find((item) => item.store === "抖音1").refund, 50);
assert.equal(
  filtered.stores.find((item) => item.store === "抖音1").netRevenueYoy,
  null,
  "原始快照无去年同期数据时店铺净回款同比应为 null",
);
assert.equal(filtered.daily.length, 1);
assert.equal(filtered.reporting.dailyPlatforms.length, 2, "筛选后应暴露 dailyPlatforms 供前端按渠道切分日趋势");
assert.equal(filtered.reporting.dailyPlatforms.find((item) => item.platform === "天猫").exposure, 700, "dailyPlatforms 应携带曝光过程指标");
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

const priorRhythmSnapshot = structuredClone(snapshot);
const priorBaseRow = priorRhythmSnapshot.reporting.dailyPlatforms[0];
priorRhythmSnapshot.reporting.dailyPlatforms.push(
  { ...priorBaseRow, date: "2023-12-01", netRevenue: 100 },
  { ...priorBaseRow, date: "2023-12-02", netRevenue: 200 },
);
const priorRhythmFiltered = filterDingTalkSnapshot(priorRhythmSnapshot, { start: "2024-12-01", end: "2024-12-02" });
assert.equal(priorRhythmFiltered.reporting.monthlyOverview.priorYearDaily.length, 31, "应返回去年同期完整月的逐日回款节奏");
assert.equal(priorRhythmFiltered.reporting.monthlyOverview.priorYearDaily[0].netRevenue, 100);
assert.equal(priorRhythmFiltered.reporting.monthlyOverview.priorYearDaily[1].netRevenue, 200);
assert.equal(priorRhythmFiltered.reporting.monthlyOverview.priorYearFullMonthNetRevenue, 300);

// 渠道级月度目标 + 去年同期逐日渠道拆分：切渠道时目标进度带跟随的依据
assert.ok(filtered.reporting.monthlyTargetsByPlatform, "应暴露渠道级月度目标 monthlyTargetsByPlatform");
assert.equal(filtered.reporting.monthlyTargetsByPlatform["2024-12"]?.天猫, 1200, "天猫当月目标应来自销售目标表该渠道行");
assert.equal(filtered.reporting.monthlyTargetsByPlatform["2024-12"]?.抖音, 800, "抖音当月目标应来自销售目标表该渠道行");
assert.ok(priorRhythmFiltered.reporting.monthlyOverview.priorYearDailyChannels, "应产出 priorYearDailyChannels 供前端切渠道");
assert.equal(priorRhythmFiltered.reporting.monthlyOverview.priorYearDailyChannels.length, 31, "priorYearDailyChannels 应覆盖去年同期完整月");
assert.equal(
  priorRhythmFiltered.reporting.monthlyOverview.priorYearDailyChannels[0].channels.reduce((sum, item) => sum + item.netRevenue, 0),
  100,
  "去年同期首日渠道合计应与全渠道 priorYearDaily 一致",
);
const priorDayChannel = priorRhythmFiltered.reporting.monthlyOverview.priorYearDailyChannels[0].channels.find((item) => item.netRevenue > 0);
assert.ok(priorDayChannel, "去年同期首日应存在有回款的渠道行");
assert.equal(priorDayChannel.netRevenue, 100, "去年同期首日该渠道回款应为 100");

// 店铺级净回款同比：有去年同期 dailyStores 时按平台+店铺计算，无则 null
const storeYoySnapshot = structuredClone(snapshot);
const storeYoyBaseRow = storeYoySnapshot.reporting.dailyStores.find((row) => row.store === "麻大师旗舰店");
storeYoySnapshot.reporting.dailyStores.push(
  { ...storeYoyBaseRow, date: "2023-12-01", gmv: 500, netRevenue: 180 },
  { ...storeYoyBaseRow, date: "2023-12-02", gmv: 200, netRevenue: 100 },
);
const storeYoyFiltered = filterDingTalkSnapshot(storeYoySnapshot, { start: "2024-12-01", end: "2024-12-02" });
assert.equal(
  storeYoyFiltered.stores.find((item) => item.store === "麻大师旗舰店").netRevenueYoy,
  920 / 280 - 1,
  "有去年同期数据时店铺净回款同比应按净回款口径计算",
);
assert.equal(
  storeYoyFiltered.stores.find((item) => item.store === "抖音1").netRevenueYoy,
  null,
  "无去年同期数据的店铺净回款同比应为 null",
);

assert.equal(filtered.reporting.monthlyAchievement.length, 12, "逐月销售达成应返回连续 12 个月");
assert.equal(
  filtered.reporting.monthlyAchievement.at(0).target,
  0,
  "未提供目标的历史月份不得套用其他年份的同月目标",
);
assert.deepEqual(
  filtered.reporting.monthlyAchievement.at(-1),
  { month: "2024-12", netRevenue: 1560, target: 2000, completionRate: 0.78 },
);

const legacyTargetSnapshot = structuredClone(snapshot);
legacyTargetSnapshot.reporting.monthlyTargets = { "11": 1000, "12": 2000 };
const legacyTargetFiltered = filterDingTalkSnapshot(legacyTargetSnapshot, {
  start: "2024-12-01",
  end: "2024-12-02",
});
assert.equal(
  legacyTargetFiltered.reporting.monthlyAchievement.find((item) => item.month === "2024-11")?.target,
  1000,
  "旧快照的月份键应仅映射到快照完整数据日所属年度，保证当前年度折线连续",
);
assert.equal(
  legacyTargetFiltered.reporting.monthlyAchievement.find((item) => item.month === "2024-10")?.target,
  0,
  "旧快照没有提供的月份不得补造目标",
);
assert.equal(filtered.reporting.metricTrends.netRevenue.yoy, null, "没有去年同期数据时不得生成随机同比");
assert.equal(filtered.reporting.metricTrends.netRevenue.mom, null, "没有上月同期数据时不得生成随机环比");
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

const staleMonthlySnapshot = structuredClone(snapshot);
staleMonthlySnapshot.period.end = "2024-12-01";
staleMonthlySnapshot.monthly.netRevenue = 1500;
const latestDefaultFiltered = filterDingTalkSnapshot(staleMonthlySnapshot);
assert.equal(latestDefaultFiltered.period.end, "2024-12-02", "默认日期范围应跟随最新完整日期");
const latestDetailFiltered = filterDingTalkSnapshot(staleMonthlySnapshot, {
  start: "2024-12-01",
  end: "2024-12-02",
});
assert.equal(
  latestDetailFiltered.reporting.monthlyOverview.metrics.netRevenue,
  1560,
  "汇总行截止日落后时，MTD 应包含最新逐日明细",
);

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
