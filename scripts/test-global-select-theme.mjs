import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

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

console.log("global select theme: ok");
