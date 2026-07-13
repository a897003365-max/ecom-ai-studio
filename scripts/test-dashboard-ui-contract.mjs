import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const analytics = readFileSync(new URL("../src/pages/AnalyticsPage.tsx", import.meta.url), "utf8");

assert.match(app, /showStoreSelector=\{activePage !== "analytics"\}/, "运营数据看板应单独隐藏顶部店铺选择器");
assert.match(analytics, /data-testid="monthly-overview"/, "页面缺少月度经营概览模块");
assert.match(analytics, /data-testid="channel-revenue-chart"/, "页面缺少渠道月度回款趋势图");
assert.match(analytics, /data-testid="comparison-ticker"/, "页面缺少渠道及店铺日环比滚动播报");
assert.match(analytics, /每日同步计划/, "页面未显示钉钉固定同步计划");
assert.match(analytics, /最近同步/, "页面未显示钉钉最近实际同步时间");
assert.doesNotMatch(analytics, /经营比率趋势/, "旧经营比率趋势模块仍然存在");

console.log("dashboard-ui contract: ok");
