export interface HierarchyDatum {
  date: string;
  year: string;
  month: string;
  day: string;
}

export interface DailyCoreDatum extends HierarchyDatum {
  productVisitors: number;
  addToCart: number;
  payBuyers: number;
  promotionCarts: number;
  addToCartRate: number | null;
  addToCartCost: number | null;
  payAmount: number;
  paidUnits: number;
  conversionRate: number | null;
  refundAmount: number;
  refundRate: number | null;
  spend: number;
  subsidizedAmount: number;
  subsidizedFeeRate: number | null;
  storeRank: string | null;
}

export type DailyCoreHierarchyLevel = "year" | "month" | "day";

export type HierarchyRow<D extends HierarchyDatum> = D & {
  hierarchyLevel: DailyCoreHierarchyLevel;
  hierarchyKey: string;
  showYear: boolean;
  showMonth: boolean;
};

export type DailyCoreHierarchyRow = HierarchyRow<DailyCoreDatum>;

export interface DailyCoreExpansion {
  years: Set<string>;
  months: Set<string>;
}

// 默认展开数据中所有（年|月）节点，保证当前期间内每个月的每日明细首屏都可见。
// 这样跨月默认期间（如近 7 天跨月）不会被折叠隐藏；折叠仍可手动收起年月。
export function pbixDefaultDailyCoreExpansion(
  rows: Array<Pick<DailyCoreDatum, "year" | "month">>,
): DailyCoreExpansion {
  const years = new Set<string>();
  const months = new Set<string>();
  rows.forEach((row) => {
    years.add(row.year);
    months.add(`${row.year}|${row.month}`);
  });
  return { years, months };
}

function divide(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}

function minimumStoreRank(rows: DailyCoreDatum[]): string | null {
  const available = rows
    .map((row) => row.storeRank?.trim())
    .filter((value): value is string => Boolean(value));
  if (!available.length) return null;
  return available.reduce((minimum, value) => {
    const minimumNumber = Number(minimum.replace(/,/g, ""));
    const valueNumber = Number(value.replace(/,/g, ""));
    if (Number.isFinite(minimumNumber) && Number.isFinite(valueNumber)) {
      return valueNumber < minimumNumber ? value : minimum;
    }
    return value.localeCompare(minimum, "zh-CN", { numeric: true }) < 0 ? value : minimum;
  });
}

function aggregateDailyCoreRows(
  rows: DailyCoreDatum[],
  hierarchyLevel: Exclude<DailyCoreHierarchyLevel, "day">,
  _hierarchyKey: string,
): DailyCoreDatum {
  const first = rows[0];
  const totals = rows.reduce((result, row) => ({
    productVisitors: result.productVisitors + (row.productVisitors || 0),
    addToCart: result.addToCart + (row.addToCart || 0),
    payBuyers: result.payBuyers + (row.payBuyers || 0),
    promotionCarts: result.promotionCarts + (row.promotionCarts || 0),
    payAmount: result.payAmount + (row.payAmount || 0),
    paidUnits: result.paidUnits + (row.paidUnits || 0),
    refundAmount: result.refundAmount + (row.refundAmount || 0),
    spend: result.spend + (row.spend || 0),
    subsidizedAmount: result.subsidizedAmount + (row.subsidizedAmount || 0),
  }), {
    productVisitors: 0,
    addToCart: 0,
    payBuyers: 0,
    promotionCarts: 0,
    payAmount: 0,
    paidUnits: 0,
    refundAmount: 0,
    spend: 0,
    subsidizedAmount: 0,
  });

  return {
    date: first?.date ?? "",
    year: first?.year ?? "",
    month: hierarchyLevel === "month" ? first?.month ?? "" : "",
    day: "",
    ...totals,
    addToCartRate: divide(totals.addToCart, totals.productVisitors),
    addToCartCost: divide(totals.spend, totals.promotionCarts),
    conversionRate: divide(totals.payBuyers, totals.productVisitors),
    refundRate: divide(totals.refundAmount, totals.payAmount),
    subsidizedFeeRate: divide(totals.spend, totals.subsidizedAmount),
    storeRank: minimumStoreRank(rows),
  };
}

type AggregateHierarchyFn<D extends HierarchyDatum> = (
  rows: D[],
  level: Exclude<DailyCoreHierarchyLevel, "day">,
  key: string,
) => D;

export function buildDailyHierarchy<D extends HierarchyDatum>(
  rows: D[],
  expandedYears: ReadonlySet<string>,
  expandedMonths: ReadonlySet<string>,
  aggregate: AggregateHierarchyFn<D>,
): HierarchyRow<D>[] {
  const years = new Map<string, Map<string, D[]>>();
  rows.forEach((row) => {
    const months = years.get(row.year) ?? new Map<string, D[]>();
    const monthRows = months.get(row.month) ?? [];
    monthRows.push(row);
    months.set(row.month, monthRows);
    years.set(row.year, months);
  });

  const visible: HierarchyRow<D>[] = [];
  years.forEach((months, year) => {
    const yearRows = [...months.values()].flat();
    if (!expandedYears.has(year)) {
      visible.push({
        ...aggregate(yearRows, "year", year),
        hierarchyLevel: "year",
        hierarchyKey: year,
        showYear: true,
        showMonth: false,
      });
      return;
    }

    let isFirstYearRow = true;
    months.forEach((monthRows, month) => {
      const monthKey = `${year}|${month}`;
      if (!expandedMonths.has(monthKey)) {
        visible.push({
          ...aggregate(monthRows, "month", monthKey),
          hierarchyLevel: "month",
          hierarchyKey: monthKey,
          showYear: isFirstYearRow,
          showMonth: true,
        });
        isFirstYearRow = false;
        return;
      }

      monthRows.forEach((row, index) => {
        visible.push({
          ...row,
          hierarchyLevel: "day",
          hierarchyKey: row.date,
          showYear: isFirstYearRow && index === 0,
          showMonth: index === 0,
        });
      });
      if (monthRows.length) isFirstYearRow = false;
    });
  });
  return visible;
}

export function buildDailyCoreHierarchy(
  rows: DailyCoreDatum[],
  expandedYears: ReadonlySet<string>,
  expandedMonths: ReadonlySet<string>,
): DailyCoreHierarchyRow[] {
  return buildDailyHierarchy(rows, expandedYears, expandedMonths, aggregateDailyCoreRows);
}
