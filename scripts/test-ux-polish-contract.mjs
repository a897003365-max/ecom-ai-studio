import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  dashboard,
  content,
  images,
  intelligence,
  tasks,
  products,
  settings,
  analytics,
  powerBi,
  monthly,
  topbar,
  toasts,
  tabs,
  styles,
] = await Promise.all([
  read("src/pages/DashboardPage.tsx"),
  read("src/pages/ContentProductionPage.tsx"),
  read("src/pages/ImageProcessingPage.tsx"),
  read("src/pages/IntelligencePage.tsx"),
  read("src/pages/TaskQueuePage.tsx"),
  read("src/pages/ProductManagementPage.tsx"),
  read("src/pages/SettingsPage.tsx"),
  read("src/components/LayeredAnalyticsView.tsx"),
  read("src/components/PowerBiReplica.tsx"),
  read("src/components/MonthlyOverview.tsx"),
  read("src/components/Topbar.tsx"),
  read("src/components/ToastStack.tsx"),
  read("src/components/Tabs.tsx"),
  read("src/styles.css"),
]);

const visibleUi = [dashboard, content, images, intelligence, tasks, products, settings, analytics, powerBi, monthly, topbar, toasts].join("\n");
for (const phrase of [
  "已创建 mock 批次",
  "已更新为 mock 状态",
  "使用 mock 占位预览",
  "已重新读取 mock 任务状态",
  "MVP 阶段使用 mock 店铺列表",
  "共有 12 条 mock 通知",
  "POWERBI LAYOUT REPLICA",
  "1280×720 原始比例",
  "本地源文件 → Polars → DuckDB",
  "沿用原 PBIX",
  "数据来源：共享表格",
  "网页任务写入本地执行队列：/api/",
  "E:/Github/.claude",
  "继承原型",
  "第一阶段",
  "对齐参考看板",
  "join 产品主表",
  "本 pbix",
]) {
  assert.equal(visibleUi.includes(phrase), false, `developer-facing copy remains visible: ${phrase}`);
}

assert.match(dashboard, /汇总生产任务、异常与待确认项/);
assert.match(content, /任务统一进入生产队列/);
assert.match(images, /集中处理需人工确认的图片/);
assert.match(intelligence, /覆盖.*款竞品/);
assert.match(tasks, /集中查看任务进度、异常、产物与人工确认状态/);
assert.match(products, /商品销售、履约、退货与渠道分布/);
assert.match(settings, /管理数据连接、同步计划与内容生产工作流/);
assert.match(settings, /visibleConfigGroups/);
assert.equal(settings.includes("{item.value}"), false, "technical config values should not be rendered as helper copy");
assert.match(toasts, /toast-tone-dot/);
assert.equal(toasts.includes('label="mock"'), false);

assert.match(tabs, /tab-trigger/);
assert.match(styles, /\.card::after/);
assert.match(styles, /\.card:hover::after/);
assert.match(styles, /@keyframes filter-pop/);
assert.match(styles, /\.btn-select\[aria-expanded="true"\]/);
assert.match(styles, /\.tab-trigger::after/);
assert.match(styles, /\.channel-filter:focus-within/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);

console.log("ux polish contract: ok");
