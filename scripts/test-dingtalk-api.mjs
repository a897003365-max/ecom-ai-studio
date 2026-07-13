import assert from "node:assert/strict";
import { buildDingTalkSnapshot } from "../server/dingtalk-api.mjs";

const snapshot = buildDingTalkSnapshot([
  {
    sheet: "全渠道数据表",
    data: [
      ["月份", "月度回款额", "同比", "站内费用", "站外费用", "总费率", "总完成率"],
      ["7月", 100, 0.2, 10, 2, 0.12, 0.5],
      ["渠道", "GMV", "回款额", "站内费用", "加购人数", "退款金额"],
      ["天猫", 150, 100, 10, 8, 5],
      ["合计", 150, 100, 10, 8, 5],
    ],
  },
  {
    sheet: "天猫旗舰店",
    data: [
      ["日期", "浏览量", "店铺客户数", "GMV", "成功退款金额", "回款（减退款）", "总推广费", "加购人数"],
      [45627, 1000, 120, 600, 40, 560, 50, 30],
    ],
  },
  { sheet: "空白业务表", data: [[], ["说明", "无日期明细"]] },
]);

assert.equal(snapshot.quality.sheetCount, 3);
assert.equal(snapshot.monthly.netRevenue, 100);
assert.equal(snapshot.recordCount, 1);
assert.equal(snapshot.daily[0].date, "2024-12-01");
assert.equal(snapshot.inventory[2].detectedMetricCount, 0);
assert.deepEqual(snapshot.inventory[2].detectedFields, []);
console.log("dingtalk-api parser: ok");
