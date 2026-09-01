import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const larkCliScript = join(process.env.APPDATA ?? "", "npm", "node_modules", "@larksuite", "cli", "scripts", "run.js");

function readLocalSourceConfig() {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "local-data", "source-config.json"), "utf8"));
  } catch {
    return {};
  }
}

const sourceConfig = readLocalSourceConfig();
const prSheetUrl = process.env.FEISHU_PR_SHEET_URL || sourceConfig.feishu?.prSheetUrl;
const contentSheetUrl = process.env.FEISHU_CONTENT_SHEET_URL || sourceConfig.feishu?.contentSheetUrl;

const sheetInventory = [
  { workbook: "2026 新媒体PR笔记数据（新）", sheet: "媒介报表", sheetId: "0FUqdI", rows: 200, columns: 27, classification: "dashboard" },
  { workbook: "2026 新媒体PR笔记数据（新）", sheet: "达人谈成合作进度表", sheetId: "1GQzRs", rows: 884, columns: 74, classification: "detail_restricted" },
  { workbook: "2026 新媒体PR笔记数据（新）", sheet: "达人合作笔记发布数据表", sheetId: "2kmRRc", rows: 926, columns: 74, classification: "detail_restricted" },
  { workbook: "2026 新媒体PR笔记数据（新）", sheet: "小红书笔记排期", sheetId: "3VmEgB", rows: 335, columns: 22, classification: "workflow_input" },
  { workbook: "新媒体内容笔记数据", sheet: "内容报表", sheetId: "0uxYCi", rows: 202, columns: 20, classification: "dashboard" },
  { workbook: "新媒体内容笔记数据", sheet: "种草笔记数据表", sheetId: "1FQBmd", rows: 7732, columns: 30, classification: "dashboard_aggregate" },
  { workbook: "新媒体内容笔记数据", sheet: "账号详细表格", sheetId: "2sVuyM", rows: 200, columns: 21, classification: "never_upload_personal" },
];

async function runLark(args, timeout = 45_000) {
  const { stdout } = await execFileAsync(process.execPath, [larkCliScript, ...args], {
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  const payload = JSON.parse(stdout.trim());
  if (!payload.ok) throw new Error(payload.error?.message ?? "Feishu request failed");
  return payload;
}

async function readRange(url, range, valueRenderOption = "UnformattedValue") {
  if (!url) throw new Error("飞书数据源 URL 未配置");
  const args = [
    "sheets", "+read", "--url", url, "--range", range,
    "--value-render-option", valueRenderOption, "--as", "user",
  ];
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const payload = await runLark(args);
      return payload.data?.valueRange?.values ?? [];
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
}

function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const cleaned = value.replace(/,/g, "").replace(/%$/, "").trim();
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return value.trim().endsWith("%") ? parsed / 100 : parsed;
}

function serialDate(value) {
  if (typeof value === "string" && /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(value.trim())) {
    return value.trim().replaceAll("/", "-");
  }
  if (typeof value !== "number") return null;
  return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000).toISOString().slice(0, 10);
}

function addMetric(map, key, row) {
  const normalizedKey = String(key || "未标注").trim() || "未标注";
  const current = map.get(normalizedKey) ?? {
    name: normalizedKey,
    published: 0,
    videoCount: 0,
    imageCount: 0,
    exposure: 0,
    reads: 0,
    interactions48h: 0,
    interactions30d: 0,
    clickRateSum: 0,
    clickRateCount: 0,
  };
  current.published += 1;
  current.videoCount += String(row[8] ?? "").includes("视频") ? 1 : 0;
  current.imageCount += String(row[8] ?? "").includes("图文") ? 1 : 0;
  current.exposure += number(row[19]);
  current.reads += number(row[20]);
  current.interactions48h += number(row[13]) || number(row[9]) + number(row[10]) + number(row[11]) + number(row[12]);
  current.interactions30d += number(row[18]) || number(row[14]) + number(row[15]) + number(row[16]) + number(row[17]);
  if (row[22] !== null && row[22] !== undefined && row[22] !== "") {
    current.clickRateSum += number(row[22]);
    current.clickRateCount += 1;
  }
  map.set(normalizedKey, current);
}

function finalizeMetric(item) {
  const { clickRateSum, clickRateCount, ...safe } = item;
  return {
    ...safe,
    averageClickRate: clickRateCount ? clickRateSum / clickRateCount : 0,
    interactionRate: item.exposure ? item.interactions30d / item.exposure : 0,
  };
}

async function aggregateContentNotes() {
  const byPlatform = new Map();
  const byProduct = new Map();
  const byDate = new Map();
  let processedRows = 0;
  let minDate = null;
  let maxDate = null;

  const chunkSize = 300;
  for (let start = 2; start <= 7732; start += chunkSize) {
    const end = Math.min(7732, start + chunkSize - 1);
    const rows = await readRange(contentSheetUrl, `1FQBmd!A${start}:AA${end}`);
    for (const row of rows) {
      const platform = row[1];
      const product = row[4];
      if (!platform && !product) continue;
      processedRows += 1;
      addMetric(byPlatform, platform, row);
      addMetric(byProduct, product, row);

      const date = serialDate(row[5]);
      if (date) {
        minDate = !minDate || date < minDate ? date : minDate;
        maxDate = !maxDate || date > maxDate ? date : maxDate;
        const current = byDate.get(date) ?? { date, published: 0, exposure: 0, reads: 0, interactions: 0 };
        current.published += 1;
        current.exposure += number(row[19]);
        current.reads += number(row[20]);
        current.interactions += number(row[18]) || number(row[13]);
        byDate.set(date, current);
      }
    }
  }

  const platforms = [...byPlatform.values()].map(finalizeMetric).sort((a, b) => b.published - a.published);
  const products = [...byProduct.values()].map(finalizeMetric).sort((a, b) => b.published - a.published);
  const totals = platforms.reduce((total, item) => ({
    published: total.published + item.published,
    exposure: total.exposure + item.exposure,
    reads: total.reads + item.reads,
    interactions48h: total.interactions48h + item.interactions48h,
    interactions30d: total.interactions30d + item.interactions30d,
  }), { published: 0, exposure: 0, reads: 0, interactions48h: 0, interactions30d: 0 });

  return {
    processedRows,
    period: { start: minDate, end: maxDate },
    totals,
    platforms,
    products: products.slice(0, 20),
    daily: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-90),
  };
}

async function readPrSummary() {
  const rows = await readRange(prSheetUrl, "0FUqdI!A1:U37");
  const periodRow = rows[1] ?? [];
  const overallRow = rows[9] ?? [];
  const monthRow = rows[36] ?? [];
  const productRows = [];
  let platform = "";

  for (let index = 22; index <= 35; index += 1) {
    const row = rows[index] ?? [];
    if (row[0]) platform = String(row[0]).trim();
    const product = String(row[1] ?? "").trim();
    if (!product || product === "合计") continue;
    productRows.push({
      platform: platform || "未标注",
      product,
      negotiated: number(row[2]),
      published: number(row[3]),
      viral: number(row[4]),
      cost: number(row[6]),
      interactions7d: number(row[7]),
      cpe7d: number(row[8]),
      reads: number(row[11]),
    });
  }

  return {
    period: { start: serialDate(periodRow[1]), end: serialDate(periodRow[6]) },
    overall: {
      negotiated: number(overallRow[2]),
      published: number(overallRow[3]),
      viral48h: number(overallRow[4]),
      cost: number(overallRow[5]),
      interactions48h: number(overallRow[6]),
    },
    currentMonth: {
      negotiated: number(monthRow[2]),
      published: number(monthRow[3]),
      viral: number(monthRow[4]),
      cost: number(monthRow[6]),
      interactions7d: number(monthRow[7]),
      cpe7d: number(monthRow[8]),
    },
    products: productRows,
  };
}

export async function checkFeishu() {
  if (!prSheetUrl || !contentSheetUrl) {
    return { available: false, error: "local-data/source-config.json 缺少飞书只读数据源" };
  }
  try {
    const { stdout } = await execFileAsync(process.execPath, [larkCliScript, "--version"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
    return { available: true, version: stdout.trim() };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : "lark-cli unavailable" };
  }
}

export async function syncFeishu() {
  const [content, pr] = await Promise.all([aggregateContentNotes(), readPrSummary()]);
  return {
    source: "feishu_sheets",
    refreshedAt: new Date().toISOString(),
    content,
    pr,
    inventory: sheetInventory,
    privacy: {
      excludedFields: ["手机号", "买家ID", "发布链接中的访问令牌", "账号主页链接", "个人联系方式"],
      persistedLevel: "aggregate_only",
    },
    recordCount: content.processedRows + sheetInventory.reduce((total, sheet) => total + sheet.rows, 0),
  };
}

export { sheetInventory };
