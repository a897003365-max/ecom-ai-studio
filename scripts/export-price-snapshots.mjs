// Build the current API price snapshot from the same data served by the UI.
// Preserve historical files, which can include products outside today's TOP100.
// 多类目：床垫类输出 <period>.json，儿童床垫输出 <period>_儿童床垫.json（与 server 类目后缀口径一致）
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const dataDir = resolve(root, process.env.DATA_DIR || "local-data");
const outDir = join(dataDir, "intelligence", "price-snapshots");

const CATEGORIES = [
  { name: "mattress", tsFile: "tmallCompetitorData.ts", fileSuffix: "" },
  { name: "kids", tsFile: "tmallCompetitorData.kids.ts", fileSuffix: "_儿童床垫" },
];

// 周期键两种形态：采集日期型（2026-09-16 / 2026-08-14_~_2026-08-20）与业务期次（26.10.13（双11预售预热））。
// 两者都会成为快照文件名，必须排除路径分隔符等非法字符。
const PERIOD_KEY = /^(?:\d{4}-\d{2}-\d{2}[\w~-]*|\d{2}\.\d{2}\.\d{2}（[^）]+）)$/;

function indexItems(items) {
  if (!Array.isArray(items)) throw new Error("Snapshot items must be an array");
  const indexed = new Map();
  for (const item of items) {
    if (!item || !/^tmall-\d+$/.test(item.id) || indexed.has(item.id)) {
      throw new Error("Missing, invalid or duplicate product ID");
    }
    indexed.set(item.id, item);
  }
  return indexed;
}

function exportCategory({ name, tsFile, fileSuffix }) {
  const tsPath = join(root, "src", "data", tsFile);
  if (!existsSync(tsPath)) {
    console.log(`[export-price-snapshots] skip ${name}: ${tsFile} not found`);
    return { written: 0, current: null, products: 0 };
  }
  const ts = readFileSync(tsPath, "utf8");
  function readExport(exportName) {
    // Exports are JSON followed by a semicolon; escaped string brackets are data.
    const match = ts.match(new RegExp(`export const ${exportName}[^\\n]*?=\\s*([\\s\\S]*?);(?:\\r?\\n|$)`));
    if (!match) throw new Error(`Missing generated export: ${exportName}`);
    return JSON.parse(match[1]);
  }
  const periods = readExport("tmallPricePeriods");
  const prices = indexItems(readExport("tmallCompetitorPrices"));
  const dataset = readExport("tmallTop100Fallback");
  const current = String(dataset.samplePeriod || "").trim().replace(/[\\/:*?"<>|\s]+/g, "_");
  if (!Array.isArray(periods) || !periods.length || periods[0].period !== current || !dataset.generatedAt) {
    throw new Error(`[${name}] Current price snapshot and TOP100 period do not agree`);
  }
  const seen = new Set();
  for (const entry of periods) {
    if (!PERIOD_KEY.test(entry.period) || seen.has(entry.period)) {
      throw new Error(`[${name}] Invalid or duplicate period: ${entry.period}`);
    }
    seen.add(entry.period);
    const indexed = indexItems(entry.items);
    if (entry.period === current && (indexed.size !== prices.size || !prices.size ||
        [...prices].some(([id, item]) => !indexed.has(id) ||
          indexed.get(id).couponPrice !== item.couponPrice ||
          indexed.get(id).originalPrice !== item.originalPrice))) {
      throw new Error(`[${name}] Current snapshot prices differ from the root price list`);
    }
  }
  // Validate every entry before creating any files.
  mkdirSync(outDir, { recursive: true });
  let written = 0;
  for (const entry of periods) {
    const target = join(outDir, `${entry.period}${fileSuffix}.json`);
    if (entry.period !== current && existsSync(target)) continue;
    const snapshot = { period: entry.period, label: entry.label ?? null,
      generatedAt: dataset.generatedAt, items: entry.items.map((it) => ({ ...it, imageFile: null })) };
    const temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(snapshot, null, 2) + "\n");
    renameSync(temporary, target);
    written += 1;
  }
  return { written, current, products: prices.size };
}

let totalWritten = 0;
for (const category of CATEGORIES) {
  const result = exportCategory(category);
  totalWritten += result.written;
  if (result.current) {
    console.log(`[export-price-snapshots] ${category.name}: wrote ${result.written} snapshots, current ${result.current}: ${result.products} products`);
  }
}
const existing = readdirSync(outDir).filter((f) => f.endsWith(".json")).length;
console.log(`[export-price-snapshots] wrote ${totalWritten} snapshots (${existing} total)`);
