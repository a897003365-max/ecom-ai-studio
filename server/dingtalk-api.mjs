import { hasLocalEnv, readLocalEnv } from "./local-env.mjs";

const baseUrl = "https://api.dingtalk.com/v1.0";
const chunkRows = 150;
const maxColumn = "BG";
const maxChunks = 10;
const maxAttempts = 6;
const retryableStatuses = new Set([502, 503, 504]);
const ignoredDetailSheets = new Set(["全渠道数据表", "销售目标", "店铺名称对照表"]);

let tokenCache = null;

function requiredConfig() {
  const config = {
    appKey: readLocalEnv("DINGTALK_APP_KEY"),
    appSecret: readLocalEnv("DINGTALK_APP_SECRET"),
    workbookId: readLocalEnv("DINGTALK_WORKBOOK_ID"),
    operatorId: readLocalEnv("DINGTALK_OPERATOR_ID"),
  };
  const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`钉钉环境变量缺失：${missing.join(", ")}`);
  return config;
}

function scheduleTimes() {
  return readLocalEnv("DINGTALK_SYNC_TIMES", "10:00,12:30,17:30")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d{2}:\d{2}$/.test(value));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(attempt) {
  return Math.min(20_000, 1500 * (2 ** attempt)) + Math.floor(Math.random() * 500);
}

async function responseError(response) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = String(payload?.message || payload?.code || "");
  } catch {
    detail = "";
  }
  return `钉钉 Sheet API ${response.status}${detail ? `：${detail.slice(0, 240)}` : ""}`;
}

async function getAccessToken(force = false, attempt = 0) {
  if (!force && tokenCache?.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const { appKey, appSecret } = requiredConfig();
  let response;
  try {
    response = await fetch(`${baseUrl}/oauth2/accessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appKey, appSecret }),
    });
  } catch (error) {
    if (attempt >= maxAttempts - 1) throw error;
    await sleep(retryDelay(attempt));
    return getAccessToken(force, attempt + 1);
  }
  if (retryableStatuses.has(response.status) && attempt < maxAttempts - 1) {
    await sleep(retryDelay(attempt));
    return getAccessToken(force, attempt + 1);
  }
  if (!response.ok) throw new Error(await responseError(response));
  const payload = await response.json();
  if (!payload.accessToken) throw new Error("钉钉认证成功但未返回 accessToken");
  tokenCache = {
    value: payload.accessToken,
    expiresAt: Date.now() + Number(payload.expireIn || 7200) * 1000,
  };
  return tokenCache.value;
}

async function request(path, { attempt = 0 } = {}) {
  const token = await getAccessToken();
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { "x-acs-dingtalk-access-token": token },
    });
  } catch (error) {
    if (attempt >= maxAttempts - 1) throw error;
    await sleep(retryDelay(attempt));
    return request(path, { attempt: attempt + 1 });
  }
  if ((response.status === 401 || response.status === 403) && attempt === 0) {
    await getAccessToken(true);
    return request(path, { attempt: 1 });
  }
  if (retryableStatuses.has(response.status) && attempt < maxAttempts - 1) {
    await sleep(retryDelay(attempt));
    return request(path, { attempt: attempt + 1 });
  }
  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function hasData(rows) {
  return rows.some((row) => Array.isArray(row) && row.some((value) => !isBlank(value)));
}

async function listSheets() {
  const { workbookId, operatorId } = requiredConfig();
  const payload = await request(`/doc/workbooks/${encodeURIComponent(workbookId)}/sheets?operatorId=${encodeURIComponent(operatorId)}`);
  return Array.isArray(payload.value) ? payload.value : [];
}

async function readSheet(sheet) {
  const { workbookId, operatorId } = requiredConfig();
  const rows = [];
  for (let chunk = 0; chunk < maxChunks; chunk += 1) {
    const start = chunk * chunkRows + 1;
    const end = start + chunkRows - 1;
    const range = `A${start}:${maxColumn}${end}`;
    const path = `/doc/workbooks/${encodeURIComponent(workbookId)}/sheets/${encodeURIComponent(sheet.id)}/ranges/${encodeURIComponent(range)}?operatorId=${encodeURIComponent(operatorId)}`;
    const payload = await request(path);
    const values = Array.isArray(payload.values)
      ? payload.values.map((row) => (Array.isArray(row) ? row : []))
      : [];
    if (!values.length || !hasData(values)) break;
    rows.push(...values);
    if (values.length < chunkRows) break;
  }
  return { sheet: sheet.name, data: rows };
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isBlank(value)) return 0;
  const text = String(value).trim().replace(/[￥¥,，\s]/g, "");
  const multiplier = text.endsWith("万") ? 10_000 : 1;
  const normalized = text.replace(/[万元%]$/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return text.endsWith("%") ? parsed / 100 : parsed * multiplier;
}

function dateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    if (numeric >= 20_000 && numeric <= 80_000) {
      return new Date(Date.UTC(1899, 11, 30) + Math.floor(numeric) * 86_400_000).toISOString().slice(0, 10);
    }
    if (numeric >= 1_000_000_000 && numeric < 10_000_000_000) {
      return new Date(numeric * 1000).toISOString().slice(0, 10);
    }
    if (numeric >= 1_000_000_000_000) return new Date(numeric).toISOString().slice(0, 10);
  }
  const match = text.match(/(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function textValue(value) {
  return String(value ?? "").trim().replace(/[\r\n\t]+/g, " ").slice(0, 100);
}

function normalizedHeader(value) {
  return textValue(value).replace(/[\s()（）%]/g, "").toLowerCase();
}

function findHeaderRow(rows = [], required = []) {
  return rows.findIndex((row) => {
    const headers = (Array.isArray(row) ? row : []).map(normalizedHeader);
    return required.every((pattern) => headers.some((value) => pattern.test(value)));
  });
}

function findColumn(headers = [], patterns = []) {
  const normalized = (Array.isArray(headers) ? headers : []).map(normalizedHeader);
  for (const pattern of patterns) {
    const index = normalized.findIndex((value) => pattern.test(value));
    if (index >= 0) return index;
  }
  return -1;
}

function platformName(value) {
  const name = textValue(value);
  if (/淘宝|天猫|崔氏/.test(name)) return "天猫";
  if (/京东/.test(name)) return "京东";
  if (/抖音/.test(name)) return "抖音";
  if (/拼/.test(name)) return "拼多多";
  if (/小红书|薯店/.test(name)) return "小红书";
  if (/唯品/.test(name)) return "唯品";
  return name || "其他";
}

function metricShape(values = {}) {
  const result = {
    exposure: values.exposure || 0,
    clicks: values.clicks || 0,
    spend: values.spend || 0,
    paidOrders: values.paidOrders || 0,
    gmv: values.gmv || 0,
    netRevenue: values.netRevenue || 0,
    refund: values.refund || 0,
    favorite: values.favorite || 0,
    addToCart: values.addToCart || 0,
    target: values.target || 0,
    budget: values.budget || 0,
  };
  return {
    ...result,
    ctr: result.exposure ? result.clicks / result.exposure : 0,
    roi: result.spend ? result.gmv / result.spend : 0,
    completionRate: result.target ? result.netRevenue / result.target : 0,
  };
}

function reportingMetricShape(values = {}, channelShare = 0) {
  const result = metricShape(values);
  return {
    ...values,
    ...result,
    feeRate: result.netRevenue ? result.spend / result.netRevenue : 0,
    recoveryRate: result.gmv ? result.netRevenue / result.gmv : 0,
    refundRate: result.gmv ? result.refund / result.gmv : 0,
    channelShare,
  };
}

function addMetrics(target, source) {
  for (const key of ["exposure", "clicks", "spend", "paidOrders", "gmv", "netRevenue", "refund", "favorite", "addToCart", "target", "budget"]) {
    target[key] = (target[key] || 0) + (source[key] || 0);
  }
  return target;
}

function parseSummarySheet(rows) {
  const periodHeader = findHeaderRow(rows, [/开始日期/, /截止日期/]);
  const periodHeaders = periodHeader >= 0 ? rows[periodHeader] : [];
  const startIndex = findColumn(periodHeaders, [/开始日期/]);
  const endIndex = findColumn(periodHeaders, [/截止日期/]);
  const periodRows = periodHeader >= 0 ? rows.slice(periodHeader + 1, periodHeader + 6) : [];
  const period = {
    start: periodRows.map((row) => dateValue(row[startIndex])).find(Boolean) ?? null,
    end: periodRows.map((row) => dateValue(row[endIndex])).find(Boolean) ?? null,
  };

  const monthlyHeader = findHeaderRow(rows, [/月份/, /月度回款额/]);
  const monthlyHeaders = monthlyHeader >= 0 ? rows[monthlyHeader] : [];
  const monthlyRow = monthlyHeader >= 0 ? rows[monthlyHeader + 1] ?? [] : [];
  const monthly = {
    month: textValue(monthlyRow[findColumn(monthlyHeaders, [/^月份$/])]),
    netRevenue: numberValue(monthlyRow[findColumn(monthlyHeaders, [/月度回款额/])]),
    yoy: numberValue(monthlyRow[findColumn(monthlyHeaders, [/^同比$/])]),
    onsiteSpend: numberValue(monthlyRow[findColumn(monthlyHeaders, [/站内费用/])]),
    offsiteSpend: numberValue(monthlyRow[findColumn(monthlyHeaders, [/站外费用/])]),
    onsiteFeeRate: numberValue(monthlyRow[findColumn(monthlyHeaders, [/站内月费率|站内费率/])]),
    offsiteFeeRate: numberValue(monthlyRow[findColumn(monthlyHeaders, [/站外月费率|站外费率/])]),
    totalSpendRate: numberValue(monthlyRow[findColumn(monthlyHeaders, [/总费率/])]),
    completionRate: numberValue(monthlyRow[findColumn(monthlyHeaders, [/总完成率/])]),
  };

  const platformHeader = findHeaderRow(rows, [/^渠道$/, /^gmv$/, /回款额/]);
  const headers = platformHeader >= 0 ? rows[platformHeader] : [];
  const indexes = {
    platform: findColumn(headers, [/^渠道$/]),
    gmv: findColumn(headers, [/^gmv$/]),
    netRevenue: findColumn(headers, [/^回款额$/]),
    spend: findColumn(headers, [/站内费额|站内费用/]),
    addToCart: findColumn(headers, [/加购人数/]),
    refund: findColumn(headers, [/退款金额/]),
  };
  const platforms = [];
  let totals = null;
  if (platformHeader >= 0) {
    for (const row of rows.slice(platformHeader + 1)) {
      const label = textValue(row[indexes.platform]);
      if (!label) {
        if (platforms.length) break;
        continue;
      }
      const metrics = metricShape({
        gmv: numberValue(row[indexes.gmv]),
        netRevenue: numberValue(row[indexes.netRevenue]),
        spend: numberValue(row[indexes.spend]),
        addToCart: numberValue(row[indexes.addToCart]),
        refund: numberValue(row[indexes.refund]),
      });
      if (/总计|合计/.test(label)) {
        totals = metrics;
        break;
      }
      platforms.push({ platform: platformName(label), ...metrics });
    }
  }

  const storeHeader = rows.findIndex((row) => {
    const headers = row.map(normalizedHeader);
    return headers.includes("渠道") && headers.includes("店铺") && headers.includes("gmv");
  });
  const stores = [];
  if (storeHeader >= 0) {
    const storeHeaders = rows[storeHeader];
    const storeIndexes = {
      platform: findColumn(storeHeaders, [/^渠道$/]),
      store: findColumn(storeHeaders, [/^店铺$/]),
      gmv: findColumn(storeHeaders, [/^gmv$/]),
      netRevenue: findColumn(storeHeaders, [/^回款额$/]),
      spend: findColumn(storeHeaders, [/站内费额|站内费用/]),
      addToCart: findColumn(storeHeaders, [/加购人数/]),
      refund: findColumn(storeHeaders, [/退款金额/]),
    };
    for (const row of rows.slice(storeHeader + 1)) {
      const store = textValue(row[storeIndexes.store]);
      if (!store) {
        if (stores.length) break;
        continue;
      }
      stores.push({
        platform: platformName(row[storeIndexes.platform]),
        store,
        ...metricShape({
          gmv: numberValue(row[storeIndexes.gmv]),
          netRevenue: numberValue(row[storeIndexes.netRevenue]),
          spend: numberValue(row[storeIndexes.spend]),
          addToCart: numberValue(row[storeIndexes.addToCart]),
          refund: numberValue(row[storeIndexes.refund]),
        }),
      });
    }
  }
  return { period, monthly, platforms, stores, totals };
}

function parseTargets(rows, monthNumber) {
  const headerIndex = rows.findIndex((row) => row.map(normalizedHeader).includes("渠道") && row.map(normalizedHeader).includes("店铺"));
  if (headerIndex < 0) return { byPlatform: new Map(), total: 0, monthlyTotals: {} };
  const headers = rows[headerIndex].map(textValue);
  const monthIndex = headers.findIndex((value) => value === `${monthNumber}月`);
  if (monthIndex < 0) return { byPlatform: new Map(), total: 0, monthlyTotals: {} };
  const byPlatform = new Map();
  const monthlyTotals = {};
  let total = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const label = textValue(row[0]);
    if (!label) continue;
    const value = numberValue(row[monthIndex]);
    if (/总计|合计/.test(label)) {
      total = value;
      for (let month = 1; month <= 12; month += 1) {
        const index = headers.findIndex((header) => header === `${month}月`);
        monthlyTotals[String(month).padStart(2, "0")] = index >= 0 ? numberValue(row[index]) : 0;
      }
      break;
    }
    const platform = platformName(label);
    byPlatform.set(platform, (byPlatform.get(platform) || 0) + value);
  }
  return { byPlatform, total, monthlyTotals };
}

function detailMetricIndexes(headers) {
  return {
    gmv: findColumn(headers, [/店铺总gmv/, /^gmv$/, /总销售额/, /销售额/]),
    netRevenue: findColumn(headers, [/店铺总回款/, /回款.*减退款/, /当日净成交金额/, /实际回款/]),
    refund: findColumn(headers, [/成功退款金额/, /总退款金额/, /退款金额/]),
    spend: findColumn(headers, [/店铺总推广费/, /站内总推广费/, /^消费$/, /消耗/, /总推广费/]),
    exposure: findColumn(headers, [/商品曝光人数/, /展现量/, /^曝光$/, /浏览量/]),
    clicks: findColumn(headers, [/商品点击人数/, /点击量/, /^点击$/, /店铺客户数/]),
    paidOrders: findColumn(headers, [/成交订单量/, /支付订单/, /订单量/]),
    addToCart: findColumn(headers, [/加购人数/, /日加购/, /^加购$/]),
    favorite: findColumn(headers, [/^收藏$/, /收藏量/]),
  };
}

function parseDetailSheet(sheet) {
  const rows = sheet.data;
  const headerIndex = rows.findIndex((row) => row.some((value) => /^日期/.test(textValue(value))));
  if (headerIndex < 0) return { rows: 0, period: { start: null, end: null }, daily: [], headers: [] };
  const dateIndex = rows[headerIndex].findIndex((value) => /^日期/.test(textValue(value)));
  const firstDataIndex = rows.findIndex((row, index) => index > headerIndex && dateValue(row[dateIndex]));
  if (firstDataIndex < 0) return { rows: 0, period: { start: null, end: null }, daily: [], headers: [] };
  const columnCount = Math.max(...rows.slice(headerIndex, firstDataIndex).map((row) => row.length), 0);
  const headers = Array.from({ length: columnCount }, (_, column) => rows
    .slice(headerIndex, firstDataIndex)
    .map((row) => textValue(row[column]))
    .filter(Boolean)
    .join(" "));
  const indexes = detailMetricIndexes(headers);
  const storeIndex = findColumn(headers, [/^店铺$/, /店铺名称/]);
  const today = new Date().toISOString().slice(0, 10);
  const daily = [];
  for (const row of rows.slice(firstDataIndex)) {
    const date = dateValue(row[dateIndex]);
    if (!date || date > today) continue;
    daily.push({
      date,
      platform: platformName(sheet.sheet),
      store: storeIndex >= 0 ? textValue(row[storeIndex]) : "",
      ...metricShape(Object.fromEntries(Object.entries(indexes).map(([field, index]) => [field, index >= 0 ? numberValue(row[index]) : 0]))),
    });
  }
  const dates = daily.map((row) => row.date).sort();
  return { rows: daily.length, period: { start: dates[0] ?? null, end: dates.at(-1) ?? null }, daily, headers };
}

const douyinStoreColumns = [
  { store: "抖音1", gmv: 9, netRevenue: 20, spend: 24, refunds: [11, 13] },
  { store: "抖音2", gmv: 26, netRevenue: 31, spend: 33, refunds: [28] },
  { store: "抖音3", gmv: 35, netRevenue: 40, spend: 41, refunds: [37] },
  { store: "抖音达人", gmv: 44, netRevenue: 53, spend: 54, refunds: [46] },
];

function hasReportingActivity(item) {
  return ["gmv", "netRevenue", "refund", "spend", "exposure", "clicks", "paidOrders", "addToCart"]
    .some((field) => Number(item[field] || 0) !== 0);
}

function parseDouyinStoreDaily(sheet) {
  if (!sheet) return [];
  const rows = sheet.data ?? [];
  const headerIndex = rows.findIndex((row) => row.some((value) => /^日期/.test(textValue(value))));
  if (headerIndex < 0) return [];
  const dateIndex = rows[headerIndex].findIndex((value) => /^日期/.test(textValue(value)));
  const today = new Date().toISOString().slice(0, 10);
  const result = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const date = dateValue(row[dateIndex]);
    if (!date || date > today) continue;
    for (const columns of douyinStoreColumns) {
      const metrics = metricShape({
        gmv: numberValue(row[columns.gmv]),
        netRevenue: numberValue(row[columns.netRevenue]),
        spend: numberValue(row[columns.spend]),
        refund: columns.refunds.reduce((sum, index) => sum + numberValue(row[index]), 0),
      });
      if (hasReportingActivity(metrics)) result.push({ date, platform: "抖音", store: columns.store, ...metrics });
    }
  }
  return result;
}

function aggregateMetricRows(rows, keys) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keys.map((field) => String(row[field] ?? "")).join("\u0000");
    const current = grouped.get(key) ?? { ...Object.fromEntries(keys.map((field) => [field, row[field]])), ...metricShape() };
    addMetrics(current, row);
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

function dateInRange(date, start, end) {
  return date >= start && date <= end;
}

function shiftYear(date, offset) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCFullYear(value.getUTCFullYear() + offset);
  return value.toISOString().slice(0, 10);
}

function shiftDay(date, offset) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function dateSequence(start, end) {
  const result = [];
  for (let date = start; date <= end; date = shiftDay(date, 1)) result.push(date);
  return result;
}

function comparisonChange(current, previous) {
  if (!previous) return current ? null : 0;
  return current / previous - 1;
}

function comparisonItem(level, row, previous) {
  const currentMetric = reportingMetricShape(row);
  const previousMetric = reportingMetricShape(previous ?? {});
  return {
    level,
    platform: platformName(row.platform),
    name: level === "channel" ? platformName(row.platform) : row.store,
    netRevenue: currentMetric.netRevenue,
    netRevenueChange: comparisonChange(currentMetric.netRevenue, previousMetric.netRevenue),
    spend: currentMetric.spend,
    spendChange: comparisonChange(currentMetric.spend, previousMetric.spend),
    feeRate: currentMetric.feeRate,
    feeRateChange: comparisonChange(currentMetric.feeRate, previousMetric.feeRate),
    refundRate: currentMetric.refundRate,
    refundRateChange: comparisonChange(currentMetric.refundRate, previousMetric.refundRate),
  };
}

function buildLatestComparison(snapshot) {
  const asOf = snapshot.reporting.completedThrough;
  const previousDate = shiftDay(asOf, -1);
  const platformRows = snapshot.reporting.dailyPlatforms.map((row) => ({ ...row, platform: platformName(row.platform) }));
  const currentChannels = aggregateMetricRows(platformRows.filter((row) => row.date === asOf), ["platform"]);
  const previousChannels = new Map(aggregateMetricRows(platformRows.filter((row) => row.date === previousDate), ["platform"])
    .map((row) => [row.platform, row]));
  const channels = currentChannels
    .map((row) => comparisonItem("channel", row, previousChannels.get(row.platform)))
    .sort((left, right) => right.netRevenue - left.netRevenue);

  const storeRows = snapshot.reporting.dailyStores.map((row) => ({ ...row, platform: platformName(row.platform) }));
  const currentStores = aggregateMetricRows(storeRows.filter((row) => row.date === asOf), ["platform", "store"]);
  const previousStores = new Map(aggregateMetricRows(storeRows.filter((row) => row.date === previousDate), ["platform", "store"])
    .map((row) => [`${row.platform}\u0000${row.store}`, row]));
  const stores = currentStores
    .map((row) => comparisonItem("store", row, previousStores.get(`${row.platform}\u0000${row.store}`)))
    .sort((left, right) => right.netRevenue - left.netRevenue);
  return { asOf, previousDate, channels, stores };
}

function buildMonthlyOverview(snapshot, end) {
  const month = end.slice(0, 7);
  const monthNumber = end.slice(5, 7);
  const start = `${month}-01`;
  const platformRows = snapshot.reporting.dailyPlatforms
    .filter((row) => dateInRange(row.date, start, end))
    .map((row) => ({ ...row, platform: platformName(row.platform) }));
  const current = platformRows.reduce((total, row) => addMetrics(total, row), metricShape());
  const offsiteSpend = snapshot.reporting.dailyOffsiteSpend
    .filter((row) => dateInRange(row.date, start, end))
    .reduce((sum, row) => sum + Number(row.spend || 0), 0);
  const priorStart = shiftYear(start, -1);
  const priorEnd = shiftYear(end, -1);
  const priorYearNetRevenue = snapshot.reporting.dailyPlatforms
    .filter((row) => dateInRange(row.date, priorStart, priorEnd))
    .reduce((sum, row) => sum + Number(row.netRevenue || 0), 0);
  const target = Number(snapshot.reporting.monthlyTargets?.[monthNumber]
    || (month === snapshot.reporting.completedThrough.slice(0, 7) ? snapshot.totals.target : 0)
    || 0);
  const sourceSummary = end === snapshot.reporting.completedThrough
    && snapshot.monthly?.month === `${Number(monthNumber)}月`;
  const sourceNetRevenue = Number(snapshot.monthly?.netRevenue || 0);
  const sourceYoy = Number(snapshot.monthly?.yoy || 0);
  const metrics = sourceSummary ? {
    netRevenue: sourceNetRevenue,
    priorYearNetRevenue: sourceYoy === -1 ? 0 : sourceNetRevenue / (1 + sourceYoy),
    yoy: sourceYoy,
    onsiteSpend: Number(snapshot.monthly?.onsiteSpend || 0),
    offsiteSpend: Number(snapshot.monthly?.offsiteSpend || 0),
    onsiteFeeRate: Number(snapshot.monthly?.onsiteFeeRate || (sourceNetRevenue ? snapshot.monthly?.onsiteSpend / sourceNetRevenue : 0)),
    offsiteFeeRate: Number(snapshot.monthly?.offsiteFeeRate || (sourceNetRevenue ? snapshot.monthly?.offsiteSpend / sourceNetRevenue : 0)),
    totalFeeRate: Number(snapshot.monthly?.totalSpendRate || (sourceNetRevenue ? (snapshot.monthly?.onsiteSpend + snapshot.monthly?.offsiteSpend) / sourceNetRevenue : 0)),
    target,
    completionRate: Number(snapshot.monthly?.completionRate || (target ? sourceNetRevenue / target : 0)),
  } : {
    netRevenue: current.netRevenue,
    priorYearNetRevenue,
    yoy: priorYearNetRevenue ? current.netRevenue / priorYearNetRevenue - 1 : null,
    onsiteSpend: current.spend,
    offsiteSpend,
    onsiteFeeRate: current.netRevenue ? current.spend / current.netRevenue : 0,
    offsiteFeeRate: current.netRevenue ? offsiteSpend / current.netRevenue : 0,
    totalFeeRate: current.netRevenue ? (current.spend + offsiteSpend) / current.netRevenue : 0,
    target,
    completionRate: target ? current.netRevenue / target : 0,
  };
  const channelOrder = aggregateMetricRows(platformRows, ["platform"])
    .sort((left, right) => right.netRevenue - left.netRevenue)
    .map((row) => row.platform);
  const dayMap = new Map(aggregateMetricRows(platformRows, ["date", "platform"])
    .map((row) => [`${row.date}\u0000${row.platform}`, row]));
  const daily = dateSequence(start, end).map((date) => {
    const channels = channelOrder.map((platform) => ({
      platform,
      netRevenue: Number(dayMap.get(`${date}\u0000${platform}`)?.netRevenue || 0),
    }));
    return { date, totalNetRevenue: channels.reduce((sum, row) => sum + row.netRevenue, 0), channels };
  });
  return {
    month,
    label: `${Number(month.slice(5, 7))}月 MTD`,
    period: { start, end },
    metrics,
    daily,
    source: sourceSummary ? "全渠道数据表第2-3行及其跨表依赖" : "按筛选结束日期重算的跨渠道日明细",
  };
}

function normalizedReportingPeriod(snapshot, range = {}) {
  const reporting = snapshot.reporting;
  const available = reporting.availablePeriod;
  const defaultStart = snapshot.period?.start && snapshot.period.start >= available.start
    ? snapshot.period.start
    : available.start;
  const defaultEnd = snapshot.period?.end && snapshot.period.end <= reporting.completedThrough
    ? snapshot.period.end
    : reporting.completedThrough;
  const start = range.start || defaultStart;
  const end = range.end || defaultEnd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error("日期格式必须为 YYYY-MM-DD");
  if (start > end) throw new Error("开始日期不能晚于结束日期");
  if (start < available.start || end > reporting.completedThrough) {
    throw new Error(`日期范围必须在 ${available.start} 至 ${reporting.completedThrough} 之间`);
  }
  return { start, end };
}

export function filterDingTalkSnapshot(snapshot, range = {}) {
  if (!snapshot?.reporting?.dailyPlatforms?.length) return snapshot;
  const period = normalizedReportingPeriod(snapshot, range);
  const platformDaily = snapshot.reporting.dailyPlatforms
    .filter((row) => dateInRange(row.date, period.start, period.end))
    .map((row) => ({ ...row, platform: platformName(row.platform) }));
  const platformBase = aggregateMetricRows(platformDaily, ["platform"]);
  const totalsBase = platformBase.reduce((current, row) => addMetrics(current, row), metricShape());
  const totals = reportingMetricShape(totalsBase, 1);
  const platforms = platformBase
    .map((row) => reportingMetricShape(row, totals.netRevenue ? row.netRevenue / totals.netRevenue : 0))
    .sort((left, right) => right.netRevenue - left.netRevenue);

  const storeDaily = snapshot.reporting.dailyStores
    .filter((row) => dateInRange(row.date, period.start, period.end))
    .map((row) => ({ ...row, platform: platformName(row.platform) }));
  const offsiteSpend = snapshot.reporting.dailyOffsiteSpend
    .filter((row) => dateInRange(row.date, period.start, period.end))
    .reduce((sum, row) => sum + Number(row.spend || 0), 0);
  const stores = aggregateMetricRows(storeDaily, ["platform", "store"])
    .map((row) => ({
      ...reportingMetricShape(row, totals.netRevenue ? row.netRevenue / totals.netRevenue : 0),
      offsiteSpend: row.platform === "天猫" && row.store === "麻大师旗舰店" ? offsiteSpend : 0,
    }))
    .sort((left, right) => right.netRevenue - left.netRevenue);
  const daily = aggregateMetricRows(platformDaily, ["date"])
    .map((row) => ({ date: row.date, ...reportingMetricShape(row) }))
    .sort((left, right) => left.date.localeCompare(right.date));

  return {
    ...snapshot,
    period,
    totals,
    platforms,
    stores,
    daily,
    reporting: {
      availablePeriod: snapshot.reporting.availablePeriod,
      completedThrough: snapshot.reporting.completedThrough,
      selectedPeriod: period,
      monthlyOverview: buildMonthlyOverview(snapshot, period.end),
      latestComparison: buildLatestComparison(snapshot),
      formulaLineage: snapshot.reporting.formulaLineage,
    },
  };
}

export function buildDingTalkSnapshot(sheets) {
  const sheetMap = new Map(sheets.map((sheet) => [sheet.sheet, sheet.data]));
  const summary = parseSummarySheet(sheetMap.get("全渠道数据表") ?? []);
  const endDate = summary.period.end ?? new Date().toISOString().slice(0, 10);
  const month = Number(endDate.slice(5, 7));
  const targets = parseTargets(sheetMap.get("销售目标") ?? [], month);
  const platforms = summary.platforms.map((item) => {
    const target = targets.byPlatform.get(item.platform) || 0;
    return { ...item, target, completionRate: target ? item.netRevenue / target : 0 };
  });
  const totalBase = summary.totals ?? metricShape(platforms.reduce((accumulator, item) => addMetrics(accumulator, item), {}));
  const totals = { ...totalBase, target: targets.total, completionRate: targets.total ? totalBase.netRevenue / targets.total : summary.monthly.completionRate };

  const details = sheets.filter((sheet) => !ignoredDetailSheets.has(sheet.sheet)).map((sheet) => ({ sheet: sheet.sheet, ...parseDetailSheet(sheet) }));
  const dailyMap = new Map();
  for (const detail of details) {
    for (const row of detail.daily) {
      const current = dailyMap.get(row.date) ?? metricShape();
      dailyMap.set(row.date, metricShape(addMetrics(current, row)));
    }
  }
  const daily = [...dailyMap.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-180).map(([date, values]) => ({ date, ...values }));
  const period = {
    start: summary.period.start ?? daily[0]?.date ?? null,
    end: summary.period.end ?? daily.at(-1)?.date ?? null,
  };
  const recordCount = details.reduce((sum, detail) => sum + detail.rows, 0);
  const reportingDetails = details.filter((detail) => detail.sheet !== "小红书推广");
  const dailyPlatforms = aggregateMetricRows(reportingDetails.flatMap((detail) => detail.daily), ["date", "platform"])
    .sort((left, right) => left.date.localeCompare(right.date) || left.platform.localeCompare(right.platform));
  const genericStoreDaily = reportingDetails.flatMap((detail) => detail.daily.filter((row) => row.store));
  const douyinStoreDaily = parseDouyinStoreDaily(sheets.find((sheet) => sheet.sheet === "抖音"));
  const dailyStores = aggregateMetricRows([...genericStoreDaily.filter((row) => row.platform !== "抖音"), ...douyinStoreDaily], ["date", "platform", "store"])
    .sort((left, right) => left.date.localeCompare(right.date) || left.store.localeCompare(right.store));
  const offsiteDetail = details.find((detail) => detail.sheet === "小红书推广");
  const dailyOffsiteSpend = aggregateMetricRows(offsiteDetail?.daily ?? [], ["date"]).map((row) => ({ date: row.date, spend: row.spend }));
  const activeDates = [...new Set(dailyPlatforms.filter(hasReportingActivity).map((row) => row.date))].sort();
  const availablePeriod = { start: activeDates[0] ?? null, end: activeDates.at(-1) ?? null };
  const completedThrough = activeDates.at(-1) ?? null;

  return {
    source: "dingtalk_api",
    refreshedAt: new Date().toISOString(),
    sourceFile: "钉钉 Sheet API",
    syncMode: "http_sheet_api",
    schedule: scheduleTimes(),
    period,
    monthly: summary.monthly,
    totals,
    platforms,
    stores: summary.stores.slice(0, 100),
    daily,
    reporting: {
      availablePeriod,
      completedThrough,
      selectedPeriod: null,
      dailyPlatforms,
      dailyStores,
      dailyOffsiteSpend,
      monthlyTargets: targets.monthlyTotals,
      formulaLineage: {
        summary: "全渠道数据表!A2:I3 → C53/E53/F53/G53/H53/L57",
        monthlyRollup: "全渠道数据表!A45:L74 → 各渠道及店铺日明细",
        target: "销售目标!A2:O10 → 对应月份总计",
      },
    },
    inventory: sheets.map((sheet) => {
      const detail = details.find((item) => item.sheet === sheet.sheet);
      return {
        name: sheet.sheet,
        headerRow: 1,
        rowCount: sheet.data.length,
        rowsWithMetrics: detail?.rows ?? 0,
        detectedFields: (detail?.headers ?? []).filter(Boolean).slice(0, 30),
        missingDimensions: [],
        detectedMetricCount: detail ? Object.values(detailMetricIndexes(detail.headers ?? [])).filter((index) => index >= 0).length : 0,
        blockedFields: [],
        ignoredFields: [],
        dimensionCounts: {},
        anomalyCount: 0,
        period: detail?.period ?? { start: null, end: null },
      };
    }),
    dimensions: {
      storeCount: summary.stores.length,
      productCount: 0,
      activityCount: 0,
      materialCount: 0,
      planCount: 0,
      ownerCount: 0,
    },
    quality: {
      sheetCount: sheets.length,
      anomalyCount: 0,
      invalidCellCount: 0,
      missingDimensionSheets: 0,
    },
    privacy: {
      persistedLevel: "渠道/店铺/日期/经营指标聚合",
      rawRowsPersisted: false,
      ownerValuesPersisted: false,
      blockedHeaders: [],
    },
    recordCount,
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export function checkDingTalkApi() {
  const configured = hasLocalEnv("DINGTALK_APP_KEY", "DINGTALK_APP_SECRET", "DINGTALK_WORKBOOK_ID", "DINGTALK_OPERATOR_ID");
  return {
    configured,
    mode: "http_sheet_api",
    schedule: scheduleTimes(),
    writeEnabled: false,
  };
}

export async function syncDingTalkApi() {
  const sheets = await listSheets();
  if (!sheets.length) throw new Error("钉钉工作簿未返回子表");
  const selectedNames = readLocalEnv("DINGTALK_SHEET_INCLUDE")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const selected = selectedNames.length ? sheets.filter((sheet) => selectedNames.includes(sheet.name)) : sheets;
  const concurrency = Math.max(1, Math.min(3, Number(readLocalEnv("DINGTALK_API_CONCURRENCY", "1")) || 1));
  const workbook = await mapWithConcurrency(selected, concurrency, readSheet);
  return buildDingTalkSnapshot(workbook);
}
