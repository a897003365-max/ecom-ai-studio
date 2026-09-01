import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [main, tableTypography] = await Promise.all([
  readFile(new URL("../src/main.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/styles/table-typography.css", import.meta.url), "utf8"),
]);

assert(tableTypography.includes("--table-font-scale: 1.15"), "表格字号倍率必须固定为 15%");
assert(tableTypography.includes(".data-table th") && tableTypography.includes("12.65px"), "通用表格表头未从 11px 精确放大 15%");
assert(tableTypography.includes(".data-table td") && tableTypography.includes("14.375px"), "通用表格正文未从 12.5px 精确放大 15%");
assert(tableTypography.includes(".pb-data-table") && tableTypography.includes("10.35px"), "PowerBI 表格未从 9px 精确放大 15%");
assert(tableTypography.includes(".exec-channel-table") && tableTypography.includes("10.925px"), "全渠道经营表格未从 9.5px 精确放大 15%");
assert(tableTypography.includes(".product-command table") && tableTypography.includes("12.65px"), "商品经营表格未从 11px 精确放大 15%");
assert(!tableTypography.includes(".card") && !tableTypography.includes(".kpi"), "表格字号覆盖不得修改卡片或 KPI 字体");

const baseStylesIndex = main.indexOf('import "./styles/product-command.css"');
const tableStylesIndex = main.indexOf('import "./styles/table-typography.css"');
assert(baseStylesIndex >= 0 && tableStylesIndex > baseStylesIndex, "表格字号覆盖层必须在现有组件样式后加载");

console.log("table typography contract ok");
