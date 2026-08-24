import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const topbar = readFileSync(new URL("../src/components/Topbar.tsx", import.meta.url), "utf8");
const globalSearch = readFileSync(new URL("../src/components/GlobalSearch.tsx", import.meta.url), "utf8");
const localApi = readFileSync(new URL("../src/services/localApi.ts", import.meta.url), "utf8");
const searchTypes = readFileSync(new URL("../src/types/search.ts", import.meta.url), "utf8");
const searchHook = readFileSync(new URL("../src/hooks/useSearchTarget.ts", import.meta.url), "utf8");
const analyticsPage = readFileSync(new URL("../src/pages/AnalyticsPage.tsx", import.meta.url), "utf8");
const productPage = readFileSync(new URL("../src/pages/ProductManagementPage.tsx", import.meta.url), "utf8");
const powerBiReplica = readFileSync(new URL("../src/components/PowerBiReplica.tsx", import.meta.url), "utf8");
const executive = readFileSync(new URL("../src/components/ExecutiveCommerceOverview.tsx", import.meta.url), "utf8");
const productCommand = readFileSync(new URL("../src/components/product-management/ProductCommandOverview.tsx", import.meta.url), "utf8");
const priorityTable = readFileSync(new URL("../src/components/product-management/PriorityProductsTable.tsx", import.meta.url), "utf8");
const indexServer = readFileSync(new URL("../server/index.mjs", import.meta.url), "utf8");
const searchService = readFileSync(new URL("../server/search-service.mjs", import.meta.url), "utf8");
const searchCatalog = readFileSync(new URL("../server/search-catalog.mjs", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// --- Topbar 接入 GlobalSearch ---
assert.match(topbar, /GlobalSearch/, "Topbar 未接入 GlobalSearch");
assert.match(topbar, /searchCanData/, "Topbar 缺少数据搜索权限开关");
assert.match(topbar, /searchAllowedPages/, "Topbar 缺少允许导航页面集合");

// --- App 维护并传递 SearchTarget ---
assert.match(app, /const \[searchTarget, setSearchTarget\] = useState<SearchTarget \| null>\(null\)/, "App 未保存一次性 SearchTarget");
assert.match(app, /handleSearchNavigate/, "App 缺少搜索导航处理");
assert.match(app, /setSearchTarget\(\{\s*\.\.\.target,\s*requestId:/s, "App 必须在导航入口为每个 target 注入新 requestId，否则同页面导航无法重触发");
assert.match(app, /searchTarget=\{searchTarget\?\.page === "analytics" \?/, "App 未把搜索目标传给经营页");
assert.match(app, /searchTarget=\{searchTarget\?\.page === "products" \?/, "App 未把搜索目标传给商品页");
assert.match(app, /searchCanData=\{hasPermission\("analytics\.view"\) \|\| hasPermission\("products\.view"\)\}/, "App 未按经营/商品权限开启数据搜索");

// --- /api/search 注册 + 认证 + 权限 ---
assert.match(indexServer, /path === "\/api\/search"/, "server 未注册 /api/search 权限");
assert.match(indexServer, /\["analytics\.view", "products\.view"\]/, "搜索入口权限应为 analytics.view OR products.view");
assert.match(indexServer, /method === "POST" && path === "\/api\/search"/, "缺少 POST /api/search handler");
assert.match(indexServer, /query\.length < 1 \|\| query\.length > 200/, "搜索缺少 1–200 查询长度约束");
assert.match(indexServer, /readJson\(request, 8 \* 1024\)/, "搜索请求体应限 8KB");

// --- 服务纯函数导出 ---
for (const fn of ["normalizeQuery", "parsePeriod", "matchMetrics", "matchEntities", "rankCatalogEntries", "answerFromSnapshots"]) {
  assert.match(searchService, new RegExp(`export function ${fn}\\(`), `search-service 缺少导出纯函数 ${fn}`);
}

// --- suggest 不触发 Python 聚合 ---
assert.doesNotMatch(searchService, /queryProductsOnDemand/, "suggest 路径不应调用 queryProductsOnDemand（Python 聚合）");
assert.doesNotMatch(searchService, /getAnalytics\(/, "搜索服务不应直接调用 /api/analytics 计算");

// --- 商品历史日期 navigate_required 分支 ---
assert.match(searchService, /navigate_required/, "搜索服务缺少 navigate_required 状态");
assert.match(searchService, /isSnapshotPeriod/, "商品历史日期缺少快照周期判断");
assert.match(searchService, /basis === "explicit"/, "商品历史日期应基于显式日期触发");

// --- 多义 SPU 澄清 ---
assert.match(searchService, /spuAmbiguous/, "搜索服务缺少多义 SPU 澄清");

// --- 权限过滤 ---
assert.match(searchService, /allowedAnalytics/, "搜索服务缺少经营权限过滤");
assert.match(searchService, /allowedProducts/, "搜索服务缺少商品权限过滤");

// --- 每个答案含统计周期/定义/来源/更新时间 ---
assert.match(searchTypes, /period: SearchPeriod \| null/, "SearchAnswer 缺少统计周期");
assert.match(searchTypes, /definition: string/, "SearchAnswer 缺少指标定义");
assert.match(searchTypes, /source:/, "SearchAnswer 缺少数据源");
assert.match(searchTypes, /refreshedAt: string \| null/, "SearchAnswer 缺少更新时间");
assert.match(searchTypes, /dataState:/, "SearchAnswer 缺少数据状态");

// --- 锚点存在 ---
const anchors = [
  "analytics-top", "analytics-daily-trend", "analytics-revenue-quality",
  "analytics-channel-quality", "analytics-store-quality", "analytics-category-performance",
  "analytics-channel-spend", "analytics-funnel", "analytics-tmall-overall",
  "analytics-tmall-promotion", "analytics-tmall-product",
  "products-overview", "products-priority", "products-gallery", "products-channel",
  "products-trend", "products-returns", "products-fulfillment", "products-price",
  "products-size", "products-custom",
];
for (const anchor of anchors) {
  const inExecutive = executive.includes(`data-search-anchor="${anchor}"`);
  const inPowerBi = powerBiReplica.includes(`data-search-anchor="${anchor}"`);
  const inProductPage = productPage.includes(`data-search-anchor="${anchor}"`);
  const inPriority = priorityTable.includes(`data-search-anchor="${anchor}"`);
  assert.ok(inExecutive || inPowerBi || inProductPage || inPriority, `缺少 data-search-anchor="${anchor}"`);
}

// --- PowerBiReplica 搜索目标同步 ---
assert.match(powerBiReplica, /searchTarget\?: SearchTarget \| null/, "PowerBiReplica 缺少可选搜索目标属性");
assert.match(powerBiReplica, /targetWorkspace/, "PowerBiReplica 未同步 workspace");
assert.match(powerBiReplica, /targetReplicaPage/, "PowerBiReplica 未同步 ReplicaPage");

// --- PriorityProductsTable 支持自动切页/高亮 ---
assert.match(priorityTable, /focusTarget\?:/, "PriorityProductsTable 缺少焦点目标属性");
assert.match(priorityTable, /data-focus-product=/, "PriorityProductsTable 行缺少定位属性");
assert.match(priorityTable, /search-target-highlight/, "PriorityProductsTable 未使用定位高亮");

// --- useSearchTarget 钩子 ---
assert.match(searchHook, /scrollIntoView/, "useSearchTarget 缺少滚动定位");
assert.match(searchHook, /search-target-highlight/, "useSearchTarget 缺少高亮");
assert.match(searchHook, /prefers-reduced-motion/, "useSearchTarget 未处理 reduced-motion");

// --- 搜索样式与高亮 ---
assert.match(styles, /\.global-search-panel/, "缺少搜索浮层样式");
assert.match(styles, /\.topbar-search-trigger/, "缺少搜索触发框样式");
assert.match(styles, /\.search-target-highlight/, "缺少定位高亮样式");
assert.match(styles, /\.global-search-list/, "缺少搜索结果列表样式");

// --- 空状态示例（三条固定示例） ---
assert.match(globalSearch, /8月天猫退款率/, "搜索空状态缺少示例1");
assert.match(globalSearch, /豆7销量和退货率/, "搜索空状态缺少示例2");
assert.match(globalSearch, /仓配履约在哪里/, "搜索空状态缺少示例3");

// --- package.json 注册 test:global-search ---
assert.match(packageJson.scripts["test:global-search"], /test-global-search-contract/, "package.json 未注册 test:global-search（contract）");
assert.match(packageJson.scripts["test:global-search"], /test-global-search-api/, "package.json 未注册 test:global-search（api）");

console.log("global-search contract: ok");