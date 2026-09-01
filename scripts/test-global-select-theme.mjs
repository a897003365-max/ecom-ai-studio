import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../src/components/Sidebar.tsx", import.meta.url), "utf8");
const topbar = readFileSync(new URL("../src/components/Topbar.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/pages/DashboardPage.tsx", import.meta.url), "utf8");

assert.match(tokens, /:root\[data-theme="light"\]\s*\{[^}]*color-scheme:\s*light;/s, "缺少白天模式语义变量");
assert.match(app, /DAY_THEME_START_HOUR\s*=\s*7;/, "白天模式开始时间不是 07:00");
assert.match(app, /DAY_THEME_END_HOUR\s*=\s*19;/, "白天模式结束时间不是 19:00");
assert.match(app, /document\.documentElement\.dataset\.theme\s*=\s*nextTheme;/, "主题未写入根节点");
assert.match(app, /window\.setTimeout\(syncTheme,\s*millisecondsUntilThemeBoundary\(now\)\)/, "主题未在时间边界自动重算");
assert.match(app, /function handleThemeToggle\(\)/, "缺少手动切换白天与夜间模式");
assert.match(sidebar, /跟随系统时间自动切换/, "侧栏未说明主题随系统时间切换");
assert.match(sidebar, /onClick=\{onToggleTheme\}/, "侧栏主题按钮未连接手动切换");
assert.match(topbar, /lg:hidden/, "窄屏缺少可见的主题切换入口");
assert.match(topbar, /onClick=\{onToggleTheme\}/, "顶部主题按钮未连接手动切换");
assert.match(dashboard, /bg-\[var\(--color-surface-feature\)\]/, "工作台主视觉未适配双主题");

assert.match(
  styles,
  /^select\s*\{[^}]*color:\s*var\(--text\);[^}]*color-scheme:\s*dark;/ms,
  "全站 select 未使用深色主题和高对比文字",
);
assert.match(
  styles,
  /select option\s*\{[^}]*background-color:\s*var\(--panel-solid\);[^}]*color:\s*var\(--text\);/s,
  "下拉选项未设置深色背景和高对比文字",
);
assert.match(styles, /select option:checked\s*\{[^}]*color:\s*#f7ffe8;/s, "选中项对比度不足");
assert.match(styles, /select option:disabled\s*\{[^}]*color:\s*var\(--muted\);/s, "禁用项缺少可辨识状态");
assert.match(styles, /:root\[data-theme="light"\]\s+input,[^}]*color-scheme:\s*light;/s, "表单控件未适配白天模式");

console.log("time-based light and dark theme: ok");
