import { readFile } from "node:fs/promises";
import { buildDailyCoreHierarchy, pbixDefaultDailyCoreExpansion } from "../src/components/powerBiDailyCoreHierarchy.ts";

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
assert(replica.includes('data-testid="daily-core-year-toggle"') && replica.includes('data-testid="daily-core-month-toggle"'), "每天核心数据缺少 PBIX 年/月展开折叠按钮");
assert(replica.includes("aria-expanded") && replica.includes("expandedYears") && replica.includes("expandedMonths"), "每天核心数据未维护可访问的年月层级展开状态");
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
const hierarchyRows = [
  { date: "2026-07-01", year: "2026", month: "07月", day: "01", productVisitors: 100, addToCart: 10, payBuyers: 4, promotionCarts: 5, addToCartRate: 0.1, addToCartCost: 60, payAmount: 20_000, paidUnits: 6, conversionRate: 0.04, refundAmount: 2_000, refundRate: 0.1, spend: 300, subsidizedAmount: 15_300, subsidizedFeeRate: 300 / 15_300, storeRank: "10" },
  { date: "2026-07-02", year: "2026", month: "07月", day: "02", productVisitors: 50, addToCart: 5, payBuyers: 1, promotionCarts: 5, addToCartRate: 0.1, addToCartCost: 40, payAmount: 1_000, paidUnits: 1, conversionRate: 0.02, refundAmount: 100, refundRate: 0.1, spend: 200, subsidizedAmount: 765, subsidizedFeeRate: 200 / 765, storeRank: "2" },
];
const multiScopeRows = [
  ...hierarchyRows,
  { ...hierarchyRows[0], date: "2026-06-30", month: "06月", day: "30" },
  { ...hierarchyRows[0], date: "2027-01-01", year: "2027", month: "01月", day: "01" },
];
const defaultExpansion = pbixDefaultDailyCoreExpansion(multiScopeRows);
assert([...defaultExpansion.years].join(",") === "2026,2027", "默认展开态应展开数据中所有年份");
assert([...defaultExpansion.months].join(",") === "2026|07月,2026|06月,2027|01月", "默认展开态应展开数据中所有月份，跨月期间首屏不折叠隐藏");
const singleMonthExpansion = pbixDefaultDailyCoreExpansion(hierarchyRows);
assert([...singleMonthExpansion.years].join(",") === "2026" && [...singleMonthExpansion.months].join(",") === "2026|07月", "单月数据默认应展开该月，保证每日明细首屏可见");
const expandedHierarchy = buildDailyCoreHierarchy(hierarchyRows, new Set(["2026"]), new Set(["2026|07月"]));
assert(expandedHierarchy.length === 2 && expandedHierarchy.every((row) => row.hierarchyLevel === "day"), "PBIX 默认展开状态应只显示日明细，不插入年月小计行");
assert(expandedHierarchy[0].showYear && expandedHierarchy[0].showMonth && !expandedHierarchy[1].showYear && !expandedHierarchy[1].showMonth, "Tabular 年月标签未按 PBIX 层级只在首行显示");
const monthCollapsed = buildDailyCoreHierarchy(hierarchyRows, new Set(["2026"]), new Set());
assert(monthCollapsed.length === 1 && monthCollapsed[0].hierarchyLevel === "month", "折叠月份后未收敛为单个月聚合行");
assert(monthCollapsed[0].productVisitors === 150 && monthCollapsed[0].addToCart === 15 && monthCollapsed[0].addToCartRate === 0.1, "月份折叠行的访客/加购聚合不符合 PBIX");
assert(monthCollapsed[0].addToCartCost === 50 && monthCollapsed[0].conversionRate === 5 / 150, "月份折叠行未使用推广购物车数/支付买家数重算比率");
assert(monthCollapsed[0].storeRank === "2", "月份折叠行未使用 PBIX 数值 MIN 店铺排名");
const yearCollapsed = buildDailyCoreHierarchy(hierarchyRows, new Set(), new Set(["2026|07月"]));
assert(yearCollapsed.length === 1 && yearCollapsed[0].hierarchyLevel === "year", "折叠年度后未收敛为单个年度聚合行");
assert(buildDailyCoreHierarchy([], new Set(), new Set()).length === 0, "空数据层级应保持为空");
assert(types.includes("interface PowerBiDailyCore") && types.includes("dailyCore: PowerBiDailyCore[]"), "前端类型未接入 PBIX 每天核心数据独立数据集");
assert(warehouse.includes("_load_pbix_store_rank_daily") && warehouse.includes('item.name == "00-月表汇总"') && warehouse.includes('required = {"日期", "店铺", "渠道", "店铺排名"}') && warehouse.includes('row.get("店铺排名")'), "每天核心数据未按只读补差方式引用 PBIX Min(00-月表汇总.店铺排名)");
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

// ===== 竞品推广数据页（PBIX section 6 复刻） =====
assert(replica.includes("竞品推广数据") && replica.includes("CompetitorPage"), "缺少竞品推广数据页签或 CompetitorPage 组件");
assert(replica.includes('data-testid="competitor-brand-summary-table"') && replica.includes('data-testid="competitor-brand-channel-table"'), "竞品页缺少品牌汇总/品牌×渠道明细表格标识");
assert(replica.includes("#12239E") && replica.includes("#E66C37") && replica.includes("#E044A7") && replica.includes("#6B007B"), "竞品柱状图缺少 PBIX 渠道配色（关键词/内容营销/全站/人群）");
assert(replica.includes("rgba(214, 69, 80"), "竞品明细表消耗占比数据条未使用 PBIX #D64550 色系");
assert(replica.includes("rgba(0, 235, 207"), "竞品明细表 ROI 数据条未使用 PBIX #00EBCF 色系");
const competitorDetailStart = replica.indexOf('data-testid="competitor-brand-channel-table"');
const competitorDetailEnd = replica.indexOf("</table>", competitorDetailStart);
const competitorDetailMarkup = replica.slice(competitorDetailStart, competitorDetailEnd);
const competitorDetailColumns = ["品牌", "渠道", "消耗(万)", "ROI(公式)", "消耗占比", "展现量(万)", "点击量(万)", "点击率(竞品)", "访问人群成本", "兴趣人群成本", "首购人群成本", "复购人群成本"];
previousColumnIndex = -1;
for (const column of competitorDetailColumns) {
  const columnIndex = competitorDetailMarkup.indexOf(`label="${column}"`);
  assert(columnIndex > previousColumnIndex, `竞品明细表列缺失或顺序不符合 PBIX：${column}`);
  previousColumnIndex = columnIndex;
}
const competitorSummaryStart = replica.indexOf('data-testid="competitor-brand-summary-table"');
const competitorSummaryEnd = replica.indexOf("</table>", competitorSummaryStart);
const competitorSummaryMarkup = replica.slice(competitorSummaryStart, competitorSummaryEnd);
const competitorSummaryColumns = ["品牌", "消耗(万)", "ROI(公式)", "展现量(万)", "点击量(万)", "点击率(竞品)", "成交金额(万)", "访问人群成本", "兴趣人群成本", "首购人群成本", "复购人群成本"];
previousColumnIndex = -1;
for (const column of competitorSummaryColumns) {
  const columnIndex = competitorSummaryMarkup.indexOf(`label="${column}"`);
  assert(columnIndex > previousColumnIndex, `竞品品牌汇总表列缺失或顺序不符合 PBIX：${column}`);
  previousColumnIndex = columnIndex;
}
assert(types.includes("interface PowerBiCompetitorDaily") && types.includes("competitorDaily: PowerBiCompetitorDaily[]"), "前端类型未接入竞品推广数据集 competitorDaily");
assert(warehouse.includes("_build_competitor_daily") && warehouse.includes('"competitorDaily"'), "数仓未生成 competitorDaily 页面数据");
assert(warehouse.includes('_model_view(connection, "14-推广竞品数据")'), "竞品数据未引用 PBIX 14-推广竞品数据 模型视图");
assert(
  warehouse.includes("revenue / nullif(spend, 0) AS roi") &&
    warehouse.includes("clicks / nullif(impressions, 0) AS ctr") &&
    warehouse.includes("spend / nullif(sum(spend) OVER (PARTITION BY period, brand), 0) AS spendShare"),
  "竞品派生字段公式与 TMDL 度量口径不一致（ROI/点击率/消耗占比）",
);
assert(replica.includes("competitorWan") && replica.includes(".toFixed(2)}万"), "竞品数值格式未使用 x.xx万 口径");
assert(replica.includes("pages.competitorDaily ?? []"), "竞品数据未对旧快照做 ?? [] 容错");
assert(styles.includes("pb-competitor-layout") && styles.includes("pb-competitor-brand-chip"), "竞品页缺少 pb-competitor-* 布局与切片器样式");

// ===== 客服每日看板（天猫/京东）契约 =====
assert(replica.includes("客服数据") && replica.includes("CustomerServiceWorkspace"), "缺少客服数据工作区或 CustomerServiceWorkspace");
assert(replica.includes("天猫每日客服") && replica.includes("京东每日客服"), "客服看板缺少天猫/京东子看板切换");
assert(replica.includes("servicePeriodRange") && replica.includes("globalPeriod"), "客服看板未接入全局日期筛选器联动");
assert(replica.includes('data-testid="tmall-service-agent-table"') && replica.includes('data-testid="jd-service-agent-table"'), "客服明细表缺少天猫/京东测试标识");
assert(replica.includes("usePagination(tableRows") && replica.includes(", 10)"), "客服明细表未启用每页 10 行翻页");
assert(replica.includes("pb-chart-tooltip") && replica.includes("tooltipFormat"), "客服趋势图缺少悬停明细 tooltip");
assert(replica.includes("servicePeriodRange") && replica.includes("没有交集"), "客服数据无交集缺少空态文案");
assert(!replica.includes("选择客服日期"), "客服模块不应保留内置日期筛选（应全部联动全局筛选器）");
assert(replica.includes("setSelectedAgent") && replica.includes("is-selected") && replica.includes("已筛选"), "客服明细表缺少点击行联动（选中客服/清除）能力");
assert(replica.includes("previousRangeFor") && replica.includes("较上期环比"), "客服 KPI 缺少较上期环比口径");
assert(replica.includes('data-testid="tmall-service-agent-table"') && replica.indexOf("onClick={() => setSelectedAgent") > -1, "客服明细行缺少点击联动回调");
assert(replica.includes("pb-selected-agent-chip") && replica.includes("is-selected"), "客服联动缺少筛选 chip 或选中行高亮样式类");
assert(replica.includes("unavailable") && replica.includes('value={tile.unavailable ? "—"'), "客服联动 KPI 缺少客服维度占位（unavailable 显示 —）");
assert(replica.includes('"salesAmountWan"') && replica.includes('"inquiryConvRate"') && replica.includes('"inquiryConversionRate"'), "客服整体/客服模式趋势图字段映射缺失");
assert(types.includes("interface PowerBiCustomerService") && types.includes("customerService: PowerBiCustomerService"), "前端类型未接入客服数据 customerService");
assert(warehouse.includes("_build_customer_service") && warehouse.includes('"customerService"'), "数仓未生成 customerService 客服页面数据");
assert(styles.includes("pb-chart-tooltip") && styles.includes("translateX(-50%)"), "客服趋势图 tooltip 缺少本地坐标居中样式");

console.log("powerbi replica contract ok");
