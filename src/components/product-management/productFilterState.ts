export interface ProductFilterState {
  start: string;
  end: string;
  statuses: string[];
  channels: string[];
  storeShortNames: string[];
  includeCodes: string;
  excludeCodes: string;
  includeIds: string;
  excludeIds: string;
}

export const EMPTY_PRODUCT_FILTERS: ProductFilterState = {
  start: "", end: "", statuses: [], channels: [], storeShortNames: [],
  includeCodes: "", excludeCodes: "", includeIds: "", excludeIds: "",
};

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
export const parseProductValues = (value: string) => unique(value.split(/[\n\t,，;；]+/));

export function normalizeProductFilters(value: ProductFilterState): ProductFilterState {
  return {
    start: value.start.trim(), end: value.end.trim(),
    statuses: unique(value.statuses), channels: unique(value.channels), storeShortNames: unique(value.storeShortNames),
    includeCodes: parseProductValues(value.includeCodes).join("\n"),
    excludeCodes: parseProductValues(value.excludeCodes).join("\n"),
    includeIds: parseProductValues(value.includeIds).join("\n"),
    excludeIds: parseProductValues(value.excludeIds).join("\n"),
  };
}

export const productFilterKey = (value: ProductFilterState) => JSON.stringify(normalizeProductFilters(value));

export function productFilterError(value: ProductFilterState) {
  if (Boolean(value.start) !== Boolean(value.end)) return "请选择开始和结束日期，或同时清除两个日期。";
  for (const date of [value.start, value.end].filter(Boolean)) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return "请选择有效日期。";
  }
  if (value.start > value.end) return "开始日期不能晚于结束日期。";
  if ([value.includeCodes, value.excludeCodes, value.includeIds, value.excludeIds].some((field) => parseProductValues(field).length > 200)) return "每个商品范围字段最多 200 条，请拆开筛选。";
  return "";
}

export function productFilterRequest(value: ProductFilterState) {
  const filter = normalizeProductFilters(value);
  return {
    start: filter.start || undefined, end: filter.end || undefined,
    statuses: filter.statuses, channels: filter.channels, storeShortNames: filter.storeShortNames,
    productCodes: parseProductValues(filter.includeCodes), excludeProductCodes: parseProductValues(filter.excludeCodes),
    productIds: parseProductValues(filter.includeIds), excludeProductIds: parseProductValues(filter.excludeIds),
  };
}

export function productFilterCount(value: ProductFilterState) {
  return Number(Boolean(value.start || value.end)) + value.statuses.length + value.channels.length + value.storeShortNames.length
    + [value.includeCodes, value.excludeCodes, value.includeIds, value.excludeIds].reduce((sum, field) => sum + parseProductValues(field).length, 0);
}

export function recentProductDays(period: { start: string; end: string }) {
  const end = period.end.slice(0, 10);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const startMs = Date.parse(`${period.start.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(endMs) || !Number.isFinite(startMs)) throw new Error("商品数据周期无效");
  return { start: new Date(Math.max(startMs, endMs - 6 * 86400000)).toISOString().slice(0, 10), end };
}
