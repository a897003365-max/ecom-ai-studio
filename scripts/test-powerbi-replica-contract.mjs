import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [analyticsPage, replica, types, warehouse, styles] = await Promise.all([
  readFile(new URL("../src/pages/AnalyticsPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/PowerBiReplica.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/types/integration.ts", import.meta.url), "utf8"),
  readFile(new URL("../pipeline/ecom_pipeline/warehouse.py", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
]);

assert(analyticsPage.includes("PowerBiReplica"), "运营数据看板未接入 PowerBI 复刻模块");
assert(replica.includes("全渠道总览") && replica.includes("天猫明细"), "缺少全渠道与天猫一级视图切换");
assert(replica.includes("旗舰店整体") && replica.includes("推广费用明细") && replica.includes("商品推广费用"), "缺少三个 PowerBI 页签");
assert(replica.includes('data-testid="powerbi-replica"'), "缺少 PowerBI 复刻模块测试标识");
assert(replica.includes("经营数据") && replica.includes("钉钉经营口径"), "缺少用户可读的数据口径标识");
assert(replica.includes("国补后金额(店铺)") && replica.includes("店铺推广费比"), "旗舰店整体页缺少国补后金额或店铺推广费比");
assert(replica.includes("站内推广花费（不含达人）"), "细分推广花费缺少用户可读口径");
assert(replica.includes("pb-business-product-table") && replica.includes("productsById"), "商品经营明细未接入商品图和短名称映射");
assert(replica.includes("merchantCode") && replica.includes("<ProductThumb"), "商品经营明细未展示短名称和商品图片");
assert(styles.includes("@keyframes pb-kpi-in") && styles.includes("@keyframes pb-row-in"), "天猫明细缺少与总览一致的信息分层动效");
assert(styles.includes("prefers-reduced-motion") && styles.includes(".pb-business-product-table"), "天猫明细动效或商品图表格缺少可访问性样式");
assert(types.includes("powerbiPages"), "前端数据类型缺少 PowerBI 页面数据");
assert(types.includes("taokeSpend"), "PowerBI 日汇总缺少淘客费用字段");
assert(warehouse.includes("_build_powerbi_pages") && warehouse.includes("AS taokeSpend"), "数仓未生成完整 PowerBI 页面聚合数据");

console.log("powerbi replica contract ok");
