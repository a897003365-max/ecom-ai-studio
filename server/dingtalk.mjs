import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import readExcelFile from "read-excel-file/node";

const fieldAliases = {
  date: ["日期", "数据日期", "统计日期", "投放日期", "业务日期", "date"],
  updatedAt: ["更新时间", "更新日期", "最后更新时间", "updatedat"],
  platform: ["平台", "渠道", "推广平台", "媒体平台", "platform"],
  store: ["店铺", "店铺名称", "门店", "store"],
  product: ["商品", "商品名", "商品名称", "产品", "产品名", "产品名称", "product"],
  activity: ["活动", "活动名称", "营销活动", "activity"],
  material: ["素材", "素材名称", "创意", "创意名称", "material"],
  plan: ["计划", "计划名称", "投放计划", "推广计划", "plan"],
  owner: ["负责人", "运营负责人", "投放负责人", "owner"],
  exposure: ["曝光", "曝光量", "展现", "展现量", "impression", "impressions"],
  clicks: ["点击", "点击量", "click", "clicks"],
  spend: ["消耗", "消耗元", "花费", "花费元", "推广费", "推广花费", "spend", "cost"],
  paidOrders: ["支付订单", "支付订单量", "成交订单", "成交订单量", "订单数", "paidorders"],
  gmv: ["gmv", "gmv元", "成交金额", "支付金额", "销售额", "成交额"],
  refund: ["退款", "退款金额", "退款额", "refund"],
  favorite: ["收藏", "收藏量", "favorite", "favorites"],
  addToCart: ["加购", "加购量", "加入购物车", "addtocart"],
  target: ["目标值", "目标", "业绩目标", "target"],
  budget: ["预算", "预算值", "计划预算", "budget"],
  anomaly: ["异常说明", "异常原因", "问题说明", "备注说明", "anomaly"],
};

const fieldLabels = {
  date: "日期",
  updatedAt: "更新时间",
  platform: "平台",
  store: "店铺",
  product: "商品",
  activity: "活动",
  material: "素材",
  plan: "计划",
  owner: "负责人",
  exposure: "曝光",
  clicks: "点击",
  spend: "消耗",
  paidOrders: "支付订单",
  gmv: "GMV",
  refund: "退款",
  favorite: "收藏",
  addToCart: "加购",
  target: "目标值",
  budget: "预算值",
  anomaly: "异常说明",
};

const metricFields = ["exposure", "clicks", "spend", "paidOrders", "gmv", "refund", "favorite", "addToCart", "target", "budget"];
const dimensionFields = ["store", "product", "activity", "material", "plan", "owner"];
const requiredDimensions = ["date", "platform"];
const sensitiveHeader = /(手机号|手机号码|联系电话|电话|身份证|收货|详细地址|买家|用户\s*id|user\s*id|open\s*id|union\s*id|cookie|token|secret|密码|账号链接|主页链接|发布链接|xsec|url)/i;

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-—:：/\\()（）[\]【】]/g, "")
    .replace(/[￥¥]/g, "元");
}

const aliases = new Map(
  Object.entries(fieldAliases).flatMap(([field, values]) => values.map((value) => [normalizeHeader(value), field])),
);

function logicalField(value) {
  return aliases.get(normalizeHeader(value)) ?? null;
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function safeHeader(value, fallback) {
  const text = String(value ?? "").trim().replace(/[\r\n\t]+/g, " ");
  return (text || fallback).slice(0, 80);
}

function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", "\t", ";"]
    .map((candidate) => ({ candidate, count: firstLine.split(candidate).length - 1 }))
    .sort((a, b) => b.count - a.count)[0]?.candidate ?? ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => !isBlank(value))) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell);
  if (row.some((value) => !isBlank(value))) rows.push(row);
  return rows;
}

function objectRowsToGrid(items) {
  const headers = [...new Set(items.slice(0, 500).flatMap((item) => Object.keys(item ?? {})))];
  return [headers, ...items.map((item) => headers.map((header) => item?.[header] ?? null))];
}

function jsonToSheets(value) {
  if (Array.isArray(value)) {
    if (value.every((row) => Array.isArray(row))) return [{ sheet: "JSON", data: value }];
    if (value.every((row) => row && typeof row === "object")) return [{ sheet: "JSON", data: objectRowsToGrid(value) }];
  }
  if (Array.isArray(value?.sheets)) {
    return value.sheets.map((sheet, index) => ({
      sheet: safeHeader(sheet?.name ?? sheet?.sheet, `Sheet${index + 1}`),
      data: Array.isArray(sheet?.data)
        ? sheet.data
        : Array.isArray(sheet?.rows) && sheet.rows.every((row) => Array.isArray(row))
          ? sheet.rows
          : objectRowsToGrid(Array.isArray(sheet?.rows) ? sheet.rows : []),
    }));
  }
  if (Array.isArray(value?.rows)) {
    const data = value.rows.every((row) => Array.isArray(row)) ? value.rows : objectRowsToGrid(value.rows);
    return [{ sheet: safeHeader(value?.sheet, "JSON"), data }];
  }
  throw new Error("JSON 需要是二维数组、对象数组，或包含 sheets/rows 的对象");
}

async function readWorkbook(filePath, fileName) {
  const extension = extname(fileName || filePath).toLowerCase();
  if (extension === ".xlsx") return readExcelFile(filePath);
  const text = await readFile(filePath, "utf8");
  if (extension === ".csv") return [{ sheet: "CSV", data: parseCsv(text) }];
  if (extension === ".json") return jsonToSheets(JSON.parse(text.replace(/^\uFEFF/, "")));
  throw new Error("钉钉导入仅支持 CSV、XLSX、JSON");
}

function detectHeader(rows) {
  const candidates = rows.slice(0, 30).map((row, index) => {
    const detected = new Set(row.map(logicalField).filter(Boolean));
    const metrics = metricFields.filter((field) => detected.has(field)).length;
    const nonEmpty = row.filter((value) => !isBlank(value)).length;
    return { index, score: detected.size * 10 + metrics * 3 + Math.min(nonEmpty, 10), detected: detected.size, nonEmpty };
  });
  const best = candidates.sort((a, b) => b.score - a.score || a.index - b.index)[0];
  if (best?.detected >= 2) return best.index;
  return candidates.find((candidate) => candidate.nonEmpty >= 2)?.index ?? 0;
}

function numeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isBlank(value)) return 0;
  const normalized = String(value).trim().replace(/[￥¥,，\s]/g, "").replace(/元$/, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 25_000 && value < 80_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  if (isBlank(value)) return null;
  const text = String(value).trim().replace(/[年月]/g, "-").replace(/日/g, "").replace(/[./]/g, "-");
  const match = text.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function cleanDimension(value) {
  if (isBlank(value)) return null;
  return String(value).trim().replace(/[\r\n\t]+/g, " ").slice(0, 80);
}

function emptyMetrics() {
  return Object.fromEntries(metricFields.map((field) => [field, 0]));
}

function addMetrics(target, values) {
  metricFields.forEach((field) => {
    target[field] += values[field] ?? 0;
  });
}

function publicMetrics(values) {
  return {
    exposure: values.exposure,
    clicks: values.clicks,
    spend: values.spend,
    paidOrders: values.paidOrders,
    gmv: values.gmv,
    refund: values.refund,
    favorite: values.favorite,
    addToCart: values.addToCart,
    target: values.target,
    budget: values.budget,
    ctr: values.exposure ? values.clicks / values.exposure : 0,
    roi: values.spend ? values.gmv / values.spend : 0,
  };
}

function aggregateSheet(sheet, globalState) {
  const rows = Array.isArray(sheet.data) ? sheet.data : [];
  if (!rows.length) return null;
  const headerIndex = detectHeader(rows);
  const headers = rows[headerIndex] ?? [];
  const fieldIndexes = {};
  const blockedFields = [];
  const ignoredFields = [];

  headers.forEach((header, index) => {
    const label = safeHeader(header, `列${index + 1}`);
    if (sensitiveHeader.test(label)) {
      blockedFields.push(label);
      return;
    }
    const field = logicalField(label);
    if (field && fieldIndexes[field] === undefined) fieldIndexes[field] = index;
    else ignoredFields.push(label);
  });

  const localDimensions = Object.fromEntries(dimensionFields.map((field) => [field, new Set()]));
  const invalidMetrics = Object.fromEntries(metricFields.map((field) => [field, 0]));
  let rowCount = 0;
  let rowsWithMetrics = 0;
  let anomalyCount = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    if (!Array.isArray(row) || !row.some((value) => !isBlank(value))) continue;
    rowCount += 1;
    const values = emptyMetrics();
    let hasMetric = false;

    metricFields.forEach((field) => {
      const index = fieldIndexes[field];
      if (index === undefined) return;
      const value = numeric(row[index]);
      if (value === null) {
        invalidMetrics[field] += 1;
        return;
      }
      values[field] = value;
      if (value !== 0) hasMetric = true;
    });
    if (hasMetric) rowsWithMetrics += 1;
    addMetrics(globalState.totals, values);

    const platform = cleanDimension(row[fieldIndexes.platform]) ?? "未标注";
    const platformMetrics = globalState.platforms.get(platform) ?? emptyMetrics();
    addMetrics(platformMetrics, values);
    globalState.platforms.set(platform, platformMetrics);

    const date = dateKey(row[fieldIndexes.date]);
    if (date) {
      globalState.dates.add(date);
      const dateMetrics = globalState.daily.get(date) ?? emptyMetrics();
      addMetrics(dateMetrics, values);
      globalState.daily.set(date, dateMetrics);
    }

    dimensionFields.forEach((field) => {
      const value = cleanDimension(row[fieldIndexes[field]]);
      if (value) {
        localDimensions[field].add(value);
        globalState.dimensions[field].add(value);
      }
    });
    if (!isBlank(row[fieldIndexes.anomaly])) anomalyCount += 1;
  }

  globalState.recordCount += rowCount;
  globalState.anomalyCount += anomalyCount;
  Object.entries(invalidMetrics).forEach(([field, count]) => {
    globalState.invalidMetrics[field] += count;
  });

  const detectedFields = Object.keys(fieldIndexes).map((field) => fieldLabels[field]);
  const missingDimensions = requiredDimensions.filter((field) => fieldIndexes[field] === undefined).map((field) => fieldLabels[field]);
  const detectedMetricCount = metricFields.filter((field) => fieldIndexes[field] !== undefined).length;
  return {
    name: safeHeader(sheet.sheet, "未命名工作表"),
    headerRow: headerIndex + 1,
    rowCount,
    rowsWithMetrics,
    detectedFields,
    missingDimensions,
    detectedMetricCount,
    blockedFields: blockedFields.slice(0, 20),
    ignoredFields: ignoredFields.filter((value) => value).slice(0, 20),
    dimensionCounts: Object.fromEntries(dimensionFields.map((field) => [field, localDimensions[field].size])),
    anomalyCount,
  };
}

export async function parseDingTalkFile({ filePath, fileName }) {
  const sheets = await readWorkbook(filePath, fileName);
  const state = {
    totals: emptyMetrics(),
    platforms: new Map(),
    daily: new Map(),
    dates: new Set(),
    dimensions: Object.fromEntries(dimensionFields.map((field) => [field, new Set()])),
    invalidMetrics: Object.fromEntries(metricFields.map((field) => [field, 0])),
    recordCount: 0,
    anomalyCount: 0,
  };
  const inventory = sheets.map((sheet) => aggregateSheet(sheet, state)).filter(Boolean);
  if (!inventory.length || state.recordCount === 0) throw new Error("未在文件中识别到可用数据行");

  const dates = [...state.dates].sort();
  const platforms = [...state.platforms.entries()]
    .map(([platform, values]) => ({ platform, ...publicMetrics(values) }))
    .sort((a, b) => b.gmv - a.gmv || b.spend - a.spend || b.clicks - a.clicks);
  const daily = [...state.daily.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-180)
    .map(([date, values]) => ({ date, ...publicMetrics(values) }));
  const invalidCellCount = Object.values(state.invalidMetrics).reduce((sum, value) => sum + value, 0);

  return {
    source: "dingtalk_export",
    refreshedAt: new Date().toISOString(),
    sourceFile: `钉钉导出文件${extname(fileName).toLowerCase()}`,
    period: { start: dates[0] ?? null, end: dates.at(-1) ?? null },
    totals: publicMetrics(state.totals),
    platforms,
    daily,
    inventory,
    dimensions: Object.fromEntries(dimensionFields.map((field) => [`${field}Count`, state.dimensions[field].size])),
    quality: {
      sheetCount: inventory.length,
      anomalyCount: state.anomalyCount,
      invalidCellCount,
      missingDimensionSheets: inventory.filter((sheet) => sheet.missingDimensions.length > 0).length,
    },
    privacy: {
      persistedLevel: "平台/日期/经营指标聚合",
      rawRowsPersisted: false,
      ownerValuesPersisted: false,
      blockedHeaders: [...new Set(inventory.flatMap((sheet) => sheet.blockedFields))],
    },
    recordCount: state.recordCount,
  };
}
