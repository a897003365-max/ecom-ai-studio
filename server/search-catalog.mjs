// 顶部智能找数 · 静态搜索目录
// 只描述「页面区域 / 指标 / 别名 / 定义 / 数据源 / 导航落点」，不含任何运行时数据。
// 经营数值一律来自钉钉权威快照，商品数值来自本地数仓，不由本目录产生。

// 经营页面区域锚点（data-search-anchor，位于 ExecutiveCommerceOverview / PowerBiReplica）
export const ANALYTICS_AREAS = [
  { id: "analytics-top", label: "全渠道经营总览", aliases: ["经营总览", "总览", "经营看板", "全渠道总览", "经营概览"], section: "analytics-top", analyticsView: "layered", workspace: "overview" },
  { id: "analytics-daily-trend", label: "日经营趋势", aliases: ["日趋势", "经营趋势", "日经营", "回款趋势"], section: "analytics-daily-trend", analyticsView: "layered", workspace: "overview" },
  { id: "analytics-revenue-quality", label: "回款质量拆解", aliases: ["回款质量", "回款拆解", "回款质量拆解", "瀑布图"], section: "analytics-revenue-quality", analyticsView: "layered", workspace: "overview" },
  { id: "analytics-channel-quality", label: "渠道贡献与回款质量", aliases: ["渠道贡献", "渠道质量", "渠道回款", "渠道明细"], section: "analytics-channel-quality", analyticsView: "layered", workspace: "overview" },
  { id: "analytics-store-quality", label: "店铺明细与回款质量", aliases: ["店铺明细", "店铺质量", "店铺回款", "店铺经营"], section: "analytics-store-quality", analyticsView: "layered", workspace: "overview" },
  { id: "analytics-category-performance", label: "核心品类销售额", aliases: ["核心品类", "品类销售额", "核心品类销售额", "品类"], section: "analytics-category-performance", analyticsView: "layered", workspace: "overview" },
  { id: "analytics-channel-spend", label: "渠道推广费与费比", aliases: ["渠道推广费", "渠道费比", "推广费明细", "投放费"], section: "analytics-channel-spend", analyticsView: "layered", workspace: "overview" },
  { id: "analytics-funnel", label: "推广漏斗", aliases: ["漏斗", "推广漏斗", "曝光点击", "转化漏斗"], section: "analytics-funnel", analyticsView: "layered", workspace: "overview" },
  { id: "analytics-tmall-overall", label: "旗舰店整体", aliases: ["天猫整体", "旗舰店整体", "天猫明细", "天猫总览"], section: "analytics-tmall-overall", analyticsView: "layered", workspace: "diagnosis", replicaPage: "overall" },
  { id: "analytics-tmall-promotion", label: "推广费用明细", aliases: ["推广费用明细", "天猫推广", "推广费用"], section: "analytics-tmall-promotion", analyticsView: "layered", workspace: "diagnosis", replicaPage: "promotion" },
  { id: "analytics-tmall-product", label: "商品推广费用", aliases: ["商品推广费用", "天猫商品推广", "商品推广"], section: "analytics-tmall-product", analyticsView: "layered", workspace: "diagnosis", replicaPage: "product" },
];

// 商品页面页签锚点（data-search-anchor，位于 ProductManagementPage 页签内容）
export const PRODUCT_AREAS = [
  { id: "products-overview", label: "商品总览", aliases: ["商品总览", "总览", "商品主页"], tab: "overview", section: "products-overview" },
  { id: "products-priority", label: "重点商品数据", aliases: ["重点商品", "重点商品表", "商品明细", "重点商品数据"], tab: "overview", section: "products-priority" },
  { id: "products-gallery", label: "商品画册", aliases: ["商品画册", "画册", "产品画册"], tab: "gallery", section: "products-gallery" },
  { id: "products-channel", label: "渠道质量", aliases: ["渠道质量", "商品渠道", "渠道结构"], tab: "channel", section: "products-channel" },
  { id: "products-trend", label: "销售趋势", aliases: ["销售趋势", "商品趋势", "销售趋势"], tab: "trend", section: "products-trend" },
  { id: "products-returns", label: "退货分析", aliases: ["退货分析", "退款分析", "商品退货", "退货"], tab: "returns", section: "products-returns" },
  { id: "products-fulfillment", label: "仓配履约", aliases: ["仓配履约", "履约", "发货时效", "发货", "仓配"], tab: "fulfillment", section: "products-fulfillment" },
  { id: "products-price", label: "价格结构", aliases: ["价格结构", "价格带", "价格"], tab: "price", section: "products-price" },
  { id: "products-size", label: "尺寸结构", aliases: ["尺寸结构", "尺寸", "尺寸分布"], tab: "size", section: "products-size" },
  { id: "products-custom", label: "定制结构", aliases: ["定制结构", "定制", "定制占比"], tab: "custom", section: "products-custom" },
];

// 其他业务页面（仅页面导航，不参与数值问答）
export const OTHER_PAGES = [
  { id: "dashboard", label: "工作台", aliases: ["首页", "工作台", "dashboard"], page: "dashboard" },
  { id: "assets", label: "商品资产", aliases: ["商品资产", "素材", "资产"], page: "assets" },
  { id: "content", label: "内容生产", aliases: ["内容生产", "文案", "分镜", "内容"], page: "content" },
  { id: "images", label: "图片处理", aliases: ["图片处理", "图片"], page: "images" },
  { id: "intelligence", label: "竞品情报", aliases: ["竞品情报", "竞品", "top100", "情报"], page: "intelligence" },
  { id: "tasks", label: "任务队列", aliases: ["任务队列", "任务", "队列"], page: "tasks" },
  { id: "settings", label: "系统设置", aliases: ["系统设置", "设置"], page: "settings" },
  { id: "access", label: "权限管理", aliases: ["权限管理", "权限", "用户"], page: "access" },
];

// 经营指标（钉钉权威快照）
export const ANALYTICS_METRICS = [
  { id: "analytics.gmv", label: "GMV", aliases: ["GMV", "gmv", "成交额", "成交金额", "经营销售额", "销售额"], unit: "currency", section: "analytics-top", definition: "成交总额（GMV）", source: "dingtalk", read: "gmv" },
  { id: "analytics.net_revenue", label: "净回款", aliases: ["净回款", "回款额", "月累计回款", "回款", "经营回款"], unit: "currency", section: "analytics-top", definition: "扣除退款后的经营回款", source: "dingtalk", read: "netRevenue" },
  { id: "analytics.recovery_rate", label: "回款率", aliases: ["回款率", "回款质量", "回款比例"], unit: "percent", section: "analytics-revenue-quality", definition: "净回款 ÷ GMV", source: "dingtalk", read: "recoveryRate", formula: "netRevenue / gmv" },
  { id: "analytics.spend", label: "站内推广费", aliases: ["站内推广费", "推广费", "费额", "投放费", "站内费额", "推广费用"], unit: "currency", section: "analytics-channel-spend", definition: "站内推广费用", source: "dingtalk", read: "spend" },
  { id: "analytics.fee_rate", label: "费比", aliases: ["费比", "推广费比", "站内费比", "费率", "推广费比"], unit: "percent", section: "analytics-channel-spend", definition: "站内推广费 ÷ 净回款", source: "dingtalk", read: "feeRate", formula: "spend / netRevenue" },
  { id: "analytics.roi", label: "推广 ROI", aliases: ["ROI", "推广ROI", "roi", "投产比"], unit: "ratio", section: "analytics-top", definition: "GMV ÷ 站内推广费", source: "dingtalk", read: "roi", formula: "gmv / spend" },
  { id: "analytics.refund_amount", label: "退款金额", aliases: ["退款金额", "退款额", "经营退款", "退款"], unit: "currency", section: "analytics-top", definition: "成功退款聚合", source: "dingtalk", read: "refund" },
  { id: "analytics.refund_rate", label: "退款率", aliases: ["退款率", "经营退货率", "退货率", "经营退款率"], unit: "percent", section: "analytics-top", definition: "退款金额 ÷ GMV", source: "dingtalk", read: "refundRate", formula: "refund / gmv" },
  { id: "analytics.add_to_cart", label: "加购人数", aliases: ["加购人数", "加购", "加购量"], unit: "integer", section: "analytics-top", definition: "加购人数", source: "dingtalk", read: "addToCart" },
  { id: "analytics.completion_rate", label: "目标完成率", aliases: ["目标完成率", "达成率", "完成率", "目标达成"], unit: "percent", section: "analytics-top", definition: "净回款 ÷ 目标", source: "dingtalk", read: "completionRate", formula: "netRevenue / target" },
];

// 商品指标（本地数仓）
export const PRODUCT_METRICS = [
  { id: "products.received_amount", label: "商家实收", aliases: ["商家实收", "商品回款", "实收", "商品实收"], unit: "currency", tab: "overview", section: "products-priority", definition: "商品口径商家实收", source: "warehouse", read: "receivedAmount", kpi: "totalReceivedAmount" },
  { id: "products.net_sales", label: "净销售额", aliases: ["净销售额", "商品净销售", "净销售"], unit: "currency", tab: "overview", section: "products-priority", definition: "商家实收 − 退货金额", source: "warehouse", read: "netSales", formula: "receivedAmount - refundAmount" },
  { id: "products.sales_units", label: "销量", aliases: ["销量", "销售件数", "销售数量", "件数"], unit: "integer", tab: "overview", section: "products-priority", definition: "销售件数", source: "warehouse", read: "salesUnits" },
  { id: "products.refund_amount", label: "退货金额", aliases: ["退货金额", "商品退款", "商品退货金额", "退款额"], unit: "currency", tab: "returns", section: "products-returns", definition: "商品退货金额", source: "warehouse", read: "refundAmount" },
  { id: "products.refund_rate", label: "商品退货率", aliases: ["商品退货率", "商品退款率", "退货率", "商品退货"], unit: "percent", tab: "returns", section: "products-returns", definition: "退货金额 ÷ 商家实收", source: "warehouse", read: "refundRate" },
  { id: "products.gross_profit", label: "毛利额", aliases: ["毛利额", "总毛利", "商品毛利", "毛利"], unit: "currency", tab: "overview", section: "products-priority", definition: "商品毛利额", source: "warehouse", read: "grossProfit" },
  { id: "products.gross_margin", label: "毛利率", aliases: ["毛利率", "商品毛利率"], unit: "percent", tab: "overview", section: "products-priority", definition: "商品毛利率", source: "warehouse", read: "grossMargin" },
  { id: "products.avg_unit_price", label: "件单价", aliases: ["件单价", "平均件单价", "件均单价"], unit: "currency", tab: "overview", section: "products-priority", definition: "平均件单价", source: "warehouse", read: "avgUnitPrice" },
  { id: "products.shipping_days", label: "平均发货时效", aliases: ["平均发货时效", "发货时效", "发货天数", "发货速度"], unit: "days", tab: "fulfillment", section: "products-fulfillment", definition: "平均发货时效（天）", source: "warehouse", read: "shippingDays", fulfillment: "avgShippingDays" },
  { id: "products.pending_units", label: "待发货件数", aliases: ["待发货件数", "待发货", "pending", "待发货量"], unit: "integer", tab: "fulfillment", section: "products-fulfillment", definition: "待发货件数", source: "warehouse", read: "pendingUnits", kpi: "pendingUnits" },
  { id: "products.custom_rate", label: "定制率", aliases: ["定制率", "定制占比", "定制比例"], unit: "percent", tab: "custom", section: "products-custom", definition: "定制订单占比", source: "warehouse", read: "customRate", kpi: "customRate" },
];

export const ALL_METRICS = [...ANALYTICS_METRICS, ...PRODUCT_METRICS];

// 中文数字与易混字符变体：豆七↔豆7、M52O9↔M5209。
// 查询侧与索引侧使用同一规则，已有的精确匹配行为不受影响。
const VARIANT_CHARS = { 零: "0", 〇: "0", 一: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", o: "0" };

// 归一化键盘（用于匹配阶段忽略空格与常见标点）
export function normalizeTerm(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-_/·：:，,。.、！!？?（）()【】\[\]「」"'“”‘’]/g, "")
    .replace(/[零〇一二两三四五六七八九o]/g, (ch) => VARIANT_CHARS[ch]);
}