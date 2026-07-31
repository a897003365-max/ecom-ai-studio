export interface DailyCoreDatum {
  date: string;
  year: string;
  month: string;
  day: string;
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

export interface DailyCoreHierarchyRow extends DailyCoreDatum {
  hierarchyLevel: DailyCoreHierarchyLevel;
  hierarchyKey: string;
  showYear: boolean;
  showMonth: boolean;
}

export interface DailyCoreExpansion {
  years: Set<string>;
  months: Set<string>;
}

const PBIX_SAVED_EXPANDED_YEARS = ["2026"];
const PBIX_SAVED_EXPANDED_MONTHS = ["2026|07月"];

export function pbixDefaultDailyCoreExpansion(
  rows: Array<Pick<DailyCoreDatum, "year" | "month">>,
): DailyCoreExpansion {
  const availableYears = new Set(rows.map((row) => row.year));
  const availableMonths = new Set(rows.map((row) => `${row.year}|${row.month}`));
  return {
    years: new Set(PBIX_SAVED_EXPANDED_YEARS.filter((year) => availableYears.has(year))),
    months: new Set(PBIX_SAVED_EXPANDED_MONTHS.filter((month) => availableMonths.has(month))),
  };
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
  hierarchyKey: string,
): DailyCoreHierarchyRow {
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
    hierarchyLevel,
    hierarchyKey,
    showYear: true,
    showMonth: hierarchyLevel === "month",
  };
}

export function buildDailyCoreHierarchy(
  rows: DailyCoreDatum[],
  expandedYears: ReadonlySet<string>,
  expandedMonths: ReadonlySet<string>,
): DailyCoreHierarchyRow[] {
  const years = new Map<string, Map<string, DailyCoreDatum[]>>();
  rows.forEach((row) => {
    const months = years.get(row.year) ?? new Map<string, DailyCoreDatum[]>();
    const monthRows = months.get(row.month) ?? [];
    monthRows.push(row);
    months.set(row.month, monthRows);
    years.set(row.year, months);
  });

  const visible: DailyCoreHierarchyRow[] = [];
  years.forEach((months, year) => {
    const yearRows = [...months.values()].flat();
    if (!expandedYears.has(year)) {
      visible.push(aggregateDailyCoreRows(yearRows, "year", year));
      return;
    }

    let isFirstYearRow = true;
    months.forEach((monthRows, month) => {
      const monthKey = `${year}|${month}`;
      if (!expandedMonths.has(monthKey)) {
        visible.push({
          ...aggregateDailyCoreRows(monthRows, "month", monthKey),
          showYear: isFirstYearRow,
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
