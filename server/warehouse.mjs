import { existsSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const warehouseRoot = join(projectRoot, "local-data", "warehouse");
const snapshotPath = join(warehouseRoot, "analytics-snapshot.json");
const statePath = join(warehouseRoot, "state.json");
const migrationStatusPath = join(projectRoot, "migration", "power-query-m", "migration-status.json");
const syncScript = join(projectRoot, "pipeline", "sync.py");

let activeSync = null;

function dateInRange(date, start, end) {
  return typeof date === "string" && date >= start && date <= end;
}

function shiftMonth(date, amount) {
  const [year, month, day] = String(date).split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + amount, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const shifted = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay)));
  return shifted.toISOString().slice(0, 10);
}

function rate(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function change(current, previous) {
  return Number.isFinite(previous) && previous !== 0 ? current / previous - 1 : null;
}

function sumRows(rows, fields) {
  const result = Object.fromEntries(fields.map((field) => [field, 0]));
  for (const row of rows) {
    for (const field of fields) result[field] += Number(row?.[field] || 0);
  }
  return result;
}

function aggregateDashboardPeriod(pages, period) {
  const overallRows = (pages?.overallDaily ?? []).filter((row) => dateInRange(row.date, period.start, period.end));
  const productRows = (pages?.productDaily ?? []).filter((row) => dateInRange(row.date, period.start, period.end));
  const promotionRows = (pages?.promotionSceneDaily ?? []).filter((row) => dateInRange(row.date, period.start, period.end));
  const overall = sumRows(overallRows, ["visitors", "addToCart", "payBuyers", "payAmount"]);
  const product = sumRows(productRows, ["payAmount", "paidUnits"]);
  const promotion = sumRows(promotionRows, ["spend", "revenue"]);
  return {
    domains: {
      overall: overallRows.length > 0,
      product: productRows.length > 0,
      promotion: promotionRows.length > 0,
    },
    metrics: {
      visitors: overall.visitors,
      payBuyers: overall.payBuyers,
      addToCart: overall.addToCart,
      paymentConversion: rate(overall.payBuyers, overall.visitors),
      addToCartRate: rate(overall.addToCart, overall.visitors),
      clientAvgPrice: rate(overall.payAmount, overall.payBuyers),
      itemAvgPrice: rate(product.payAmount, product.paidUnits),
      paidUnits: product.paidUnits,
      promotionSpend: promotion.spend,
      promotionRevenue: promotion.revenue,
      promotionRoi: rate(promotion.revenue, promotion.spend),
    },
  };
}

const metricDomains = {
  visitors: "overall",
  payBuyers: "overall",
  addToCart: "overall",
  paymentConversion: "overall",
  addToCartRate: "overall",
  clientAvgPrice: "overall",
  itemAvgPrice: "product",
  paidUnits: "product",
  promotionSpend: "promotion",
  promotionRevenue: "promotion",
  promotionRoi: "promotion",
};

function periodWithinCoverage(period, coverage) {
  return Boolean(
    period?.start
    && period?.end
    && coverage?.start
    && coverage?.end
    && coverage.start <= period.start
    && period.end <= coverage.end,
  );
}

function comparisonTrends(current, previous, priorYear, { previousCovered, priorYearCovered }) {
  return Object.fromEntries(Object.keys(metricDomains).map((key) => {
    const domain = metricDomains[key];
    return [key, {
      mom: previousCovered && previous.domains[domain] ? change(current.metrics[key], previous.metrics[key]) : null,
      yoy: priorYearCovered && priorYear.domains[domain] ? change(current.metrics[key], priorYear.metrics[key]) : null,
    }];
  }));
}

function warehouseCoverage(pages) {
  if (pages?.period?.start && pages?.period?.end) return pages.period;
  const dates = [
    ...(pages?.overallDaily ?? []),
    ...(pages?.productDaily ?? []),
    ...(pages?.promotionSceneDaily ?? []),
  ].map((row) => row?.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  return dates.length ? { start: dates[0], end: dates.at(-1) } : null;
}

export function buildWarehouseDashboardMetrics(snapshot, requestedPeriod = {}) {
  const pages = snapshot?.powerbiPages;
  const coverage = warehouseCoverage(pages);
  const period = {
    start: requestedPeriod.start || coverage?.start || null,
    end: requestedPeriod.end || coverage?.end || null,
  };
  const base = {
    source: "powerbi_local_warehouse",
    coverage,
    period: period.start && period.end ? period : null,
    coverageComplete: periodWithinCoverage(period, coverage),
  };
  if (!pages || !period.start || !period.end || period.start > period.end) {
    return { ...base, partial: false, available: false, domains: null, metrics: null, trends: null };
  }
  const current = aggregateDashboardPeriod(pages, period);
  const available = Object.values(current.domains).some(Boolean);
  if (!available) return { ...base, partial: false, available: false, domains: current.domains, metrics: null, trends: null };

  const previousPeriod = { start: shiftMonth(period.start, -1), end: shiftMonth(period.end, -1) };
  const priorYearPeriod = { start: shiftMonth(period.start, -12), end: shiftMonth(period.end, -12) };
  const previous = aggregateDashboardPeriod(pages, previousPeriod);
  const priorYear = aggregateDashboardPeriod(pages, priorYearPeriod);
  return {
    ...base,
    available: true,
    partial: !base.coverageComplete,
    domains: current.domains,
    metrics: current.metrics,
    trends: comparisonTrends(current, previous, priorYear, {
      previousCovered: periodWithinCoverage(previousPeriod, coverage),
      priorYearCovered: periodWithinCoverage(priorYearPeriod, coverage),
    }),
    comparisons: {
      previousPeriod,
      priorYearPeriod,
    },
  };
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export async function readWarehouseSnapshot() {
  // 内存缓存：按 mtime 复用解析结果，避免每次请求都读+解析 6.6MB JSON。
  // sync 写出新快照后 mtime 变化，下次读取自动失效重解析。
  const mtime = warehouseSnapshotMtime();
  if (mtime && snapshotCache.mtime === mtime && snapshotCache.value !== null) {
    return snapshotCache.value;
  }
  const value = await readJson(snapshotPath, null);
  if (mtime) snapshotCache = { mtime, value };
  return value;
}

// 轻量新鲜度探针：只 stat 文件 mtime，不解析 6.6MB JSON，供缓存校验用
export function warehouseSnapshotMtime() {
  try {
    return statSync(snapshotPath).mtimeMs;
  } catch {
    return null;
  }
}

let snapshotCache = { mtime: null, value: null };

export async function checkWarehouse() {
  const [snapshot, state, migration] = await Promise.all([
    readWarehouseSnapshot(),
    readJson(statePath, { files: {} }),
    readJson(migrationStatusPath, null),
  ]);
  const excludedQueries = new Set((migration?.excludedQueries ?? []).map((item) => item.query));
  const files = Object.values(state?.files ?? {}).filter((item) => !excludedQueries.has(item?.query));
  const partitionCount = files.filter((item) => item?.parquet).length;
  const failedPartitionCount = files.filter((item) => item?.error).length;
  const databasePath = join(warehouseRoot, "ecom.duckdb");
  const databaseSize = existsSync(databasePath) ? (await stat(databasePath)).size : 0;
  return {
    configured: existsSync(syncScript),
    available: Boolean(snapshot && existsSync(databasePath)),
    syncing: Boolean(activeSync),
    snapshot,
    partitionCount,
    failedPartitionCount,
    queryCount: migration?.queryCount ?? 0,
    completedQueries: migration?.completedQueries ?? 0,
    sourceFileCount: migration?.sourceFileCount ?? 0,
    rowCount: migration?.rowCount ?? 0,
    databaseSize,
    databasePath,
    snapshotPath,
  };
}

async function executeSync() {
  const python = process.env.PYTHON || "python";
  const { stdout } = await execFileAsync(python, [syncScript, "sync"], {
    cwd: projectRoot,
    timeout: 60 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  const result = JSON.parse(stdout);
  if (!result.ok) throw new Error("本地数仓同步完成，但 PowerBI 独有数据目录为空");
  const snapshot = await readWarehouseSnapshot();
  if (!snapshot) throw new Error("本地数仓未生成 analytics-snapshot.json");
  return { ...snapshot, syncSummary: result };
}

export async function syncWarehouse() {
  if (!activeSync) {
    activeSync = executeSync().finally(() => {
      activeSync = null;
    });
  }
  return activeSync;
}

async function runQueryProductsOnDemand({ start, end, statuses, channels, storeShortNames }) {
  const python = process.env.PYTHON || "python";
  const args = [syncScript, "query-products"];
  if (start) args.push("--start", start);
  if (end) args.push("--end", end);
  for (const status of statuses ?? []) args.push("--status", status);
  for (const channel of channels ?? []) args.push("--channel", channel);
  for (const storeShortName of storeShortNames ?? []) args.push("--store-short-name", storeShortName);
  const { stdout } = await execFileAsync(python, args, {
    cwd: projectRoot,
    timeout: 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  return JSON.parse(stdout);
}

// 按需查询结果缓存：相同筛选 + 快照未变时直接复用，避免重复 spawn Python（~12.6s/次）。
// single-flight 防并发击穿；mtime 变化（sync 后）自动失效。
const productQueryCache = new Map();

function productQueryKey({ start, end, statuses, channels, storeShortNames }) {
  const s = [...(statuses ?? [])].sort().join(",");
  const c = [...(channels ?? [])].sort().join(",");
  const st = [...(storeShortNames ?? [])].sort().join(",");
  return `${start || ""}|${end || ""}|${s}|${c}|${st}`;
}

export async function queryProductsOnDemand(opts) {
  const key = productQueryKey(opts);
  const mtime = warehouseSnapshotMtime();
  const entry = productQueryCache.get(key);
  if (entry && entry.mtime === mtime && entry.value) {
    return entry.value;
  }
  // 同一 key + 同一 mtime 下进行中的查询复用，避免并发重复 spawn
  if (entry?.inflight && entry.inflightMtime === mtime) {
    return entry.inflight;
  }
  const inflight = runQueryProductsOnDemand(opts)
    .then((value) => {
      productQueryCache.set(key, { value, mtime, inflight: null, inflightMtime: null });
      return value;
    })
    .catch((error) => {
      const current = productQueryCache.get(key);
      if (current) current.inflight = null;
      throw error;
    });
  const existing = productQueryCache.get(key);
  if (existing) {
    existing.inflight = inflight;
    existing.inflightMtime = mtime;
  } else {
    productQueryCache.set(key, { value: null, mtime: null, inflight, inflightMtime: mtime });
  }
  return inflight;
}
