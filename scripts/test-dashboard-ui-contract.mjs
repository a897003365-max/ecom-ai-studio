import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const analytics = readFileSync(new URL("../src/pages/AnalyticsPage.tsx", import.meta.url), "utf8");
const monthlyOverview = readFileSync(new URL("../src/components/MonthlyOverview.tsx", import.meta.url), "utf8");
const revenueChart = readFileSync(new URL("../src/components/ChannelRevenueChart.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

assert.match(app, /showStoreSelector=\{activePage !== "analytics"\}/, "运营数据看板应单独隐藏顶部店铺选择器");
assert.match(analytics, /data-testid="monthly-overview"/, "页面缺少月度经营概览模块");
assert.match(revenueChart, /data-testid="channel-revenue-chart"/, "页面缺少渠道月度回款趋势图");
assert.match(analytics, /data-testid="comparison-ticker"/, "页面缺少渠道及店铺日环比滚动播报");
assert.match(analytics, /每日同步计划/, "页面未显示钉钉固定同步计划");
assert.match(analytics, /最近同步/, "页面未显示钉钉最近实际同步时间");
assert.doesNotMatch(analytics, /月度指标沿用/, "标题仍显示冗余的月度公式依赖说明");
assert.match(analytics, /aria-label="筛选图表渠道"/, "月度概览缺少渠道下拉筛选");
assert.match(analytics, /selectedChannel=/, "渠道筛选未传递到月度图表");
assert.match(revenueChart, /selectedChannel/, "渠道回款图未实现渠道联动");
assert.match(monthlyOverview, /数据来源：共享表格/, "月度概览数据来源文案未更新");
assert.match(styles, /animation:\s*ticker-scroll 144s linear infinite/, "经营播报滚动速度未降低一半");
assert.doesNotMatch(analytics, /经营比率趋势/, "旧经营比率趋势模块仍然存在");

console.log("dashboard-ui contract: ok");
