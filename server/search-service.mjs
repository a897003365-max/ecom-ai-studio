// 顶部智能找数 · 搜索服务
// 职责：查询标准化、日期解析、实体索引、匹配、回答、权限过滤。
// 原则：经营数值来自钉钉快照，商品数值来自本地数仓，不由文本检索或大模型生成。
// 本模块不启动 Python 聚合、不调用 /api/analytics、/api/products，不写查询日志。

import {
  ANALYTICS_AREAS,
  PRODUCT_AREAS,
  OTHER_PAGES,
  ALL_METRICS,
  normalizeTerm,
} from "./search-catalog.mjs";
import { filterDingTalkSnapshot } from "./dingtalk-api.mjs";

// ---------------------------------------------------------------------------
// 纯函数：查询标准化
// ---------------------------------------------------------------------------

export function normalizeQuery(raw) {
  return normalizeTerm(raw);
}

// ---------------------------------------------------------------------------
// 日期工具（全部按 Asia/Shanghai 语义，以 completedThrough 为锚）
// ---------------------------------------------------------------------------

function pad(value) {
  return String(value).padStart(2, "0");
}

function shiftDay(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function endOfMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function shiftMonth(date, amount) {
  const [year, month, day] = String(date).split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + amount, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const value = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay)));
  return value.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 纯函数：日期解析
// ---------------------------------------------------------------------------

export function parsePeriod(query, ctx = {}) {
  const completedThrough = ctx.completedThrough; // YYYY-MM-DD
  if (!completedThrough) return null;
  const latestDate = completedThrough;
  const latestYear = latestDate.slice(0, 4);

  // 近 N 天
  const recent = query.match(/近\s*(\d{1,3})\s*天/);
  if (recent) {
    const days = Math.max(1, Number(recent[1]));
    const end = latestDate;
    const start = shiftDay(end, -(days - 1));
    return { start, end, label: `近${days}天`, basis: "explicit" };
  }

  // 本月 / 上月（含口语：这个月 / 上个月）
  if (/本月|这个月/.test(query)) {
    return { start: `${latestDate.slice(0, 7)}-01`, end: latestDate, label: `本月（${latestDate.slice(0, 7)}）`, basis: "explicit" };
  }
  if (/上月|上个月/.test(query)) {
    const prevMonth = shiftMonth(`${latestDate.slice(0, 7)}-01`, -1).slice(0, 7);
    return { start: `${prevMonth}-01`, end: endOfMonth(prevMonth), label: `上月（${prevMonth}）`, basis: "explicit" };
  }

  // 本周 / 上周（周一为一周起点，以最新完整数据日为锚）
  if (/本周|这周/.test(query)) {
    const mondayOffset = (new Date(`${latestDate}T00:00:00Z`).getUTCDay() + 6) % 7;
    const start = shiftDay(latestDate, -mondayOffset);
    return { start, end: latestDate, label: `本周（${start} 至 ${latestDate}）`, basis: "explicit" };
  }
  if (/上周/.test(query)) {
    const mondayOffset = (new Date(`${latestDate}T00:00:00Z`).getUTCDay() + 6) % 7;
    const end = shiftDay(latestDate, -mondayOffset - 1);
    const start = shiftDay(end, -6);
    return { start, end, label: `上周（${start} 至 ${end}）`, basis: "explicit" };
  }

  // 今天 / 昨天：数据为 T-1 口径，统一落到最新完整数据日并在标签明示实际日期
  if (/今天|今日|昨天|昨日|最新完整日|最新/.test(query)) {
    return { start: latestDate, end: latestDate, label: `最新完整数据日（${latestDate}）`, basis: "latest_complete" };
  }
  if (/前天/.test(query)) {
    const day = shiftDay(latestDate, -1);
    return { start: day, end: day, label: `前天（${day}）`, basis: "explicit" };
  }

  // 月日到月日：8月1日到8月31日
  const range = query.match(/(\d{1,2})月(\d{1,2})[日号]?\s*到\s*(\d{1,2})月(\d{1,2})[日号]/);
  if (range) {
    const [, ms, ds, me, de] = range;
    const start = `${latestYear}-${pad(ms)}-${pad(ds)}`;
    const end = `${latestYear}-${pad(me)}-${pad(de)}`;
    return { start, end, label: `${start} 至 ${end}`, basis: "explicit" };
  }

  // 中文完整日期：2026年8月1日
  const cnFullDate = query.match(/(20\d{2})年(\d{1,2})月(\d{1,2})[日号]/);
  if (cnFullDate) {
    const start = `${cnFullDate[1]}-${pad(cnFullDate[2])}-${pad(cnFullDate[3])}`;
    return { start, end: start, label: start, basis: "explicit" };
  }

  // YYYY-MM-DD / YYYY年M月D日 / YYYY.MM.DD / YYYY/MM/DD
  const fullDate = query.match(/(20\d{2})[年\-/.](\d{1,2})月?[\-/.](?:(\d{1,2})日?)?/);
  if (fullDate && fullDate[3]) {
    const start = `${fullDate[1]}-${pad(fullDate[2])}-${pad(fullDate[3])}`;
    return { start, end: start, label: start, basis: "explicit" };
  }

  // YYYY-MM / YYYY年M月
  const yearMonth = query.match(/(20\d{2})[年\-/.](\d{1,2})月?/);
  if (yearMonth) {
    const start = `${yearMonth[1]}-${pad(yearMonth[2])}-01`;
    const monthEnd = endOfMonth(start.slice(0, 7));
    const end = latestDate < monthEnd ? latestDate : monthEnd;
    return { start, end: end >= start ? end : start, label: `${yearMonth[1]}年${Number(yearMonth[2])}月`, basis: "explicit" };
  }

  // 单日：8月1日 / 8月1号（未写年份，用 completedThrough 所在年份），不再静默扩成整月
  const singleDay = query.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (singleDay) {
    const start = `${latestYear}-${pad(singleDay[1])}-${pad(singleDay[2])}`;
    return { start, end: start, label: start, basis: "explicit" };
  }

  // 中文月份：八月 / 十一月（未写年份，用 completedThrough 所在年份）
  const cnMonth = query.match(/(十一|十二|十|[一二三四五六七八九])月/);
  if (cnMonth) {
    const CN_MONTH = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
    const monthNumber = CN_MONTH[cnMonth[1]];
    const start = `${latestYear}-${pad(monthNumber)}-01`;
    const monthEnd = endOfMonth(start.slice(0, 7));
    const end = latestDate < monthEnd ? latestDate : monthEnd;
    return { start, end: end >= start ? end : start, label: `${latestYear}年${monthNumber}月`, basis: "explicit" };
  }

  // M月（未写年份，用 completedThrough 所在年份）
  const month = query.match(/(\d{1,2})月/);
  if (month) {
    const start = `${latestYear}-${pad(month[1])}-01`;
    const monthEnd = endOfMonth(start.slice(0, 7));
    const end = latestDate < monthEnd ? latestDate : monthEnd;
    return { start, end: end >= start ? end : start, label: `${latestYear}年${Number(month[1])}月`, basis: "explicit" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 通用匹配与打分
// ---------------------------------------------------------------------------

function scoreCandidate(query, candidate) {
  const q = normalizeTerm(query);
  const name = normalizeTerm(candidate.label);
  if (q === name) return 100;
  const aliases = (candidate.aliases ?? []).map(normalizeTerm);
  if (aliases.includes(q)) return 95;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  if (q.includes(name)) return 55;
  // 查询包含某个完整别名（如「豆7销量和退货率」含「退货率」）
  for (const alias of aliases) {
    if (alias && q.includes(alias)) return 55;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// 纯函数：指标匹配
// ---------------------------------------------------------------------------

// 返回该指标命中的最长名称/别名（用于「退款」命中「退款率」时按更具体者优先）
function longestMatchedTerm(q, candidate) {
  let best = null;
  for (const term of [candidate.label, ...(candidate.aliases ?? [])]) {
    const t = normalizeTerm(term);
    if (!t) continue;
    if (q === t) return t;
    if (t.startsWith(q) || q.includes(t)) {
      if (!best || t.length > best.length) best = t;
    }
  }
  return best;
}

export function matchMetrics(query) {
  const q = normalizeTerm(query);
  if (!q) return [];
  const scored = [];
  for (const metric of ALL_METRICS) {
    const score = scoreCandidate(query, metric);
    if (score > 0) scored.push({ metric, score, matchedTerm: longestMatchedTerm(q, metric) });
  }
  // 分数降序，命中词长降序（更具体的指标优先）
  scored.sort((a, b) => b.score - a.score || (b.matchedTerm?.length ?? 0) - (a.matchedTerm?.length ?? 0));
  // 前缀遮蔽去重：A 的命中词是 B 命中词的严格前缀时丢弃 A（如「退款」遮蔽于「退款率」）
  return scored.filter((item) => !scored.some((other) => other !== item
    && other.metric.id !== item.metric.id
    && (other.matchedTerm?.length ?? 0) > (item.matchedTerm?.length ?? 0)
    && (other.matchedTerm ?? "").startsWith(item.matchedTerm ?? "")));
}

// ---------------------------------------------------------------------------
// 纯函数：实体索引与匹配
// ---------------------------------------------------------------------------

export function buildEntityIndex({ dingtalk, warehouse }) {
  const channels = new Map();
  const stores = new Map();
  const products = new Map();
  const spus = new Map();
  const skus = new Map();

  for (const platform of dingtalk?.platforms ?? []) {
    const key = normalizeTerm(platform.platform);
    if (key && !channels.has(key)) channels.set(key, { kind: "channel", id: platform.platform, label: platform.platform });
  }
  for (const store of dingtalk?.stores ?? []) {
    const key = normalizeTerm(store.store);
    if (key && !stores.has(key)) stores.set(key, { kind: "store", id: store.store, label: store.store });
  }
  const pm = warehouse?.productManagement;
  for (const row of pm?.productNameOverview ?? []) {
    const nameKey = normalizeTerm(row.productName);
    if (nameKey && !products.has(nameKey)) products.set(nameKey, { kind: "product", id: row.productName, label: row.productName, spu: row.spu, productCode: row.productCode });
    const spuKey = normalizeTerm(row.spu);
    if (spuKey) {
      const existing = spus.get(spuKey);
      if (existing) existing.productNames.add(row.productName);
      else spus.set(spuKey, { kind: "spu", id: row.spu, label: row.spu, productNames: new Set([row.productName]) });
    }
  }
  for (const row of pm?.productOverview ?? []) {
    const skuKey = normalizeTerm(row.productCode);
    if (skuKey && !skus.has(skuKey)) skus.set(skuKey, { kind: "sku", id: row.productCode, label: row.productCode, productName: row.productName, subName: row.subName });
  }
  return { channels, stores, products, spus, skus };
}

export function matchEntities(query, index) {
  const q = normalizeTerm(query);
  if (!q) return null;
  const results = [];
  for (const group of [index.channels, index.stores, index.products, index.spus, index.skus]) {
    for (const [key, entity] of group) {
      if (key === q) results.push({ entity, score: 100 });
      else if (key.startsWith(q)) results.push({ entity, score: 80 });
      else if (key.includes(q)) results.push({ entity, score: 60 });
      else if (q.includes(key)) results.push({ entity, score: 55 });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results[0] ?? null;
}

// ---------------------------------------------------------------------------
// 纯函数：目录排名
// ---------------------------------------------------------------------------

export function rankCatalogEntries(query, areas = []) {
  const q = normalizeTerm(query);
  if (!q) return [];
  return areas
    .map((entry) => ({ entry, score: scoreCandidate(query, entry) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// 数值格式
// ---------------------------------------------------------------------------

function formatValue(value, unit) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  switch (unit) {
    case "currency":
      return `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
    case "percent":
      return `${(value * 100).toFixed(2)}%`;
    case "ratio":
      return value.toFixed(2);
    case "days":
      return `${value.toFixed(1)}天`;
    case "integer":
    default:
      return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  }
}

// ---------------------------------------------------------------------------
// 经营指标取值（钉钉快照）
// ---------------------------------------------------------------------------

function operatingMetricValue(metric, metrics) {
  if (!metrics) return null;
  switch (metric.read) {
    case "gmv": return metrics.gmv;
    case "netRevenue": return metrics.netRevenue;
    case "recoveryRate": return metrics.recoveryRate ?? (metrics.gmv ? metrics.netRevenue / metrics.gmv : null);
    case "spend": return metrics.spend;
    case "feeRate": return metrics.feeRate ?? (metrics.netRevenue ? metrics.spend / metrics.netRevenue : null);
    case "roi": return metrics.roi ?? (metrics.spend ? metrics.gmv / metrics.spend : null);
    case "refund": return metrics.refund;
    case "refundRate": return metrics.refundRate ?? (metrics.gmv ? metrics.refund / metrics.gmv : null);
    case "addToCart": return metrics.addToCart;
    case "completionRate": return metrics.completionRate ?? (metrics.target ? metrics.netRevenue / metrics.target : null);
    default: return null;
  }
}

function productMetricValue(metric, row, productManagement) {
  // 带 kpi 的指标是全局聚合（待发货件数/定制率），无商品行时仍可回答
  if (!row && !metric.kpi) return null;
  switch (metric.read) {
    case "receivedAmount": return row.receivedAmount;
    case "netSales": return row.receivedAmount - row.refundAmount;
    case "salesUnits": return row.salesUnits;
    case "refundAmount": return row.refundAmount;
    case "refundRate": return row.refundRate;
    case "grossProfit": return row.grossProfit;
    case "grossMargin": return row.grossMargin;
    case "avgUnitPrice": return row.avgUnitPrice ?? (row.salesUnits ? row.receivedAmount / row.salesUnits : null);
    case "shippingDays": {
      const fulfillment = (productManagement?.fulfillmentByProduct ?? []).find((item) => item.productName === row.productName);
      return fulfillment?.avgShippingDays ?? null;
    }
    case "pendingUnits": return productManagement?.kpis?.pendingUnits ?? null;
    case "customRate": return productManagement?.kpis?.customRate ?? null;
    default: return null;
  }
}

function productRowFor(warehouse, entity) {
  const pm = warehouse?.productManagement;
  if (!pm) return null;
  if (entity?.kind === "product") {
    return pm.productNameOverview.find((row) => row.productName === entity.id) ?? null;
  }
  if (entity?.kind === "spu") {
    const rows = pm.productNameOverview.filter((row) => row.spu === entity.id);
    return rows.length === 1 ? rows[0] : null;
  }
  if (entity?.kind === "sku") {
    const sku = pm.productOverview.find((row) => row.productCode === entity.id);
    if (!sku) return null;
    const rows = pm.productNameOverview.filter((row) => row.productName === sku.productName);
    return rows.length === 1 ? rows[0] : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 答案构建
// ---------------------------------------------------------------------------

function buildOperatingAnswer({ metric, metrics, entity, period, dingtalkRefreshedAt }) {
  const value = operatingMetricValue(metric, metrics);
  const label = entity?.kind === "channel" ? `${metric.label} · ${entity.label}` : metric.label;
  const scopeLabel = entity?.kind === "channel" ? entity.label : "全渠道";
  return {
    id: `${metric.id}-${entity?.id ?? "all"}-${period?.start ?? "default"}`,
    metricId: metric.id,
    label,
    displayValue: formatValue(value, metric.unit),
    rawValue: Number.isFinite(value) ? value : null,
    unit: metric.unit,
    definition: metric.definition,
    scopeLabel,
    period: period ? { start: period.start, end: period.end } : null,
    source: "dingtalk",
    refreshedAt: dingtalkRefreshedAt,
    dataState: value === null || value === undefined ? "missing" : "fresh",
    target: {
      page: "analytics",
      analyticsView: "layered",
      workspace: "overview",
      section: metric.section,
      filters: {
        start: period?.start ?? undefined,
        end: period?.end ?? undefined,
        channel: entity?.kind === "channel" ? entity.id : undefined,
      },
    },
  };
}

function buildProductAnswer({ metric, row, entity, warehouse, warehouseRefreshedAt }) {
  const value = productMetricValue(metric, row, warehouse?.productManagement);
  const label = entity?.id ? `${metric.label} · ${entity.id}` : metric.label;
  // 带商品焦点时，统一落到总览页签的重点商品表：可高亮的商品行只在该表渲染，
  // 否则 tab=returns/fulfillment 时 focus 无法被 PriorityProductsTable 消费。
  const hasFocus = Boolean(entity);
  const tab = hasFocus ? "overview" : metric.tab;
  const section = hasFocus ? "products-priority" : metric.section;
  return {
    id: `${metric.id}-${entity?.id ?? "all"}`,
    metricId: metric.id,
    label,
    displayValue: formatValue(value, metric.unit),
    rawValue: Number.isFinite(value) ? value : null,
    unit: metric.unit,
    definition: metric.definition,
    scopeLabel: entity?.id ?? "全商品",
    period: warehouse?.productManagement?.period ?? null,
    source: "warehouse",
    refreshedAt: warehouseRefreshedAt,
    dataState: value === null || value === undefined ? "missing" : "fresh",
    target: {
      page: "products",
      tab,
      section,
      filters: {},
      focus: entity ? { kind: entity.kind, value: entity.id, productName: entity.label } : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// 纯函数：快照答案构建
// ---------------------------------------------------------------------------

export function answerFromSnapshots({ metric, entity, period, scope, dingtalk, dingtalkRefreshedAt, warehouse, warehouseRefreshedAt }) {
  if (scope === "analytics") {
    if (!dingtalk?.reporting?.dailyPlatforms?.length) return null;
    let filtered;
    try {
      filtered = filterDingTalkSnapshot(dingtalk, { start: period?.start, end: period?.end });
    } catch {
      return null;
    }
    const metrics = entity?.kind === "channel"
      ? filtered.platforms.find((item) => item.platform === entity.id) ?? null
      : filtered.totals;
    if (!metrics) return null;
    return buildOperatingAnswer({ metric, metrics, entity, period, dingtalkRefreshedAt });
  }
  if (scope === "products") {
    if (!warehouse?.productManagement) return null;
    const row = productRowFor(warehouse, entity);
    if (!row && !metric.kpi) return null;
    return buildProductAnswer({ metric, row, entity, warehouse, warehouseRefreshedAt });
  }
  return null;
}

// ---------------------------------------------------------------------------
// 主搜索服务
// ---------------------------------------------------------------------------

const INDEX_CACHE = { fingerprint: null, inflight: null, index: null };

function fingerprintOf(dingtalkMeta, warehouseMtime, salt = "") {
  // salt 携带数据权限范围：无商品权限的调用不得复用含商品实体的缓存索引
  return `${dingtalkMeta?.finishedAt ?? ""}|${warehouseMtime ?? ""}|${salt}`;
}

async function getEntityIndex({ dingtalkMeta, warehouseMtime, dingtalk, warehouse, salt }) {
  const fingerprint = fingerprintOf(dingtalkMeta, warehouseMtime, salt);
  if (INDEX_CACHE.fingerprint === fingerprint && INDEX_CACHE.index) return INDEX_CACHE.index;
  if (INDEX_CACHE.inflight) return INDEX_CACHE.inflight;
  INDEX_CACHE.inflight = (async () => {
    const index = buildEntityIndex({ dingtalk, warehouse });
    INDEX_CACHE.index = index;
    INDEX_CACHE.fingerprint = fingerprint;
    return index;
  })();
  try {
    return await INDEX_CACHE.inflight;
  } finally {
    INDEX_CACHE.inflight = null;
  }
}

function isProductEntity(entity) {
  return entity && ["product", "spu", "sku"].includes(entity.kind);
}

function spuAmbiguous(entity, index) {
  if (entity?.kind !== "spu") return false;
  const spuEntity = index.spus.get(normalizeTerm(entity.id));
  return Boolean(spuEntity && spuEntity.productNames.size > 1);
}

function buildNavigationResults({ query, allowedAnalytics, allowedProducts, allowedPages }) {
  const results = [];
  const areaMatches = [
    ...(allowedAnalytics ? rankCatalogEntries(query, ANALYTICS_AREAS) : []),
    ...(allowedProducts ? rankCatalogEntries(query, PRODUCT_AREAS) : []),
    ...rankCatalogEntries(query, OTHER_PAGES.filter((p) => allowedPages.has(p.page))),
  ].sort((a, b) => b.score - a.score);

  for (const { entry, score } of areaMatches.slice(0, 3)) {
    if (entry.id.startsWith("analytics-")) {
      results.push({
        id: entry.id,
        kind: "section",
        title: entry.label,
        subtitle: "全渠道经营 · 去这里查看",
        target: { page: "analytics", analyticsView: entry.analyticsView ?? "layered", workspace: entry.workspace ?? "overview", replicaPage: entry.replicaPage, section: entry.section },
      });
    } else if (entry.id.startsWith("products-")) {
      results.push({
        id: entry.id,
        kind: "section",
        title: entry.label,
        subtitle: "商品管理 · 去这里查看",
        target: { page: "products", tab: entry.tab, section: entry.section },
      });
    } else {
      results.push({
        id: entry.id,
        kind: "section",
        title: entry.label,
        subtitle: "其他页面 · 去这里查看",
        target: { page: entry.page },
      });
    }
  }
  return results;
}

function emptyResponse(query, mode) {
  return {
    query,
    mode,
    status: "unsupported",
    interpretation: { intent: "navigate", scope: null, metricIds: [], period: null, entity: null },
    answers: [],
    results: [],
    suggestions: [],
  };
}

// 出现时间意图但 parsePeriod 未覆盖的表达（去年/季度/星期X 等）：
// 落到最新完整数据日并在周期标签明示，禁止静默按全周期回答。
const UNPARSED_TIME_INTENT = /去年|前年|明年|季度|[Qq][1-4]|星期[一二三四五六日天]?|礼拜[一二三四五六日天]?|周末|年初|年底|月初|月末|月底/;

export async function searchSite({ query, mode, limit = 8, user, permissions }, context = {}) {
  const rawQuery = String(query ?? "").trim();
  const normalized = normalizeQuery(rawQuery);
  const allowedAnalytics = user?.role === "admin" || permissions.includes("analytics.view");
  const allowedProducts = user?.role === "admin" || permissions.includes("products.view");
  // 页面导航目录按页面 id 判定；权限串是 `${page}.view`（权限管理页对应 admin.users）
  const PAGE_PERMISSION = { dashboard: "dashboard.view", assets: "assets.view", content: "content.view", images: "images.view", intelligence: "intelligence.view", tasks: "tasks.view", settings: "settings.view", access: "admin.users" };
  const allowedPages = new Set(
    Object.entries(PAGE_PERMISSION)
      .filter(([, permission]) => user?.role === "admin" || permissions.includes(permission))
      .map(([page]) => page),
  );

  const response = emptyResponse(rawQuery, mode);
  if (!normalized || normalized.length < 1 || normalized.length > 200) return response;
  response.query = rawQuery;

  // 静态目录 + 页面导航结果（始终可用，不依赖快照）
  const navResults = buildNavigationResults({ query: rawQuery, allowedAnalytics, allowedProducts, allowedPages });
  response.results.push(...navResults);

  // 定义意图
  const isDefinition = /怎么算|如何计算|定义|口径|什么意思|含义/.test(rawQuery);

  // 指标匹配（不依赖快照）
  const metricMatches = matchMetrics(rawQuery).filter(({ metric }) => (metric.source === "dingtalk" ? allowedAnalytics : allowedProducts));

  // 加载快照与实体索引
  const dingtalkMeta = context.dingtalkMeta;
  const warehouseMtime = context.warehouseMtime;
  const dingtalk = allowedAnalytics ? context.dingtalk : null;
  const warehouse = allowedProducts ? context.warehouse : null;

  let index = { channels: new Map(), stores: new Map(), products: new Map(), spus: new Map(), skus: new Map() };
  if (allowedAnalytics || allowedProducts) {
    index = await getEntityIndex({ dingtalkMeta, warehouseMtime, dingtalk, warehouse, salt: `${allowedAnalytics}:${allowedProducts}` });
  }

  const matchedEntity = matchEntities(rawQuery, index);
  const entity = matchedEntity?.entity ?? null;
  const hasProductEntity = isProductEntity(entity);

  // 多义 SPU：M5209 → 澄清
  if (spuAmbiguous(entity, index)) {
    const spuEntity = index.spus.get(normalizeTerm(entity.id));
    response.status = "ambiguous";
    response.interpretation = { intent: "entity", scope: "products", metricIds: [], period: null, entity: { kind: "spu", id: entity.id, label: entity.id } };
    response.results = [...spuEntity.productNames].map((name) => ({
      id: `spu-${entity.id}-${name}`,
      kind: "clarification",
      title: name,
      subtitle: `SPU ${entity.id} · 选择具体商品`,
      target: { page: "products", tab: "overview", focus: { kind: "product", value: name, productName: name } },
    }));
    return response;
  }

  // 日期解析：识别不了的时间词不得静默用全周期回答；
  // 无时间词时默认本月 MTD（与看板口径一致），并把实际周期回填给答案卡展示
  const completedThrough = dingtalk?.reporting?.completedThrough ?? warehouse?.productManagement?.period?.end ?? null;
  let period = parsePeriod(rawQuery, { completedThrough });
  if (!period && completedThrough) {
    if (UNPARSED_TIME_INTENT.test(rawQuery)) {
      period = { start: completedThrough, end: completedThrough, label: `最新完整数据日（${completedThrough}）`, basis: "default" };
    } else {
      period = { start: `${completedThrough.slice(0, 7)}-01`, end: completedThrough, label: `本月（${completedThrough.slice(0, 7)}）`, basis: "default" };
    }
  }

  // 意图判定
  const scope = hasProductEntity ? "products" : "analytics";
  const metricIds = metricMatches.map(({ metric }) => metric.id);
  response.interpretation = {
    intent: isDefinition ? "definition" : metricMatches.length ? "metric_value" : entity ? "entity" : "navigate",
    scope,
    metricIds,
    period: period ? { start: period.start, end: period.end, label: period.label, basis: period.basis } : null,
    entity: entity ? { kind: entity.kind, id: entity.id, label: entity.label } : null,
  };

  if (mode === "suggest") {
    response.suggestions = metricMatches.slice(0, limit).map(({ metric }) => metric.label);
    if (entity && !response.suggestions.length) response.suggestions.push(entity.label);
    return response;
  }

  // answer 模式：确定作用域内的指标。
  // 无商品实体时 scope 判为 analytics；带全局 kpi 聚合的商品指标（待发货件数/定制率）仍可直接回答全局值
  const scopeMetrics = metricMatches
    .filter(({ metric }) => (scope === "products" ? metric.source === "warehouse" : metric.source === "dingtalk")
      || (metric.source === "warehouse" && Boolean(metric.kpi) && allowedProducts))
    .filter((item, index, arr) => arr.findIndex((x) => x.metric.id === item.metric.id) === index);
  const metric = scopeMetrics[0]?.metric ?? null;

  // 商品 + 明确历史日期 → navigate_required（当前快照无法证明，交给商品页聚合）
  if (hasProductEntity && metric && period && period.basis === "explicit") {
    const pmPeriod = warehouse?.productManagement?.period;
    const isSnapshotPeriod = pmPeriod && period.start === pmPeriod.start && period.end === pmPeriod.end;
    if (!isSnapshotPeriod) {
      response.status = "navigate_required";
      response.interpretation.intent = "metric_value";
      response.results = scopeMetrics.slice(0, 3).map(({ metric: m }) => ({
        id: `navigate-${m.id}`,
        kind: "section",
        title: `商品 ${entity.id} 的 ${m.label}`,
        subtitle: "历史日期需在商品页按条件计算",
        target: {
          page: "products",
          tab: m.tab,
          section: m.section,
          filters: { start: period.start, end: period.end },
          focus: { kind: entity.kind, value: entity.id, productName: entity.label },
        },
      }));
      return response;
    }
  }

  // 定义意图：返回指标定义与公式，不返回计算值（任务书第 5 节）
  if (isDefinition && metric) {
    const fallbackTarget = scope === "products"
      ? { page: "products", tab: metric.tab, section: metric.section }
      : { page: "analytics", analyticsView: "layered", workspace: "overview", section: metric.section, filters: {} };
    response.status = "ok";
    response.answers = [{
      id: `definition-${metric.id}`,
      metricId: metric.id,
      label: metric.label,
      displayValue: metric.definition,
      rawValue: null,
      unit: metric.unit,
      definition: metric.definition,
      scopeLabel: "指标定义",
      period: null,
      source: metric.source,
      refreshedAt: null,
      dataState: "fresh",
      target: fallbackTarget,
    }];
    response.results = [{
      id: `definition-${metric.id}`,
      kind: "metric",
      title: metric.label,
      subtitle: `${metric.definition}${metric.formula ? ` · 公式：${metric.formula}` : ""}`,
      target: fallbackTarget,
    }];
    return response;
  }

  // 排名 / 比较意图：渠道维度用快照平台行纯函数计算 Top 答案卡；
  // 店铺 / 商品维度降级为明示导航。禁止静默改答全渠道总值。
  const isRanking = /最高|最低|最多|最少|最大|最小|前\s*\d+|top\s*\d+|哪个|哪家|排行|排名/i.test(rawQuery);
  if (isRanking && !entity && metricMatches.length) {
    const rankingMetric = scopeMetrics[0]?.metric ?? metricMatches[0].metric;
    const descending = !/最低|最少|最小/.test(rawQuery);
    const wantsStore = /店/.test(rawQuery);
    const wantsProduct = rankingMetric.source === "warehouse" || /商品|产品|款式/.test(rawQuery);
    response.interpretation.intent = "ranking";
    if (wantsProduct) {
      response.status = "ok";
      response.results = [{ id: "ranking-products", kind: "section", title: `商品${rankingMetric.label}排名`, subtitle: "商品排名请在重点商品表查看，可按列排序", target: { page: "products", tab: "overview", section: "products-priority" } }];
      return response;
    }
    if (wantsStore) {
      response.status = "ok";
      response.results = [{ id: "ranking-stores", kind: "section", title: `店铺${rankingMetric.label}排名`, subtitle: "店铺排名请在店铺明细区查看", target: { page: "analytics", analyticsView: "layered", workspace: "overview", section: "analytics-store-quality" } }];
      return response;
    }
    if (rankingMetric.source === "dingtalk" && dingtalk?.reporting?.dailyPlatforms?.length) {
      let ranked = [];
      try {
        const filtered = filterDingTalkSnapshot(dingtalk, { start: period?.start, end: period?.end });
        ranked = (filtered.platforms ?? [])
          .map((row) => ({ row, value: operatingMetricValue(rankingMetric, row) }))
          .filter((item) => Number.isFinite(item.value))
          .sort((a, b) => (descending ? b.value - a.value : a.value - b.value));
      } catch {
        ranked = [];
      }
      if (ranked.length) {
        response.status = "ok";
        response.answers = ranked.slice(0, 3).map(({ row }) => buildOperatingAnswer({
          metric: rankingMetric,
          metrics: row,
          entity: { kind: "channel", id: row.platform, label: row.platform },
          period,
          dingtalkRefreshedAt: dingtalkMeta?.finishedAt ?? null,
        }));
        response.results = response.answers.map((a, index) => ({ id: `ranking-${index}-${a.metricId}`, kind: "metric", title: `第${index + 1}名 · ${a.label}`, subtitle: a.definition, target: a.target }));
        return response;
      }
    }
    response.status = "ok";
    response.results = [{ id: "ranking-fallback", kind: "section", title: `${rankingMetric.label}排名`, subtitle: "当前快照无法计算该排名，请到渠道对比区查看", target: { page: "analytics", analyticsView: "layered", workspace: "overview", section: "analytics-channel-quality" } }];
    return response;
  }

  // 裸实体兜底：只输入商品/渠道/店铺（或指标不在该作用域）时，
  // 返回核心指标卡或带焦点的明示导航，不再裸 unsupported
  if (entity && !scopeMetrics.length) {
    const coreIds = isProductEntity(entity)
      ? ["products.sales_units", "products.refund_rate", "products.net_sales"]
      : entity.kind === "channel"
        ? ["analytics.gmv", "analytics.net_revenue", "analytics.refund_rate"]
        : [];
    const answers = [];
    for (const id of coreIds) {
      const m = ALL_METRICS.find((item) => item.id === id);
      if (!m) continue;
      const answer = answerFromSnapshots({
        metric: m,
        entity,
        period,
        scope: m.source === "warehouse" ? "products" : "analytics",
        dingtalk,
        dingtalkRefreshedAt: dingtalkMeta?.finishedAt ?? null,
        warehouse,
        warehouseRefreshedAt: context.warehouseRefreshedAt,
      });
      if (answer && answer.rawValue !== null) answers.push(answer);
    }
    response.status = "ok";
    response.answers = answers;
    if (answers.length) {
      response.results = answers.map((a) => ({ id: `result-${a.metricId}`, kind: "metric", title: a.label, subtitle: a.definition, target: a.target }));
    } else if (isProductEntity(entity)) {
      response.results = [{ id: `entity-${entity.kind}-${entity.id}`, kind: "section", title: entity.label, subtitle: "商品管理 · 总览重点商品表", target: { page: "products", tab: "overview", section: "products-priority", focus: { kind: entity.kind, value: entity.id, productName: entity.label } } }];
    } else if (entity.kind === "channel") {
      response.results = [{ id: `entity-channel-${entity.id}`, kind: "section", title: entity.label, subtitle: "全渠道经营 · 按该渠道筛选查看", target: { page: "analytics", analyticsView: "layered", workspace: "overview", section: "analytics-top", filters: { channel: entity.id } } }];
    } else {
      response.results = [{ id: `entity-store-${entity.id}`, kind: "section", title: entity.label, subtitle: "店铺明细区查看该店铺", target: { page: "analytics", analyticsView: "layered", workspace: "overview", section: "analytics-store-quality" } }];
    }
    return response;
  }

  // 数值 / 实体：构建答案卡（支持多个指标）
  if (scopeMetrics.length) {
    const answers = [];
    for (const { metric: m } of scopeMetrics) {
      const answer = answerFromSnapshots({ metric: m, entity, period, scope: m.source === "warehouse" ? "products" : "analytics", dingtalk, dingtalkRefreshedAt: dingtalkMeta?.finishedAt ?? null, warehouse, warehouseRefreshedAt: context.warehouseRefreshedAt });
      if (answer) answers.push(answer);
    }
    if (answers.length) {
      response.status = "ok";
      response.answers = answers.slice(0, 3);
      response.results = answers.map((a) => ({ id: `result-${a.metricId}`, kind: "metric", title: a.label, subtitle: a.definition, target: a.target }));
      return response;
    }
    // 快照缺失或指标不可用
    response.status = "unavailable";
    response.answers = [];
    if (scope === "products" && !warehouse?.productManagement) {
      response.results = [{ id: "unavailable-products", kind: "section", title: "商品管理", subtitle: "数仓快照缺失，仍可进入商品管理", target: { page: "products", tab: "overview" } }];
    } else if (scope === "analytics" && !dingtalk?.reporting?.dailyPlatforms?.length) {
      response.results = [{ id: "unavailable-analytics", kind: "section", title: "全渠道经营总览", subtitle: "钉钉快照缺失，仍可进入经营看板", target: { page: "analytics", analyticsView: "layered", workspace: "overview" } }];
    }
    return response;
  }

  // 无指标：导航结果已就绪
  if (response.results.length) {
    response.status = "ok";
    return response;
  }

  response.status = "unsupported";
  response.suggestions = ["8月天猫退款率", "豆7销量和退货率", "仓配履约在哪里"];
  return response;
}