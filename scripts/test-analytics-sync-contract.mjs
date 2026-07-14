import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDashboardDataStatus } from "../server/dashboard-status.mjs";

const localApi = readFileSync(new URL("../src/services/localApi.ts", import.meta.url), "utf8");
const analytics = readFileSync(new URL("../src/pages/AnalyticsPage.tsx", import.meta.url), "utf8");
const replica = readFileSync(new URL("../src/components/PowerBiReplica.tsx", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/index.mjs", import.meta.url), "utf8");

assert.match(localApi, /syncAnalyticsData/, "前端未提供运营看板全量同步函数");
assert.match(localApi, /\/api\/sync\/analytics/, "全量同步未调用看板同步接口");
assert.match(analytics, /同步数据/, "同步按钮未改为同步数据");
assert.match(analytics, /dashboard-data-status/, "页面未渲染数据完整性状态标识");
assert.match(analytics, /period=\{globalPeriod\}/, "顶部日期范围未传给 PowerBI 诊断视图");
assert.match(replica, /globalPeriod/, "PowerBI 诊断视图未接收全局日期范围");
assert.match(server, /\/api\/sync\/analytics/, "服务端未提供看板全量同步接口");

const complete = buildDashboardDataStatus({
  expectedDate: "2026-07-13",
  dingtalk: { completedThrough: "2026-07-13", quality: { anomalyCount: 0 } },
  warehouse: { periodEnd: "2026-07-13", quality: { status: "healthy", failedFiles: 0 } },
});
assert.equal(complete.tone, "green");
assert.deepEqual(complete.missing, []);

const incomplete = buildDashboardDataStatus({
  expectedDate: "2026-07-13",
  dingtalk: { completedThrough: "2026-07-12", quality: { anomalyCount: 2 } },
  warehouse: { periodEnd: "2026-07-13", quality: { status: "partial", failedFiles: 1 } },
});
assert.equal(incomplete.tone, "orange");
assert.match(incomplete.missing.join("、"), /钉钉/);
assert.match(incomplete.missing.join("、"), /本地数仓/);

console.log("analytics sync contract ok");
