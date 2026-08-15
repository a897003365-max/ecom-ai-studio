import { useEffect, useMemo, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { BarChart3, Database, Search, Table2 } from "lucide-react";
import type {
  PowerBiDailyCore,
  PowerBiOverallDaily,
  PowerBiPages,
  PowerBiProductDaily,
  PowerBiPromotionDaily,
  WarehouseSnapshot,
} from "../types/integration";
import type { SearchTarget } from "../types/search";
import { clsx } from "../utils/format";
import { buildDailyCoreHierarchy, buildDailyHierarchy, pbixDefaultDailyCoreExpansion, type DailyCoreHierarchyRow } from "./powerBiDailyCoreHierarchy";

function toggleExpanded(setter: Dispatch<SetStateAction<Set<string>>>, key: string) {
  setter((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

type Workspace = "overview" | "diagnosis";
type ReplicaPage = "overall" | "promotion" | "product";
type DatePeriod = { start: string; end: string };

interface PowerBiReplicaProps {
  overview: ReactNode;
  warehouse: WarehouseSnapshot | null;
  period?: DatePeriod | null;
  searchTarget?: SearchTarget | null;
}

const moneyFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const moneyPreciseFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const countFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const PROMOTION_SUM_FIELDS = ["impressions", "clicks", "spend", "revenue", "carts", "directCarts", "consultations"] as const;

function money(value: number) {
  return `¥${moneyFormat.format((value || 0) / 10_000)}万`;
}

function moneyPrecise(value: number) {
  return `¥${moneyPreciseFormat.format((value || 0) / 10_000)}万`;
}

function number(value: number) {
  return countFormat.format(value || 0);
}

function percent(value: number) {
  return `${((Number.isFinite(value) ? value : 0) * 100).toFixed(2)}%`;
}

function pbixInteger(value: number) {
  return `${Math.round(value || 0)}`;
}

function pbixDecimal(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function pbixPercent(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(2)}%`;
}

function pbixWan(value: number) {
  return `${((value || 0) / 10_000).toFixed(2)}万`;
}

function rate(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}

function subsidizedAmount(row: PowerBiOverallDaily) {
  return ((row.payAmount || 0) - (row.refund || 0)) * 0.85;
}

function aggregateOverallDaily(rows: PowerBiOverallDaily[]): PowerBiOverallDaily {
  const total = rows.reduce((acc, row) => ({
    ...acc,
    visitors: acc.visitors + row.visitors,
    productVisitors: acc.productVisitors + row.productVisitors,
    addToCart: acc.addToCart + row.addToCart,
    payBuyers: acc.payBuyers + row.payBuyers,
    payAmount: acc.payAmount + row.payAmount,
    refund: acc.refund + row.refund,
    fullSiteSpend: acc.fullSiteSpend + row.fullSiteSpend,
    keywordSpend: acc.keywordSpend + row.keywordSpend,
    audienceSpend: acc.audienceSpend + row.audienceSpend,
    taokeSpend: acc.taokeSpend + row.taokeSpend,
    newVisitors: acc.newVisitors + row.newVisitors,
    returningVisitors: acc.returningVisitors + row.returningVisitors,
  }), {
    date: "",
    visitors: 0,
    productVisitors: 0,
    addToCart: 0,
    payBuyers: 0,
    payAmount: 0,
    refund: 0,
    fullSiteSpend: 0,
    keywordSpend: 0,
    audienceSpend: 0,
    taokeSpend: 0,
    newVisitors: 0,
    returningVisitors: 0,
    bounceRate: 0,
  } as PowerBiOverallDaily);
  total.bounceRate = total.visitors
    ? rows.reduce((sum, row) => sum + row.bounceRate * row.visitors, 0) / total.visitors
    : 0;
  return total;
}

function previousPeriod(start: string, end: string): { start: string; end: string } {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const days = Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const prevEnd = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return {
    start: prevStart.toISOString().slice(0, 10),
    end: prevEnd.toISOString().slice(0, 10),
  };
}

function shortDate(value: string) {
  return value.slice(5);
}

function ProductThumb({ src, alt, size = "sm" }: { src?: string | null; alt: string; size?: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const source = src?.trim();
  const className = clsx("pb-product-thumb", `is-${size}`, (!source || failed) && "is-placeholder");
  if (!source || failed) {
    return <span aria-label={`${alt}图片缺失`} className={className} role="img">图</span>;
  }
  return <img alt={alt} className={className} loading="lazy" onError={() => setFailed(true)} referrerPolicy="no-referrer" src={source} />;
}

function inPeriod<T extends { date: string }>(rows: T[], start: string, end: string) {
  return rows.filter((row) => row.date >= start && row.date <= end);
}

function aggregatePromotion(rows: PowerBiPromotionDaily[], key: "scene" | "productId") {
  const output = new Map<string, PowerBiPromotionDaily>();
  rows.forEach((row) => {
    const value = String(row[key] || "未分类");
    const current = output.get(value) ?? {
      date: "",
      [key]: value,
      impressions: 0,
      clicks: 0,
      spend: 0,
      revenue: 0,
      carts: 0,
      directCarts: 0,
      consultations: 0,
    };
    PROMOTION_SUM_FIELDS.forEach((field) => {
      current[field] += row[field] || 0;
    });
    output.set(value, current);
  });
  return [...output.values()].sort((left, right) => right.spend - left.spend);
}

function aggregateProductRows(rows: PowerBiProductDaily[]) {
  const output = new Map<string, PowerBiProductDaily>();
  rows.forEach((row) => {
    const current = output.get(row.productId) ?? {
      ...row,
      date: "",
      visitors: 0,
      addToCart: 0,
      payBuyers: 0,
      payAmount: 0,
      refund: 0,
      paidUnits: 0,
    };
    current.visitors += row.visitors;
    current.addToCart += row.addToCart;
    current.payBuyers += row.payBuyers;
    current.payAmount += row.payAmount;
    current.refund += row.refund;
    current.paidUnits += row.paidUnits;
    output.set(row.productId, current);
  });
  return [...output.values()].sort((left, right) => right.payAmount - left.payAmount);
}

type SortDir = "asc" | "desc";
type SortValue = string | number | null;

interface ColumnSort {
  sortKey: string;
  sortDir: SortDir;
  onSort: (key: string, dir: SortDir) => void;
}

function useColumnSort(defaultKey: string, defaultDir: SortDir = "desc"): ColumnSort {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);
  return {
    sortKey,
    sortDir,
    onSort: (key: string, dir: SortDir) => { setSortKey(key); setSortDir(dir); },
  };
}

function sortRows<T>(rows: T[], sortKey: string, sortDir: SortDir, accessors: Record<string, (row: T) => SortValue>): T[] {
  const accessor = accessors[sortKey];
  if (!accessor) return rows;
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    const aNull = av == null || (typeof av === "number" && Number.isNaN(av));
    const bNull = bv == null || (typeof bv === "number" && Number.isNaN(bv));
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });
}

function SortHeader({ label, columnKey, sort }: { label: string; columnKey: string; sort: ColumnSort }) {
  const active = sort.sortKey === columnKey;
  return (
    <th>
      <span className="th-sort-label">{label}</span>
      <span className="th-sort-arrows">
        <button aria-label={`${label}升序`} className={active && sort.sortDir === "asc" ? "is-active" : ""} onClick={() => sort.onSort(columnKey, "asc")} type="button">▲</button>
        <button aria-label={`${label}降序`} className={active && sort.sortDir === "desc" ? "is-active" : ""} onClick={() => sort.onSort(columnKey, "desc")} type="button">▼</button>
      </span>
    </th>
  );
}

const PAGE_SIZE = 15;

interface PaginationState<T> {
  page: number;
  totalPages: number;
  totalItems: number;
  pagedItems: T[];
  setPage: (page: number) => void;
}

function usePagination<T>(items: T[], resetKey: string): PaginationState<T> {
  const [page, setPage] = useState(1);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setPage(1);
  }
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  return { page: safePage, totalPages, totalItems: items.length, pagedItems, setPage };
}

function pageNumbers(page: number, totalPages: number): (number | "...")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages: (number | "...")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) pages.push("...");
  for (let current = start; current <= end; current += 1) pages.push(current);
  if (end < totalPages - 1) pages.push("...");
  pages.push(totalPages);
  return pages;
}

function Pagination({ page, totalPages, totalItems, onPage }: { page: number; totalPages: number; totalItems: number; onPage: (page: number) => void }) {
  if (totalPages <= 1) return null;
  const pages = pageNumbers(page, totalPages);
  return (
    <div className="pb-pagination" data-testid="pb-pagination">
      <span className="pb-pagination-info">共 {totalItems} 条 · 第 {page}/{totalPages} 页</span>
      <div className="pb-pagination-controls">
        <button className="pb-pagination-edge" disabled={page === 1} onClick={() => onPage(page - 1)} type="button">‹ 上一页</button>
        {pages.map((value, index) => value === "..." ? <span className="pb-pagination-ellipsis" key={`e${index}`}>…</span> : <button className={value === page ? "is-active" : ""} key={value} onClick={() => onPage(value)} type="button">{value}</button>)}
        <button className="pb-pagination-edge" disabled={page === totalPages} onClick={() => onPage(page + 1)} type="button">下一页 ›</button>
      </div>
    </div>
  );
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const change = previous ? (current - previous) / Math.abs(previous) : 0;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  return (
    <span className={clsx("pb-delta", `is-${direction}`)}>
      {change > 0 ? "↑" : change < 0 ? "↓" : "—"} {percent(Math.abs(change))}
    </span>
  );
}

function KpiTile({ label, value, current, previous, note, index = 0 }: { label: string; value: string; current: number; previous: number; note: string; index?: number }) {
  return (
    <div className="pb-kpi" style={{ "--pb-delay": `${120 + index * 55}ms` } as CSSProperties}>
      <div className="pb-kpi-label"><span>{label}</span><Delta current={current} previous={previous} /></div>
      <b>{value}</b>
      <small>{note}</small>
    </div>
  );
}

function PromotionTable({ rows, labelKey, variant = "default", showProductImages = false, labelHeader }: { rows: PowerBiPromotionDaily[]; labelKey: "scene" | "productId"; variant?: "default" | "product-detail"; showProductImages?: boolean; labelHeader?: string }) {
  const sort = useColumnSort("spend", "desc");
  const totalSpend = rows.reduce((sum, item) => sum + item.spend, 0);
  const accessors: Record<string, (row: PowerBiPromotionDaily) => SortValue> = {
    label: (row) => String(row.displayLabel || row[labelKey] || "未分类"),
    spend: (row) => row.spend,
    feeShare: (row) => rate(row.spend, totalSpend),
    feeRate: (row) => rate(row.spend, row.revenue),
    clicks: (row) => row.clicks,
    ctr: (row) => rate(row.clicks, row.impressions),
    cpc: (row) => rate(row.spend, row.clicks),
    carts: (row) => row.carts,
    cartRate: (row) => rate(row.carts, row.clicks),
    cartCost: (row) => rate(row.spend, row.carts),
    directCartRate: (row) => rate(row.directCarts, row.clicks),
    consultations: (row) => row.consultations,
  };
  const sortedRows = sortRows(rows, sort.sortKey, sort.sortDir, accessors);
  const pagination = usePagination(sortedRows, `${sort.sortKey}-${sort.sortDir}`);
  const maxFeeRate = Math.max(0.01, ...rows.map((row) => rate(row.spend, row.revenue)));
  const withImages = showProductImages && labelKey === "productId";
  return (
    <div className="pb-table-block">
      <div className="pb-table-wrap pb-animated-table">
        <table className={clsx("pb-data-table", variant === "product-detail" && "pb-promotion-product-table")}>
          <thead><tr>
            <SortHeader columnKey="label" label={labelHeader ?? (labelKey === "scene" ? "推广场景" : "商品")} sort={sort} />
            <SortHeader columnKey="spend" label="花费" sort={sort} />
            <SortHeader columnKey="feeShare" label="费用占比" sort={sort} />
            <SortHeader columnKey="feeRate" label="费比" sort={sort} />
            <SortHeader columnKey="clicks" label="点击" sort={sort} />
            <SortHeader columnKey="ctr" label="CTR" sort={sort} />
            <SortHeader columnKey="cpc" label="CPC" sort={sort} />
            <SortHeader columnKey="carts" label="加购" sort={sort} />
            <SortHeader columnKey="cartRate" label="加购率" sort={sort} />
            <SortHeader columnKey="cartCost" label="加购成本" sort={sort} />
            <SortHeader columnKey="directCartRate" label="直接加购率" sort={sort} />
            <SortHeader columnKey="consultations" label="咨询" sort={sort} />
          </tr></thead>
          <tbody>
            {pagination.pagedItems.map((row, index) => {
            const feeRate = rate(row.spend, row.revenue);
            const label = String(row.displayLabel || row[labelKey] || "未分类");
            return (
              <tr
                className={clsx("pb-table-row", variant === "product-detail" && "pb-promotion-product-row")}
                key={`${String(row[labelKey])}-${index}`}
                style={{ "--pb-row-delay": `${180 + Math.min(index, 12) * 34}ms` } as CSSProperties}
              >
                <td className={clsx("pb-row-label", withImages && "pb-product-label")}>
                  {withImages && <ProductThumb alt={label} size="md" src={row.imageUrl} />}
                  <span title={label}>{label}</span>
                </td>
                <td>{money(row.spend)}</td><td>{percent(rate(row.spend, totalSpend))}</td>
                <td><span className="pb-data-bar"><i style={{ width: `${Math.min(100, feeRate / maxFeeRate * 100)}%` }} /><b>{percent(feeRate)}</b></span></td>
                <td>{number(row.clicks)}</td><td>{percent(rate(row.clicks, row.impressions))}</td><td>{`¥${rate(row.spend, row.clicks).toFixed(2)}`}</td>
                <td>{number(row.carts)}</td><td>{percent(rate(row.carts, row.clicks))}</td><td>{`¥${rate(row.spend, row.carts).toFixed(2)}`}</td>
                <td>{percent(rate(row.directCarts, row.clicks))}</td><td>{number(row.consultations)}</td>
              </tr>
            );
          })}
          </tbody>
        </table>
      </div>
      <Pagination onPage={pagination.setPage} page={pagination.page} totalItems={pagination.totalItems} totalPages={pagination.totalPages} />
    </div>
  );
}

type PromotionDailyRow = PowerBiPromotionDaily & { year: string; month: string; day: string };

function aggregatePromotionDaily(rows: PromotionDailyRow[], level: "year" | "month", _key: string): PromotionDailyRow {
  const first = rows[0];
  const totals = rows.reduce((acc, row) => {
    PROMOTION_SUM_FIELDS.forEach((field) => {
      acc[field] += row[field] || 0;
    });
    return acc;
  }, { impressions: 0, clicks: 0, spend: 0, revenue: 0, carts: 0, directCarts: 0, consultations: 0 });
  return {
    date: first?.date ?? "",
    year: first?.year ?? "",
    month: level === "month" ? first?.month ?? "" : "",
    day: "",
    ...totals,
  };
}

function PromotionDailySpendTable({ rows, start, end }: { rows: PowerBiPromotionDaily[]; start: string; end: string }) {
  const dailyRows = useMemo<PromotionDailyRow[]>(() => {
    const output = new Map<string, PromotionDailyRow>();
    rows.forEach((row) => {
      const current = output.get(row.date) ?? {
        date: row.date,
        year: row.date.slice(0, 4),
        month: `${row.date.slice(5, 7)}月`,
        day: row.date.slice(8, 10),
        impressions: 0,
        clicks: 0,
        spend: 0,
        revenue: 0,
        carts: 0,
        directCarts: 0,
        consultations: 0,
      };
      PROMOTION_SUM_FIELDS.forEach((field) => {
        current[field] += row[field] || 0;
      });
      output.set(row.date, current);
    });
    return [...output.values()].sort((left, right) => right.date.localeCompare(left.date));
  }, [rows]);
  const sort = useColumnSort("date", "asc");

  if (!dailyRows.length) {
    return <div className="pb-empty">当前期间无推广花费数据</div>;
  }

  const maxSpend = Math.max(1, ...dailyRows.map((row) => row.spend));
  const totalSpend = dailyRows.reduce((sum, row) => sum + row.spend, 0);
  const maxFeeRate = Math.max(0.01, ...dailyRows.map((row) => rate(row.spend, row.revenue)));
  const totals = dailyRows.reduce((acc, row) => ({
    impressions: acc.impressions + row.impressions,
    clicks: acc.clicks + row.clicks,
    spend: acc.spend + row.spend,
    revenue: acc.revenue + row.revenue,
    carts: acc.carts + row.carts,
    consultations: acc.consultations + row.consultations,
  }), { impressions: 0, clicks: 0, spend: 0, revenue: 0, carts: 0, consultations: 0 });
  const accessors: Record<string, (row: PromotionDailyRow) => SortValue> = {
    date: (row) => row.date,
    year: (row) => row.year,
    month: (row) => row.month,
    day: (row) => row.day,
    spend: (row) => row.spend,
    feeShare: (row) => rate(row.spend, totalSpend),
    feeRate: (row) => rate(row.spend, row.revenue),
    clicks: (row) => row.clicks,
    ctr: (row) => rate(row.clicks, row.impressions),
    cpc: (row) => rate(row.spend, row.clicks),
    carts: (row) => row.carts,
    cartRate: (row) => rate(row.carts, row.clicks),
    cartCost: (row) => rate(row.spend, row.carts),
    consultations: (row) => row.consultations,
    revenue: (row) => row.revenue,
  };
  const sortedDaily = sortRows(dailyRows, sort.sortKey, sort.sortDir, accessors);
  const hierarchyScopeKey = [...new Set(dailyRows.map((row) => `${row.year}|${row.month}`))].sort().join(",");
  const [expandedYears, setExpandedYears] = useState<Set<string>>(() => pbixDefaultDailyCoreExpansion(dailyRows).years);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => pbixDefaultDailyCoreExpansion(dailyRows).months);
  useEffect(() => {
    const scope = hierarchyScopeKey ? hierarchyScopeKey.split(",").map((key) => {
      const [year, month] = key.split("|");
      return { year, month };
    }) : [];
    const defaultExpansion = pbixDefaultDailyCoreExpansion(scope);
    setExpandedYears(defaultExpansion.years);
    setExpandedMonths(defaultExpansion.months);
  }, [hierarchyScopeKey]);
  const hierarchyRows = buildDailyHierarchy(sortedDaily, expandedYears, expandedMonths, aggregatePromotionDaily);
  const hierarchyStateKey = `${[...expandedYears].sort().join(",")}|${[...expandedMonths].sort().join(",")}`;
  const pagination = usePagination(hierarchyRows, `${sort.sortKey}-${sort.sortDir}-${hierarchyStateKey}`);

  return (
    <section className="pb-daily-spend-table" data-testid="promotion-daily-spend-table">
      <div className="pb-panel-title">每日推广费用 <small>花费（未含达人）· {start} 至 {end} · 共 {dailyRows.length} 天 · 年度 → 月份 → 日可展开折叠</small></div>
      <div className="pb-table-wrap pb-animated-table">
        <table className="pb-data-table pb-daily-spend-table-table">
          <thead><tr>
            <SortHeader columnKey="year" label="年度" sort={sort} />
            <SortHeader columnKey="month" label="月份" sort={sort} />
            <SortHeader columnKey="day" label="日" sort={sort} />
            <SortHeader columnKey="spend" label="花费" sort={sort} />
            <SortHeader columnKey="feeShare" label="花费占比" sort={sort} />
            <SortHeader columnKey="feeRate" label="费比" sort={sort} />
            <SortHeader columnKey="clicks" label="点击" sort={sort} />
            <SortHeader columnKey="ctr" label="CTR" sort={sort} />
            <SortHeader columnKey="cpc" label="CPC" sort={sort} />
            <SortHeader columnKey="carts" label="加购" sort={sort} />
            <SortHeader columnKey="cartRate" label="加购率" sort={sort} />
            <SortHeader columnKey="cartCost" label="加购成本" sort={sort} />
            <SortHeader columnKey="consultations" label="咨询" sort={sort} />
            <SortHeader columnKey="revenue" label="成交金额" sort={sort} />
          </tr></thead>
          <tbody>
            {pagination.pagedItems.map((row, index) => {
              const feeRate = rate(row.spend, row.revenue);
              return (
                <tr className={clsx("pb-table-row", row.hierarchyLevel !== "day" && "is-hierarchy-summary")} data-hierarchy-key={row.hierarchyKey} data-hierarchy-level={row.hierarchyLevel} key={`${row.hierarchyLevel}-${row.hierarchyKey}`} style={{ "--pb-row-delay": `${180 + Math.min(index, 12) * 28}ms` } as CSSProperties}>
                  <td className="pb-hierarchy-cell">{row.showYear ? <button aria-expanded={expandedYears.has(row.year)} aria-label={`${expandedYears.has(row.year) ? "折叠" : "展开"}年度 ${row.year}`} className="pb-hierarchy-toggle" data-testid="promotion-daily-year-toggle" onClick={() => toggleExpanded(setExpandedYears, row.year)} type="button"><span aria-hidden="true" className="pb-hierarchy-icon">{expandedYears.has(row.year) ? "−" : "+"}</span><span>{row.year}</span></button> : null}</td>
                  <td className="pb-hierarchy-cell">{row.showMonth ? <button aria-expanded={expandedMonths.has(`${row.year}|${row.month}`)} aria-label={`${expandedMonths.has(`${row.year}|${row.month}`) ? "折叠" : "展开"}月份 ${row.month}`} className="pb-hierarchy-toggle" data-testid="promotion-daily-month-toggle" onClick={() => toggleExpanded(setExpandedMonths, `${row.year}|${row.month}`)} type="button"><span aria-hidden="true" className="pb-hierarchy-icon">{expandedMonths.has(`${row.year}|${row.month}`) ? "−" : "+"}</span><span>{row.month}</span></button> : null}</td>
                  <td>{row.hierarchyLevel === "day" ? row.day : ""}</td>
                  <td><span className="pb-data-bar"><i style={{ width: `${Math.min(100, row.spend / maxSpend * 100)}%`, background: "rgba(73, 191, 227, 0.42)" }} /><b>{money(row.spend)}</b></span></td>
                  <td>{percent(rate(row.spend, totalSpend))}</td>
                  <td><span className="pb-data-bar"><i style={{ width: `${Math.min(100, feeRate / maxFeeRate * 100)}%` }} /><b>{percent(feeRate)}</b></span></td>
                  <td>{number(row.clicks)}</td>
                  <td>{percent(rate(row.clicks, row.impressions))}</td>
                  <td>{`¥${rate(row.spend, row.clicks).toFixed(2)}`}</td>
                  <td>{number(row.carts)}</td>
                  <td>{percent(rate(row.carts, row.clicks))}</td>
                  <td>{`¥${rate(row.spend, row.carts).toFixed(2)}`}</td>
                  <td>{number(row.consultations)}</td>
                  <td>{money(row.revenue)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="font-bold"><td colSpan={3}>期间合计</td><td>{money(totals.spend)}</td><td>100.00%</td><td>{percent(rate(totals.spend, totals.revenue))}</td><td>{number(totals.clicks)}</td><td>{percent(rate(totals.clicks, totals.impressions))}</td><td>{`¥${rate(totals.spend, totals.clicks).toFixed(2)}`}</td><td>{number(totals.carts)}</td><td>{percent(rate(totals.carts, totals.clicks))}</td><td>{`¥${rate(totals.spend, totals.carts).toFixed(2)}`}</td><td>{number(totals.consultations)}</td><td>{money(totals.revenue)}</td></tr></tfoot>
        </table>
      </div>
      <Pagination onPage={pagination.setPage} page={pagination.page} totalItems={pagination.totalItems} totalPages={pagination.totalPages} />
    </section>
  );
}

function OverallPage({ pages, start, end }: { pages: PowerBiPages; start: string; end: string }) {
  const overallDaily = inPeriod(pages.overallDaily, start, end);
  const dailyCore = inPeriod(pages.dailyCore ?? [], start, end);
  const products = aggregateProductRows(inPeriod(pages.productDaily, start, end));
  const productsById = new Map(pages.products.map((item) => [item.productId, item]));
  const promotionProducts = aggregatePromotion(inPeriod(pages.promotionProductDaily, start, end), "productId");
  const spendByProduct = new Map(promotionProducts.map((item) => [item.productId, item.spend]));
  const priorYearMap = new Map(pages.productDailyPriorYear.map((item) => [item.productId, item]));
  const totalSubsidized = products.reduce((sum, row) => sum + (row.payAmount - row.refund) * 0.85, 0);
  const promotionSpendByDate = new Map<string, number>();
  inPeriod(pages.promotionSceneDaily, start, end).forEach((row) => {
    promotionSpendByDate.set(row.date, (promotionSpendByDate.get(row.date) || 0) + (row.spend || 0));
  });

  const prev = previousPeriod(start, end);
  const previousDaily = inPeriod(pages.overallDaily, prev.start, prev.end);
  const previousPromotionSpendByDate = new Map<string, number>();
  inPeriod(pages.promotionSceneDaily, prev.start, prev.end).forEach((row) => {
    previousPromotionSpendByDate.set(row.date, (previousPromotionSpendByDate.get(row.date) || 0) + (row.spend || 0));
  });

  const period = aggregateOverallDaily(overallDaily);
  const previousPeriodData = previousDaily.length ? aggregateOverallDaily(previousDaily) : null;
  const totalSpend = [...promotionSpendByDate.values()].reduce((sum, spend) => sum + spend, 0);
  const previousTotalSpend = [...previousPromotionSpendByDate.values()].reduce((sum, spend) => sum + spend, 0);
  const periodSubsidizedAmount = subsidizedAmount(period);
  const previousSubsidizedAmount = previousPeriodData ? subsidizedAmount(previousPeriodData) : 0;
  const periodStorePromotionSpend = totalSpend + (period.taokeSpend || 0);
  const previousStorePromotionSpend = previousTotalSpend + (previousPeriodData?.taokeSpend || 0);
  const storePromotionRatio = rate(periodStorePromotionSpend, periodSubsidizedAmount);
  const previousStorePromotionRatio = previousPeriodData ? rate(previousStorePromotionSpend, previousSubsidizedAmount) : 0;

  const dailySort = useColumnSort("date", "asc");
  const productSort = useColumnSort("payAmount", "desc");
  const dailyAccessors: Record<string, (row: PowerBiDailyCore) => SortValue> = {
    date: (row) => row.date,
    year: (row) => row.year,
    month: (row) => row.month,
    day: (row) => row.day,
    productVisitors: (row) => row.productVisitors,
    addToCart: (row) => row.addToCart,
    addToCartRate: (row) => row.addToCartRate,
    addToCartCost: (row) => row.addToCartCost,
    payAmount: (row) => row.payAmount,
    paidUnits: (row) => row.paidUnits,
    conversionRate: (row) => row.conversionRate,
    refundAmount: (row) => row.refundAmount,
    refundRate: (row) => row.refundRate,
    spend: (row) => row.spend,
    subsidizedAmount: (row) => row.subsidizedAmount,
    subsidizedFeeRate: (row) => row.subsidizedFeeRate,
    storeRank: (row) => row.storeRank,
  };
  const sortedDaily = sortRows(dailyCore, dailySort.sortKey, dailySort.sortDir, dailyAccessors);
  const hierarchyScopeKey = [...new Set(dailyCore.map((row) => `${row.year}|${row.month}`))].sort().join(",");
  const [expandedYears, setExpandedYears] = useState<Set<string>>(() => pbixDefaultDailyCoreExpansion(dailyCore).years);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => pbixDefaultDailyCoreExpansion(dailyCore).months);
  useEffect(() => {
    const scope = hierarchyScopeKey ? hierarchyScopeKey.split(",").map((key) => {
      const [year, month] = key.split("|");
      return { year, month };
    }) : [];
    const defaultExpansion = pbixDefaultDailyCoreExpansion(scope);
    setExpandedYears(defaultExpansion.years);
    setExpandedMonths(defaultExpansion.months);
  }, [hierarchyScopeKey]);
  const dailyHierarchyRows = buildDailyCoreHierarchy(sortedDaily, expandedYears, expandedMonths);
  const hierarchyStateKey = `${[...expandedYears].sort().join(",")}|${[...expandedMonths].sort().join(",")}`;
  const dailyPagination = usePagination(dailyHierarchyRows, `${dailySort.sortKey}-${dailySort.sortDir}-${hierarchyStateKey}`);
  const productAccessors: Record<string, (row: PowerBiProductDaily) => SortValue> = {
    product: (row) => productsById.get(row.productId)?.merchantCode || row.productId || "未匹配商品",
    visitors: (row) => row.visitors,
    payBuyers: (row) => row.payBuyers,
    convRate: (row) => rate(row.payBuyers, row.visitors),
    payAmount: (row) => row.payAmount,
    subsidized: (row) => (row.payAmount - row.refund) * 0.85,
    amountShare: (row) => totalSubsidized ? ((row.payAmount - row.refund) * 0.85) / totalSubsidized : 0,
    yoy: (row) => { const prior = priorYearMap.get(row.productId); const ps = prior ? (prior.payAmount - prior.refund) * 0.85 : 0; return ps > 0 ? ((row.payAmount - row.refund) * 0.85) / ps : null; },
    paidUnits: (row) => row.paidUnits,
    refund: (row) => row.refund,
    refundShare: (row) => rate(row.refund, row.payAmount),
    addToCart: (row) => row.addToCart,
    cartRate: (row) => rate(row.addToCart, row.visitors),
    spend: (row) => spendByProduct.get(row.productId) || 0,
    subsidizedFeeRate: (row) => rate(spendByProduct.get(row.productId) || 0, (row.payAmount - row.refund) * 0.85),
    unitPrice: (row) => rate(row.payAmount, row.paidUnits),
  };
  const sortedProducts = sortRows(products, productSort.sortKey, productSort.sortDir, productAccessors);
  const productPagination = usePagination(sortedProducts, `${productSort.sortKey}-${productSort.sortDir}`);

  return (
    <div className="pb-overall-layout" data-search-anchor="analytics-tmall-overall">
      <div className="pb-overall-main">
        <section className="pb-panel-title">店铺基础数据 <small>期间 {start} 至 {end}</small></section>
        <div className="pb-kpi-grid">
          <KpiTile current={periodSubsidizedAmount} index={0} label="国补后金额(店铺)" note="(支付金额 - 成功退款金额) × 85%" previous={previousSubsidizedAmount} value={moneyPrecise(periodSubsidizedAmount)} />
          <KpiTile current={period.visitors} index={1} label="访客数" note="到店访客" previous={previousPeriodData?.visitors ?? 0} value={number(period.visitors)} />
          <KpiTile current={rate(period.payBuyers, period.visitors)} index={2} label="访客支付转化率" note="支付买家 / 访客" previous={rate(previousPeriodData?.payBuyers ?? 0, previousPeriodData?.visitors ?? 0)} value={percent(rate(period.payBuyers, period.visitors))} />
          <KpiTile current={period.addToCart} index={3} label="加购人数" note="产生加购的访客" previous={previousPeriodData?.addToCart ?? 0} value={number(period.addToCart)} />
          <KpiTile current={rate(period.addToCart, period.visitors)} index={4} label="加购率" note="加购人数 / 访客" previous={rate(previousPeriodData?.addToCart ?? 0, previousPeriodData?.visitors ?? 0)} value={percent(rate(period.addToCart, period.visitors))} />
          <KpiTile current={totalSpend} index={5} label="站内推广花费" note="站内推广花费（不含达人）" previous={previousTotalSpend} value={moneyPrecise(totalSpend)} />
        </div>
        <section className="pb-panel-title is-fee">推广费比数据 <small>按国补后金额计算</small></section>
        <div className="pb-fee-grid">
          <KpiTile current={storePromotionRatio} index={6} label="店铺推广费比" note="站内推广费用 / 国补后金额" previous={previousStorePromotionRatio} value={percent(storePromotionRatio)} />
          {([['全站推广费比', period.fullSiteSpend, previousPeriodData?.fullSiteSpend ?? 0], ['关键词推广费比', period.keywordSpend, previousPeriodData?.keywordSpend ?? 0], ['精准人群费比', period.audienceSpend, previousPeriodData?.audienceSpend ?? 0]] as const).map(([label, value, prior], index) => (
            <KpiTile current={rate(value, periodSubsidizedAmount)} index={index + 7} key={label} label={label} note="较上一周期" previous={rate(prior, previousSubsidizedAmount)} value={percent(rate(value, periodSubsidizedAmount))} />
          ))}
        </div>
      </div>
      <section className="pb-daily-matrix">
        <div className="pb-panel-title">每天核心数据 <small>年度 → 月份 → 日可展开折叠 · 默认按日升序</small></div>
        <div className="pb-table-wrap pb-animated-table"><table className="pb-data-table pb-daily-core-table" data-testid="powerbi-daily-core-table"><thead><tr><SortHeader columnKey="year" label="年度" sort={dailySort} /><SortHeader columnKey="month" label="月份" sort={dailySort} /><SortHeader columnKey="day" label="日" sort={dailySort} /><SortHeader columnKey="productVisitors" label="商品访客数" sort={dailySort} /><SortHeader columnKey="addToCart" label="加购人数" sort={dailySort} /><SortHeader columnKey="addToCartRate" label="加购率" sort={dailySort} /><SortHeader columnKey="addToCartCost" label="加购成本" sort={dailySort} /><SortHeader columnKey="payAmount" label="支付金额" sort={dailySort} /><SortHeader columnKey="paidUnits" label="支付件数" sort={dailySort} /><SortHeader columnKey="conversionRate" label="访客转化率" sort={dailySort} /><SortHeader columnKey="refundAmount" label="退款金额" sort={dailySort} /><SortHeader columnKey="refundRate" label="退款率" sort={dailySort} /><SortHeader columnKey="spend" label="费额" sort={dailySort} /><SortHeader columnKey="subsidizedAmount" label="国补后金额(万)" sort={dailySort} /><SortHeader columnKey="subsidizedFeeRate" label="国补后费比" sort={dailySort} /><SortHeader columnKey="storeRank" label="店铺排名" sort={dailySort} /></tr></thead><tbody>{dailyPagination.pagedItems.map((row: DailyCoreHierarchyRow, index) => <tr className={clsx("pb-table-row", row.hierarchyLevel !== "day" && "is-hierarchy-summary")} data-hierarchy-key={row.hierarchyKey} data-hierarchy-level={row.hierarchyLevel} key={`${row.hierarchyLevel}-${row.hierarchyKey}`} style={{ "--pb-row-delay": `${260 + Math.min(index, 12) * 28}ms` } as CSSProperties}><td className="pb-hierarchy-cell">{row.showYear ? <button aria-expanded={expandedYears.has(row.year)} aria-label={`${expandedYears.has(row.year) ? "折叠" : "展开"}年度 ${row.year}`} className="pb-hierarchy-toggle" data-testid="daily-core-year-toggle" onClick={() => toggleExpanded(setExpandedYears, row.year)} type="button"><span aria-hidden="true" className="pb-hierarchy-icon">{expandedYears.has(row.year) ? "−" : "+"}</span><span>{row.year}</span></button> : null}</td><td className="pb-hierarchy-cell">{row.showMonth ? <button aria-expanded={expandedMonths.has(`${row.year}|${row.month}`)} aria-label={`${expandedMonths.has(`${row.year}|${row.month}`) ? "折叠" : "展开"}月份 ${row.month}`} className="pb-hierarchy-toggle" data-testid="daily-core-month-toggle" onClick={() => toggleExpanded(setExpandedMonths, `${row.year}|${row.month}`)} type="button"><span aria-hidden="true" className="pb-hierarchy-icon">{expandedMonths.has(`${row.year}|${row.month}`) ? "−" : "+"}</span><span>{row.month}</span></button> : null}</td><td>{row.hierarchyLevel === "day" ? row.day : ""}</td><td>{pbixInteger(row.productVisitors)}</td><td>{pbixInteger(row.addToCart)}</td><td>{pbixPercent(row.addToCartRate)}</td><td>{pbixDecimal(row.addToCartCost)}</td><td>{pbixWan(row.payAmount)}</td><td>{pbixInteger(row.paidUnits)}</td><td>{pbixPercent(row.conversionRate)}</td><td>{countFormat.format(row.refundAmount || 0)}</td><td>{pbixPercent(row.refundRate)}</td><td>{pbixWan(row.spend)}</td><td>{pbixWan(row.subsidizedAmount)}</td><td>{pbixPercent(row.subsidizedFeeRate)}</td><td>{row.storeRank || "—"}</td></tr>)}</tbody></table></div>
        <Pagination onPage={dailyPagination.setPage} page={dailyPagination.page} totalItems={dailyPagination.totalItems} totalPages={dailyPagination.totalPages} />
      </section>
      <section className="pb-product-table">
        <div className="pb-panel-title">商品经营明细 <small>默认按支付金额</small></div>
        <div className="pb-table-wrap pb-animated-table"><table className="pb-data-table pb-business-product-table"><thead><tr><SortHeader columnKey="product" label="商品" sort={productSort} /><SortHeader columnKey="visitors" label="访客" sort={productSort} /><SortHeader columnKey="payBuyers" label="支付买家" sort={productSort} /><SortHeader columnKey="convRate" label="转化率" sort={productSort} /><SortHeader columnKey="payAmount" label="支付金额" sort={productSort} /><SortHeader columnKey="subsidized" label="国补后金额(万)" sort={productSort} /><SortHeader columnKey="amountShare" label="销额占比" sort={productSort} /><SortHeader columnKey="yoy" label="国补后金额同比" sort={productSort} /><SortHeader columnKey="paidUnits" label="支付件数" sort={productSort} /><SortHeader columnKey="refund" label="退款额" sort={productSort} /><SortHeader columnKey="refundShare" label="退款占比" sort={productSort} /><SortHeader columnKey="addToCart" label="加购" sort={productSort} /><SortHeader columnKey="cartRate" label="加购率" sort={productSort} /><SortHeader columnKey="spend" label="推广花费" sort={productSort} /><SortHeader columnKey="subsidizedFeeRate" label="国补后费比" sort={productSort} /><SortHeader columnKey="unitPrice" label="件单价" sort={productSort} /></tr></thead><tbody>{productPagination.pagedItems.map((row, index) => { const spend = spendByProduct.get(row.productId) || 0; const product = productsById.get(row.productId); const shortName = product?.merchantCode || row.productId || "未匹配商品"; const subsidized = (row.payAmount - row.refund) * 0.85; const amountShare = totalSubsidized ? subsidized / totalSubsidized : 0; const prior = priorYearMap.get(row.productId); const priorSubsidized = prior ? (prior.payAmount - prior.refund) * 0.85 : 0; const hasPrior = Boolean(prior) && priorSubsidized > 0; return <tr className="pb-table-row pb-business-product-row" key={row.productId} style={{ "--pb-row-delay": `${300 + Math.min(index, 12) * 32}ms` } as CSSProperties}><td className="pb-row-label pb-product-label" title={row.productName}><ProductThumb alt={row.productName || shortName} size="md" src={product?.imageUrl} /><span>{shortName}</span></td><td>{number(row.visitors)}</td><td>{number(row.payBuyers)}</td><td>{percent(rate(row.payBuyers, row.visitors))}</td><td>{money(row.payAmount)}</td><td>{moneyPrecise(subsidized)}</td><td>{percent(amountShare)}</td><td>{hasPrior ? <Delta current={subsidized} previous={priorSubsidized} /> : <span className="pb-na">数据不足</span>}</td><td>{number(row.paidUnits)}</td><td>{money(row.refund)}</td><td>{percent(rate(row.refund, row.payAmount))}</td><td>{number(row.addToCart)}</td><td>{percent(rate(row.addToCart, row.visitors))}</td><td>{money(spend)}</td><td>{percent(rate(spend, subsidized))}</td><td>{`¥${rate(row.payAmount, row.paidUnits).toFixed(0)}`}</td></tr>; })}</tbody></table></div>
        <Pagination onPage={productPagination.setPage} page={productPagination.page} totalItems={productPagination.totalItems} totalPages={productPagination.totalPages} />
      </section>
    </div>
  );
}

function PromotionPage({ pages, start, end }: { pages: PowerBiPages; start: string; end: string }) {
  const sceneDaily = inPeriod(pages.promotionSceneDaily, start, end);
  const sceneRows = aggregatePromotion(sceneDaily, "scene");
  const productRows = aggregatePromotion(inPeriod(pages.promotionProductDaily, start, end), "productId");
  const products = new Map(pages.products.map((item) => [item.productId, item]));
  const labelledProducts = productRows.map((row) => {
    const product = products.get(row.productId || "");
    return { ...row, displayLabel: product?.merchantCode || row.productId, imageUrl: product?.imageUrl || null };
  });
  return <div className="pb-detail-layout" data-search-anchor="analytics-tmall-promotion"><main><PromotionDailySpendTable end={end} rows={sceneDaily} start={start} /><section className="pb-panel-title">推广计划数据 <small>按场景聚合</small></section><PromotionTable labelKey="scene" rows={sceneRows} /><section className="pb-panel-title is-spaced">商品推广明细 <small>Top 60，按花费排序 · 图片链接</small></section><PromotionTable labelKey="productId" rows={labelledProducts} showProductImages variant="product-detail" /></main></div>;
}

function ProductPromotionPage({ pages, start, end }: { pages: PowerBiPages; start: string; end: string }) {
  const availableRows = useMemo(() => inPeriod(pages.promotionProductDaily, start, end), [pages.promotionProductDaily, start, end]);
  const ranked = useMemo(() => aggregatePromotion(availableRows, "productId"), [availableRows]);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(ranked[0]?.productId || "");
  const products = new Map(pages.products.map((item) => [item.productId, item]));
  useEffect(() => { if (!ranked.some((item) => item.productId === selectedProduct)) setSelectedProduct(ranked[0]?.productId || ""); }, [ranked, selectedProduct]);
  const selectedRows = availableRows.filter((row) => row.productId === selectedProduct);
  const sceneRows = aggregatePromotion(selectedRows, "scene");
  const dailyRows = aggregatePromotion(
    selectedRows.map((row) => ({ ...row, productId: row.date })),
    "productId",
  ).sort((left, right) => String(right.productId).localeCompare(String(left.productId)));
  const filteredProducts = ranked.filter((row) => { const product = products.get(row.productId || ""); return `${product?.merchantCode || ""}${product?.productName || ""}${row.productId}`.toLowerCase().includes(search.toLowerCase()); });
  return (
    <div className="pb-product-promotion-layout" data-search-anchor="analytics-tmall-product">
      <aside className="pb-product-selector"><label><Search size={13} /><input onChange={(event) => setSearch(event.target.value)} placeholder="搜索商品编码" value={search} /></label><div>{filteredProducts.map((row, index) => { const product = products.get(row.productId || ""); const label = product?.merchantCode || row.productId || "未匹配商品"; return <button className={selectedProduct === row.productId ? "is-active" : ""} key={row.productId} onClick={() => setSelectedProduct(row.productId || "")} style={{ "--pb-row-delay": `${140 + Math.min(index, 12) * 30}ms` } as CSSProperties} type="button"><ProductThumb alt={product?.productName || label} src={product?.imageUrl} /><span>{label}</span><b>{money(row.spend)}</b><small>{product?.productName || "未匹配商品名称"}</small></button>; })}</div></aside>
      <main><section className="pb-panel-title">商品推广场景 <small>{products.get(selectedProduct)?.merchantCode || selectedProduct || "请选择商品"}</small></section><PromotionTable labelKey="scene" rows={sceneRows} /><section className="pb-panel-title is-spaced">商品每日推广数据 <small>{start} 至 {end}</small></section><PromotionTable labelKey="productId" labelHeader="日期" rows={dailyRows.map((row) => ({ ...row, productId: shortDate(row.productId || "") }))} /></main>
    </div>
  );
}

function GrowthDiagnosis({ warehouse, globalPeriod, searchTarget }: { warehouse: WarehouseSnapshot; globalPeriod?: DatePeriod | null; searchTarget?: SearchTarget | null }) {
  const pages = warehouse.powerbiPages;
  const [page, setPage] = useState<ReplicaPage>("overall");
  // 搜索目标同步天猫明细子页，不改变用户正常点击行为
  const targetReplicaPage = searchTarget?.page === "analytics" ? searchTarget.replicaPage : undefined;
  useEffect(() => {
    if (targetReplicaPage) setPage(targetReplicaPage);
  }, [targetReplicaPage, searchTarget?.requestId]);
  const defaultPeriod = useMemo(() => {
    if (!pages.period) return null;
    const monthStart = `${pages.period.end.slice(0, 8)}01`;
    return { start: pages.period.start > monthStart ? pages.period.start : monthStart, end: pages.period.end };
  }, [pages.period]);
  const period = useMemo(() => {
    if (!pages.period) return null;
    const requested = globalPeriod ?? defaultPeriod;
    if (!requested) return null;
    const start = requested.start > pages.period.start ? requested.start : pages.period.start;
    const end = requested.end < pages.period.end ? requested.end : pages.period.end;
    return start <= end ? { start, end } : null;
  }, [defaultPeriod, globalPeriod, pages.period]);
  if (!pages.period) return <div className="pb-empty">本地 PowerBI 独有数据尚未生成，请先同步本地数仓。</div>;
  if (!period) return <div className="pb-empty">当前页面日期范围与 PowerBI 本地数据范围没有交集，请调整日期筛选。</div>;
  return (
    <div className={clsx("pb-replica-canvas", "pb-tmall-detail-scale", `is-page-${page}`)}>
      <div className="pb-replica-toolbar">
        <nav>{([{ id: "overall", label: "旗舰店整体", icon: BarChart3 }, { id: "promotion", label: "推广费用明细", icon: Table2 }, { id: "product", label: "商品推广费用", icon: Database }] as const).map((item) => <button className={page === item.id ? "is-active" : ""} key={item.id} onClick={() => setPage(item.id)} type="button"><item.icon size={14} />{item.label}</button>)}</nav>
        <span className="pb-follow-global-date">跟随页面日期：{period.start} 至 {period.end}</span>
      </div>
      {page === "overall" ? <OverallPage end={period.end} pages={pages} start={period.start} /> : page === "promotion" ? <PromotionPage end={period.end} pages={pages} start={period.start} /> : <ProductPromotionPage end={period.end} pages={pages} start={period.start} />}
    </div>
  );
}

export function PowerBiReplica({ overview, warehouse, period, searchTarget }: PowerBiReplicaProps) {
  const [workspace, setWorkspace] = useState<Workspace>("overview");
  // 搜索目标同步工作区（全渠道总览 / 天猫明细），不改变用户正常点击行为
  const targetWorkspace = searchTarget?.page === "analytics" ? searchTarget.workspace : undefined;
  useEffect(() => {
    if (targetWorkspace) setWorkspace(targetWorkspace);
  }, [targetWorkspace, searchTarget?.requestId]);
  return (
    <section className="powerbi-replica-section" data-testid="powerbi-replica">
      <div className="analytics-workspace-tabs" role="tablist" aria-label="运营数据视图">
        <button aria-selected={workspace === "overview"} className={workspace === "overview" ? "is-active" : ""} onClick={() => setWorkspace("overview")} role="tab" type="button">全渠道总览</button>
        <button aria-selected={workspace === "diagnosis"} className={workspace === "diagnosis" ? "is-active" : ""} onClick={() => setWorkspace("diagnosis")} role="tab" type="button">天猫明细</button>
      </div>
      {workspace === "overview" ? overview : warehouse?.powerbiPages ? <GrowthDiagnosis globalPeriod={period} searchTarget={searchTarget} warehouse={warehouse} /> : <div className="pb-empty">正在等待 PowerBI 本地数仓快照…</div>}
    </section>
  );
}
