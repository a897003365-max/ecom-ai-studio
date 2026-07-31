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
assert(replica.includes("国补后金额(店铺)") && replica.includes("店铺推广费比"), "旗舰店整体页缺少国补后金额或店铺推广费比");
assert(replica.includes("站内推广花费（不含达人）"), "细分推广花费缺少用户可读口径");
assert(replica.includes("pb-business-product-table") && replica.includes("productsById"), "商品经营明细未接入商品图和短名称映射");
assert(replica.includes("merchantCode") && replica.includes("<ProductThumb"), "商品经营明细未展示短名称和商品图片");
assert(replica.includes("国补后金额(万)") && replica.includes("销额占比") && replica.includes("国补后金额同比") && replica.includes("国补后费比"), "商品经营明细缺少国补后金额/销额占比/同比/国补后费比列");
assert(replica.includes("productDailyPriorYear") && replica.includes("priorYearMap"), "商品经营明细未接入去年同期商品数据");
assert(replica.includes("PromotionDailySpendTable") && replica.includes('data-testid="promotion-daily-spend-table"'), "推广费用明细页缺少每日推广费用明细表格");
assert(replica.includes("pb-data-bar") && replica.includes("每日推广费用"), "每日推广费用表格缺少数据条或标题");
assert(replica.includes("useColumnSort") && replica.includes("SortHeader") && replica.includes("th-sort-arrows"), "天猫明细表格缺少升降序排序按钮");
assert(replica.includes("usePagination") && replica.includes("PAGE_SIZE = 15") && replica.includes('data-testid="pb-pagination"'), "天猫明细表格缺少 15 行分页导航");
assert(!replica.includes("slice(-16)") && !replica.includes("slice(0, 30)"), "天猫明细表格仍保留 16/30 行硬截断，与分页冲突");
assert(replica.includes('data-testid="powerbi-daily-core-table"'), "每天核心数据缺少 PBIX 一比一复刻标识");
const dailyCoreStart = replica.indexOf('data-testid="powerbi-daily-core-table"');
const dailyCoreEnd = replica.indexOf("</table>", dailyCoreStart);
const dailyCoreMarkup = replica.slice(dailyCoreStart, dailyCoreEnd);
const dailyCoreColumns = [
  "年度",
  "月份",
  "日",
  "商品访客数",
  "加购人数",
  "加购率",
  "加购成本",
  "支付金额",
  "支付件数",
  "访客转化率",
  "退款金额",
  "退款率",
  "费额",
  "国补后金额(万)",
  "国补后费比",
  "店铺排名",
];
let previousColumnIndex = -1;
for (const column of dailyCoreColumns) {
  const columnIndex = dailyCoreMarkup.indexOf(`label="${column}"`);
  assert(columnIndex > previousColumnIndex, `每天核心数据列缺失或顺序不符合 PBIX：${column}`);
  previousColumnIndex = columnIndex;
}
assert(types.includes("interface PowerBiDailyCore") && types.includes("dailyCore: PowerBiDailyCore[]"), "前端类型未接入 PBIX 每天核心数据独立数据集");
assert(warehouse.includes('summary_view = _model_view(connection, "00-月表汇总")'), "每天核心数据未引用 PBIX 店铺排名来源 00-月表汇总");
assert(warehouse.includes('product_view = _model_view(connection, "07-旗舰店商品销售数据")'), "每天核心数据未引用 PBIX 商品指标来源 07-旗舰店商品销售数据");
assert(warehouse.includes('promotion_view = _model_view(connection, "08-旗舰店推广花费")'), "每天核心数据未引用 PBIX 推广指标来源 08-旗舰店推广花费");
assert(replica.includes("pb-na"), "商品经营明细同比数据不足时缺少兜底样式");
assert(types.includes("productDailyPriorYear"), "PowerBI 页面数据类型缺少去年同期商品聚合");
assert(warehouse.includes("product_daily_prior_year") && warehouse.includes("prior_year_start"), "数仓未生成去年同期商品聚合");
assert(styles.includes("@keyframes pb-kpi-in") && styles.includes("@keyframes pb-row-in"), "天猫明细缺少与总览一致的信息分层动效");
assert(styles.includes("prefers-reduced-motion") && styles.includes(".pb-business-product-table"), "天猫明细动效或商品图表格缺少可访问性样式");
assert(types.includes("powerbiPages"), "前端数据类型缺少 PowerBI 页面数据");
assert(types.includes("taokeSpend"), "PowerBI 日汇总缺少淘客费用字段");
assert(warehouse.includes("_build_powerbi_pages") && warehouse.includes("AS taokeSpend"), "数仓未生成完整 PowerBI 页面聚合数据");

console.log("powerbi replica contract ok");
