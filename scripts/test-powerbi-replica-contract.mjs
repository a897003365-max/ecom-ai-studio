import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [analyticsPage, replica, types, warehouse] = await Promise.all([
  readFile(new URL("../src/pages/AnalyticsPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/PowerBiReplica.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/types/integration.ts", import.meta.url), "utf8"),
  readFile(new URL("../pipeline/ecom_pipeline/warehouse.py", import.meta.url), "utf8"),
]);

assert(analyticsPage.includes("PowerBiReplica"), "运营数据看板未接入 PowerBI 复刻模块");
assert(replica.includes("经营概览") && replica.includes("增长诊断"), "缺少一级视图切换");
assert(replica.includes("旗舰店整体") && replica.includes("推广费用明细") && replica.includes("商品推广费用"), "缺少三个 PowerBI 页签");
assert(replica.includes('data-testid="powerbi-replica"'), "缺少 PowerBI 复刻模块测试标识");
assert(replica.includes("PowerBI 本地逻辑") && replica.includes("钉钉经营口径"), "缺少数据来源标识");
assert(types.includes("powerbiPages"), "前端数据类型缺少 PowerBI 页面数据");
assert(warehouse.includes("_build_powerbi_pages"), "数仓未生成 PowerBI 页面聚合数据");

console.log("powerbi replica contract ok");
