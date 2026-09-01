// /api/analytics 内存结果缓存
// 解决：productManagementForAnalytics 每次 spawn Python 子进程 ~12.6s 的问题
// 策略：结果缓存 + single-flight（防击穿）+ 新鲜度信号（覆盖进程外同步）+ SWR + 失败保留 lastGood + 启动异步预热
import { latestSnapshot, latestSnapshotMeta, listSyncRuns } from "./storage.mjs";
import {
  buildWarehouseDashboardMetrics,
  queryProductsOnDemand,
  readWarehouseSnapshot,
  warehouseSnapshotMtime,
} from "./warehouse.mjs";
import { filterDingTalkSnapshot } from "./dingtalk-api.mjs";
import { buildDashboardDataStatus } from "./dashboard-status.mjs";

// productManagementForAnalytics 定义在 index.mjs 内部且未导出，这里复刻一份保持行为一致
function sameDatePeriod(left, right) {
  return Boolean(
    left?.start
    && left?.end
    && right?.start
    && right?.end
    && left.start === right.start
    && left.end === right.end,
  );
}

function hasCurrentProductManagementMetrics(productManagement) {
  const kpis = productManagement?.kpis;
  return Boolean(
    kpis
    && typeof kpis === "object"
    && Object.hasOwn(kpis, "totalReceivedAmount")
    && Object.hasOwn(kpis, "collectionRate")
    && !Object.hasOwn(kpis, "totalShippedAmount")
    && !Object.hasOwn(kpis, "totalShippedUnits")
    && Array.isArray(productManagement?.fulfillmentByProduct)
    && productManagement?.monthlyComparison?.currentPeriod
    && Array.isArray(productManagement?.previousDailyTrend),
  );
}

async function productManagementForAnalytics(snapshot, requestedPeriod) {
  const cached = snapshot?.productManagement ?? null;
  if (
    hasCurrentProductManagementMetrics(cached)
    && (!requestedPeriod?.start || !requestedPeriod?.end || sameDatePeriod(cached?.period, requestedPeriod))
  ) {
    return { productManagement: cached, productManagementStatus: cached ? "aligned" : "unavailable" };
  }
  try {
    const onDemand = await queryProductsOnDemand({
      start: requestedPeriod.start,
      end: requestedPeriod.end,
      statuses: [],
    });
    const productManagement = onDemand?.productManagement ?? null;
    const alignedProductManagement = hasCurrentProductManagementMetrics(productManagement)
      && sameDatePeriod(productManagement?.period, requestedPeriod)
      ? productManagement
      : null;
    return {
      productManagement: alignedProductManagement,
      productManagementStatus: alignedProductManagement ? "aligned" : "unavailable",
    };
  } catch {
    return { productManagement: null, productManagementStatus: "unavailable" };
  }
}

const TTL_MS = 10 * 60 * 1000; // 兜底 TTL，主要靠新鲜度信号失效

// key -> entry
// entry = { value, computedAt, fingerprints, inflight, lastGood, lastError, period }
const cache = new Map();

function keyOf(start, end) {
  return `${start || ""}|${end || ""}`;
}

function readFingerprints() {
  // 廉价新鲜度探针：sqlite finished_at（不读 snapshot_json）+ 文件 mtime（不解析 6.6MB）
  return {
    dingtalkFinishedAt: latestSnapshotMeta("dingtalk")?.finishedAt ?? null,
    warehouseMtime: warehouseSnapshotMtime(),
  };
}

function isFresh(entry) {
  if (!entry.value) return false;
  if (Date.now() - entry.computedAt > TTL_MS) return false;
  const fp = readFingerprints();
  return entry.fingerprints.dingtalkFinishedAt === fp.dingtalkFinishedAt
    && entry.fingerprints.warehouseMtime === fp.warehouseMtime;
}

function freshEntry() {
  return { value: null, computedAt: 0, fingerprints: null, inflight: null, lastGood: null, lastError: null, period: null };
}

// 复刻 /api/analytics handler 的完整计算逻辑
async function computeAnalytics(start, end) {
  const dingtalkSnapshotRow = latestSnapshot("dingtalk");
  const dingtalkSnapshot = dingtalkSnapshotRow?.snapshot ?? null;
  const warehouseSnapshot = await readWarehouseSnapshot();
  const dingtalk = dingtalkSnapshot
    ? filterDingTalkSnapshot(dingtalkSnapshot, { start: start || undefined, end: end || undefined })
    : null;
  const requestedPeriod = dingtalk?.period?.start && dingtalk?.period?.end
    ? dingtalk.period
    : {
      start: start || warehouseSnapshot?.powerbiPages?.period?.start,
      end: end || warehouseSnapshot?.powerbiPages?.period?.end,
    };
  const product = await productManagementForAnalytics(warehouseSnapshot, requestedPeriod);
  const warehouse = warehouseSnapshot
    ? {
      ...warehouseSnapshot,
      productManagement: product.productManagement,
      productManagementStatus: product.productManagementStatus,
      dashboard: buildWarehouseDashboardMetrics(warehouseSnapshot, requestedPeriod),
    }
    : null;
  return {
    warehouse,
    feishu: latestSnapshot("feishu")?.snapshot ?? null,
    dingtalk,
    dataStatus: buildDashboardDataStatus({ dingtalk: dingtalkSnapshot, warehouse }),
    history: listSyncRuns(12),
  };
}

function triggerRefresh(key, start, end) {
  const entry = cache.get(key);
  if (!entry || entry.inflight) return entry?.inflight ?? null;
  entry.inflight = (async () => {
    try {
      const value = await computeAnalytics(start, end);
      entry.value = value;
      entry.lastGood = value;
      entry.lastError = null;
      entry.computedAt = Date.now();
      entry.fingerprints = readFingerprints();
      entry.period = { start: start || null, end: end || null };
      return value;
    } catch (error) {
      entry.lastError = error;
      // 计算失败时保留上一份可用数据
      if (entry.lastGood) {
        entry.value = entry.lastGood;
        return entry.lastGood;
      }
      throw error;
    } finally {
      entry.inflight = null;
    }
  })();
  return entry.inflight;
}

export async function getAnalytics(start, end) {
  const key = keyOf(start, end);
  let entry = cache.get(key);
  if (!entry) {
    entry = freshEntry();
    cache.set(key, entry);
  }
  if (entry.value && isFresh(entry)) {
    return { value: entry.value, fromCache: true, stale: false };
  }
  if (entry.value) {
    // stale-while-revalidate：立即返回旧值，后台异步刷新
    triggerRefresh(key, start, end);
    return { value: entry.value, fromCache: true, stale: true };
  }
  // 冷启动：single-flight 等待首次计算
  const value = await triggerRefresh(key, start, end);
  return { value, fromCache: false, stale: false };
}

// 数据更新后调用：标记所有缓存 stale，对已有值后台异步刷新（不阻塞调用方）
export function invalidateAnalyticsCache() {
  for (const [key, entry] of cache.entries()) {
    entry.computedAt = 0;
    if (entry.value && !entry.inflight) {
      triggerRefresh(key, entry.period?.start || undefined, entry.period?.end || undefined);
    }
  }
}

// 启动后异步预热（不阻塞 listen）。命中默认周期（无显式 start/end）
export function prewarmAnalyticsCache() {
  const key = keyOf(undefined, undefined);
  let entry = cache.get(key);
  if (!entry) {
    entry = freshEntry();
    cache.set(key, entry);
  }
  if (!entry.inflight) triggerRefresh(key, undefined, undefined);
}

export function getAnalyticsCacheStats() {
  let hits = 0;
  let stale = 0;
  let cold = 0;
  for (const entry of cache.values()) {
    if (!entry.value) cold++;
    else if (isFresh(entry)) hits++;
    else stale++;
  }
  return { entries: cache.size, fresh: hits, stale, cold };
}
