import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/pages/DashboardPage.tsx", import.meta.url), "utf8");

assert.doesNotMatch(app, /\bqueueTasks\b/, "正式模式不能以演示任务初始化或回填任务状态");
assert.match(app, /setTasks\(persisted\)/, "本地任务接口返回后必须以持久化结果替换页面任务");
assert.doesNotMatch(dashboard, /dashboardKpis|dashboardBusinessLines|dataSourceStatuses|systemStatus/, "首页不能展示 Mock KPI、业务状态或数据源状态");
assert.match(dashboard, /暂无已同步任务/, "真实任务为空时应明确提示，而不是填充演示任务");
assert.match(dashboard, /sourcePayload\?\.sources/, "数据源状态必须来自本地服务响应");

console.log("live dashboard contract: ok");
