// 把 src/data/tmallCompetitorData.ts 中生成的 tmallPricePeriods 导出为服务端价格快照，
// 落盘到 <dataDir>/intelligence/price-snapshots/<period>.json，供 /api/intelligence/price-trend 聚合。
// 之后每次抓取流程把新周期 JSON 追加到同一目录即可积累历史。
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.ECOM_DATA_DIR || join(root, "local-data");
const outDir = join(dataDir, "intelligence", "price-snapshots");

const ts = readFileSync(join(root, "src", "data", "tmallCompetitorData.ts"), "utf8");
const constStart = ts.indexOf("export const tmallPricePeriods");
if (constStart < 0) throw new Error("找不到 tmallPricePeriods 定义");
const arrStart = ts.indexOf("= [", constStart) + 2;
// 用括号配对找数组结束（文件内字符串不含换行，逐字符扫描即可）
let depth = 0;
let arrEnd = -1;
for (let i = arrStart; i < ts.length; i++) {
  const ch = ts[i];
  if (ch === "[") depth += 1;
  else if (ch === "]") {
    depth -= 1;
    if (depth === 0) { arrEnd = i; break; }
  }
}
if (arrStart < 2 || arrEnd < 0) throw new Error("无法定位 tmallPricePeriods 数组边界");
// 生成文件里数据是带引号 key 的纯 JSON，可直接解析
const periods = JSON.parse(ts.slice(arrStart, arrEnd + 1));

mkdirSync(outDir, { recursive: true });
let written = 0;
for (const entry of periods) {
  if (!entry?.period || !Array.isArray(entry.items)) continue;
  writeFileSync(join(outDir, `${entry.period}.json`), JSON.stringify({ period: entry.period, label: entry.label ?? null, items: entry.items.map((it) => ({ ...it, imageFile: null })) }, null, 2) + "\n");
  written += 1;
}
const existing = readdirSync(outDir).filter((f) => f.endsWith(".json")).length;
console.log(`[export-price-snapshots] 写入 ${written} 份快照 → ${outDir}（目录共 ${existing} 份）`);
