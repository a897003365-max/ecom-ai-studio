import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { BarChart3, Database, Headphones, Search, Table2, TrendingUp } from "lucide-react";
import logoWeixin from "../assets/logo_weixin.png";
import type {
  PowerBiCompetitorDaily,
  PowerBiCustomerService,
  PowerBiCustomerServiceAgent,
  PowerBiCustomerServiceDaily,
  PowerBiDailyCore,
  PowerBiOverallDaily,
  PowerBiPages,
  PowerBiProductDaily,
  PowerBiPromotionDaily,
  PowerBiShopSummaryDaily,
  WarehouseSnapshot,
} from "../types/integration";
import type { SearchTarget } from "../types/search";
import { getPowerbiPagesOnDemand } from "../services/localApi";
import { clsx } from "../utils/format";
import { buildDailyCoreHierarchy, buildDailyHierarchy, pbixDefaultDailyCoreExpansion, type DailyCoreHierarchyRow } from "./powerBiDailyCoreHierarchy";

/** 同步时间显示（与 src/pages/AnalyticsPage.tsx:79-84 同款）。
 *  value 为空时返回「尚未同步」，避免 UI 出现 Invalid Date 或空白。 */
function dateTime(value?: string | null) {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value)).replaceAll("/", "-");
}

function toggleExpanded(setter: Dispatch<SetStateAction<Set<string>>>, key: string) {
  setter((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

type Workspace = "overview" | "diagnosis";
type ReplicaPage = "overall" | "promotion" | "product" | "competitor";
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

function countOrDash(value: number | null) {
  return value == null ? "—" : number(value);
}

function wanOrDash(value: number | null) {
  return value == null ? "—" : pbixWan(value);
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

function usePagination<T>(items: T[], resetKey: string, pageSize: number = PAGE_SIZE): PaginationState<T> {
  const [page, setPage] = useState(1);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setPage(1);
  }
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedItems = items.slice((safePage - 1) * pageSize, safePage * pageSize);
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

function Delta({ current, previous }: { current: number; previous: number | null }) {
  // previous 为 null 表示无上期数据（范围起点=数据起点），不能当作「与上期持平」展示
  if (previous == null) return <span className="pb-delta is-na">—</span>;
  const change = previous ? (current - previous) / Math.abs(previous) : 0;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  return (
    <span className={clsx("pb-delta", `is-${direction}`)}>
      {change > 0 ? "↑" : change < 0 ? "↓" : "—"} {percent(Math.abs(change))}
    </span>
  );
}

function KpiTile({ label, value, current, previous, note, index = 0 }: { label: string; value: string; current: number; previous: number | null; note: string; index?: number }) {
  return (
    <div className="pb-kpi" style={{ "--pb-delay": `${120 + index * 55}ms` } as CSSProperties}>
      <div className="pb-kpi-label"><span>{label}</span><Delta current={current} previous={previous} /></div>
      <b>{value}</b>
      <small>{note}</small>
    </div>
  );
}

function PromotionTable({ rows, labelKey, variant = "default", showProductImages = false, labelHeader, selectedDate, onSelectDate }: { rows: PowerBiPromotionDaily[]; labelKey: "scene" | "productId"; variant?: "default" | "product-detail"; showProductImages?: boolean; labelHeader?: string; selectedDate?: string | null; onSelectDate?: (date: string | null) => void }) {
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
            const rowDate = onSelectDate ? row.date : "";
            return (
              <tr
                className={clsx("pb-table-row", variant === "product-detail" && "pb-promotion-product-row", rowDate && "is-day-selectable", rowDate && rowDate === selectedDate && "is-selected")}
                key={`${String(row[labelKey])}-${index}`}
                onClick={rowDate ? () => onSelectDate?.(rowDate === selectedDate ? null : rowDate) : undefined}
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

function PromotionDailySpendTable({ rows, start, end, selectedDate, onSelectDate }: { rows: PowerBiPromotionDaily[]; start: string; end: string; selectedDate?: string | null; onSelectDate?: (date: string | null) => void }) {
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
      <div className="pb-panel-title">每日推广费用 <small>花费（未含达人）· {start} 至 {end} · 共 {dailyRows.length} 天 · 年度 → 月份 → 日可展开折叠 · 点击日行联动本页数据</small></div>
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
                <tr className={clsx("pb-table-row", row.hierarchyLevel !== "day" && "is-hierarchy-summary", row.hierarchyLevel === "day" && "is-day-selectable", row.hierarchyLevel === "day" && row.date === selectedDate && "is-selected")} data-hierarchy-key={row.hierarchyKey} data-hierarchy-level={row.hierarchyLevel} key={`${row.hierarchyLevel}-${row.hierarchyKey}`} onClick={row.hierarchyLevel === "day" ? () => onSelectDate?.(row.date === selectedDate ? null : row.date) : undefined} style={{ "--pb-row-delay": `${180 + Math.min(index, 12) * 28}ms` } as CSSProperties}>
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

function OverallPage({ pages, start, end, selectedDate, onSelectDate }: { pages: PowerBiPages; start: string; end: string; selectedDate: string | null; onSelectDate: (date: string | null) => void }) {
  // 点选每天核心数据日行时，本页其余模块按所选日期过滤；表格自身保持完整区间以便改选
  const effectiveStart = selectedDate ?? start;
  const effectiveEnd = selectedDate ?? end;
  const overallDaily = inPeriod(pages.overallDaily, effectiveStart, effectiveEnd);
  const dailyCore = inPeriod(pages.dailyCore ?? [], start, end);
  const products = aggregateProductRows(inPeriod(pages.productDaily, effectiveStart, effectiveEnd));
  const productsById = new Map(pages.products.map((item) => [item.productId, item]));
  const promotionProducts = aggregatePromotion(inPeriod(pages.promotionProductDaily, effectiveStart, effectiveEnd), "productId");
  const spendByProduct = new Map(promotionProducts.map((item) => [item.productId, item.spend]));
  const priorYearMap = new Map(pages.productDailyPriorYear.map((item) => [item.productId, item]));
  const totalSubsidized = products.reduce((sum, row) => sum + (row.payAmount - row.refund) * 0.85, 0);
  const promotionSpendByDate = new Map<string, number>();
  inPeriod(pages.promotionSceneDaily, effectiveStart, effectiveEnd).forEach((row) => {
    promotionSpendByDate.set(row.date, (promotionSpendByDate.get(row.date) || 0) + (row.spend || 0));
  });

  const prev = previousPeriod(effectiveStart, effectiveEnd);
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
  // mds 店铺日汇总（钉钉同源）：固定按日降序，不受每天核心数据行点选影响
  const shopSummaryDaily = inPeriod(pages.shopSummaryDaily ?? [], start, end).sort((a, b) => b.date.localeCompare(a.date));
  const shopSummaryPagination = usePagination(shopSummaryDaily, `${start}|${end}|${shopSummaryDaily.length}`);

  return (
    <div className="pb-overall-layout" data-search-anchor="analytics-tmall-overall">
      <div className="pb-overall-main">
        <section className="pb-panel-title">店铺基础数据 <small>期间 {effectiveStart} 至 {effectiveEnd}{selectedDate ? " · 环比对比前一日" : ""}</small></section>
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
        <div className="pb-panel-title">每天核心数据 <small>年度 → 月份 → 日可展开折叠 · 默认按日升序 · 点击日行联动本页数据{selectedDate ? `（已选 ${selectedDate}）` : ""}</small></div>
        <div className="pb-table-wrap pb-animated-table"><table className="pb-data-table pb-daily-core-table" data-testid="powerbi-daily-core-table"><thead><tr><SortHeader columnKey="year" label="年度" sort={dailySort} /><SortHeader columnKey="month" label="月份" sort={dailySort} /><SortHeader columnKey="day" label="日" sort={dailySort} /><SortHeader columnKey="productVisitors" label="商品访客数" sort={dailySort} /><SortHeader columnKey="addToCart" label="加购人数" sort={dailySort} /><SortHeader columnKey="addToCartRate" label="加购率" sort={dailySort} /><SortHeader columnKey="addToCartCost" label="加购成本" sort={dailySort} /><SortHeader columnKey="payAmount" label="支付金额" sort={dailySort} /><SortHeader columnKey="paidUnits" label="支付件数" sort={dailySort} /><SortHeader columnKey="conversionRate" label="访客转化率" sort={dailySort} /><SortHeader columnKey="refundAmount" label="退款金额" sort={dailySort} /><SortHeader columnKey="refundRate" label="退款率" sort={dailySort} /><SortHeader columnKey="spend" label="费额" sort={dailySort} /><SortHeader columnKey="subsidizedAmount" label="国补后金额(万)" sort={dailySort} /><SortHeader columnKey="subsidizedFeeRate" label="国补后费比" sort={dailySort} /><SortHeader columnKey="storeRank" label="店铺排名" sort={dailySort} /></tr></thead><tbody>{dailyPagination.pagedItems.map((row: DailyCoreHierarchyRow, index) => <tr className={clsx("pb-table-row", row.hierarchyLevel !== "day" && "is-hierarchy-summary", row.hierarchyLevel === "day" && "is-day-selectable", row.hierarchyLevel === "day" && row.date === selectedDate && "is-selected")} data-hierarchy-key={row.hierarchyKey} data-hierarchy-level={row.hierarchyLevel} key={`${row.hierarchyLevel}-${row.hierarchyKey}`} onClick={row.hierarchyLevel === "day" ? () => onSelectDate(row.date === selectedDate ? null : row.date) : undefined} style={{ "--pb-row-delay": `${260 + Math.min(index, 12) * 28}ms` } as CSSProperties}><td className="pb-hierarchy-cell">{row.showYear ? <button aria-expanded={expandedYears.has(row.year)} aria-label={`${expandedYears.has(row.year) ? "折叠" : "展开"}年度 ${row.year}`} className="pb-hierarchy-toggle" data-testid="daily-core-year-toggle" onClick={() => toggleExpanded(setExpandedYears, row.year)} type="button"><span aria-hidden="true" className="pb-hierarchy-icon">{expandedYears.has(row.year) ? "−" : "+"}</span><span>{row.year}</span></button> : null}</td><td className="pb-hierarchy-cell">{row.showMonth ? <button aria-expanded={expandedMonths.has(`${row.year}|${row.month}`)} aria-label={`${expandedMonths.has(`${row.year}|${row.month}`) ? "折叠" : "展开"}月份 ${row.month}`} className="pb-hierarchy-toggle" data-testid="daily-core-month-toggle" onClick={() => toggleExpanded(setExpandedMonths, `${row.year}|${row.month}`)} type="button"><span aria-hidden="true" className="pb-hierarchy-icon">{expandedMonths.has(`${row.year}|${row.month}`) ? "−" : "+"}</span><span>{row.month}</span></button> : null}</td><td>{row.hierarchyLevel === "day" ? row.day : ""}</td><td>{pbixInteger(row.productVisitors)}</td><td>{pbixInteger(row.addToCart)}</td><td>{pbixPercent(row.addToCartRate)}</td><td>{pbixDecimal(row.addToCartCost)}</td><td>{pbixWan(row.payAmount)}</td><td>{pbixInteger(row.paidUnits)}</td><td>{pbixPercent(row.conversionRate)}</td><td>{pbixWan(row.refundAmount)}</td><td>{pbixPercent(row.refundRate)}</td><td>{pbixWan(row.spend)}</td><td>{pbixWan(row.subsidizedAmount)}</td><td>{pbixPercent(row.subsidizedFeeRate)}</td><td>{row.storeRank || "—"}</td></tr>)}</tbody></table></div>
        <Pagination onPage={dailyPagination.setPage} page={dailyPagination.page} totalItems={dailyPagination.totalItems} totalPages={dailyPagination.totalPages} />
      </section>
      <section className="pb-product-table">
        <div className="pb-panel-title">商品经营明细 <small>默认按支付金额</small></div>
        <div className="pb-table-wrap pb-animated-table"><table className="pb-data-table pb-business-product-table"><thead><tr><SortHeader columnKey="product" label="商品" sort={productSort} /><SortHeader columnKey="visitors" label="访客" sort={productSort} /><SortHeader columnKey="payBuyers" label="支付买家" sort={productSort} /><SortHeader columnKey="convRate" label="转化率" sort={productSort} /><SortHeader columnKey="payAmount" label="支付金额" sort={productSort} /><SortHeader columnKey="subsidized" label="国补后金额(万)" sort={productSort} /><SortHeader columnKey="amountShare" label="销额占比" sort={productSort} /><SortHeader columnKey="yoy" label="国补后金额同比" sort={productSort} /><SortHeader columnKey="paidUnits" label="支付件数" sort={productSort} /><SortHeader columnKey="refund" label="退款额" sort={productSort} /><SortHeader columnKey="refundShare" label="退款占比" sort={productSort} /><SortHeader columnKey="addToCart" label="加购" sort={productSort} /><SortHeader columnKey="cartRate" label="加购率" sort={productSort} /><SortHeader columnKey="spend" label="推广花费" sort={productSort} /><SortHeader columnKey="subsidizedFeeRate" label="国补后费比" sort={productSort} /><SortHeader columnKey="unitPrice" label="件单价" sort={productSort} /></tr></thead><tbody>{productPagination.pagedItems.map((row, index) => { const spend = spendByProduct.get(row.productId) || 0; const product = productsById.get(row.productId); const shortName = product?.merchantCode || row.productId || "未匹配商品"; const subsidized = (row.payAmount - row.refund) * 0.85; const amountShare = totalSubsidized ? subsidized / totalSubsidized : 0; const prior = priorYearMap.get(row.productId); const priorSubsidized = prior ? (prior.payAmount - prior.refund) * 0.85 : 0; const hasPrior = Boolean(prior) && priorSubsidized > 0; return <tr className="pb-table-row pb-business-product-row" key={row.productId} style={{ "--pb-row-delay": `${300 + Math.min(index, 12) * 32}ms` } as CSSProperties}><td className="pb-row-label pb-product-label" title={row.productName}><ProductThumb alt={row.productName || shortName} size="md" src={product?.imageUrl} /><span>{shortName}</span></td><td>{number(row.visitors)}</td><td>{number(row.payBuyers)}</td><td>{percent(rate(row.payBuyers, row.visitors))}</td><td>{money(row.payAmount)}</td><td>{moneyPrecise(subsidized)}</td><td>{percent(amountShare)}</td><td>{hasPrior ? <Delta current={subsidized} previous={priorSubsidized} /> : <span className="pb-na">数据不足</span>}</td><td>{number(row.paidUnits)}</td><td>{money(row.refund)}</td><td>{percent(rate(row.refund, row.payAmount))}</td><td>{number(row.addToCart)}</td><td>{percent(rate(row.addToCart, row.visitors))}</td><td>{money(spend)}</td><td>{percent(rate(spend, subsidized))}</td><td>{`¥${rate(row.payAmount, row.paidUnits).toFixed(0)}`}</td></tr>; })}</tbody></table></div>
        <Pagination onPage={productPagination.setPage} page={productPagination.page} totalItems={productPagination.totalItems} totalPages={productPagination.totalPages} />
      </section>
      {shopSummaryDaily.length > 0 && (
        <section className="pb-shop-summary">
          <div className="pb-panel-title">店铺日汇总（钉钉同源） <small>mds 库直读 · 与钉钉「全渠道目标进度表」同口径 · 按日降序 · 不依赖生意参谋导出文件</small></div>
          <div className="pb-table-wrap pb-animated-table"><table className="pb-data-table" data-testid="shop-summary-mds-table"><thead><tr><th>日期</th><th>浏览量</th><th>店铺客户数</th><th>GMV</th><th>成功退款金额</th><th>加购人数</th><th>关键词推广</th><th>精准人群推广</th><th>全站推广</th><th>内容场景</th><th>淘客</th><th>店铺排名</th></tr></thead><tbody>{shopSummaryPagination.pagedItems.map((row: PowerBiShopSummaryDaily, index: number) => <tr className="pb-table-row" key={row.date} style={{ "--pb-row-delay": `${300 + Math.min(index, 12) * 32}ms` } as CSSProperties}><td>{row.date}</td><td>{countOrDash(row.pageViews)}</td><td>{countOrDash(row.shopCustomers)}</td><td>{wanOrDash(row.gmv)}</td><td>{wanOrDash(row.refundAmount)}</td><td>{countOrDash(row.addToCart)}</td><td>{wanOrDash(row.keywordSpend)}</td><td>{wanOrDash(row.audienceSpend)}</td><td>{wanOrDash(row.fullSiteSpend)}</td><td>{wanOrDash(row.contentSceneSpend)}</td><td>{wanOrDash(row.taokeCommission)}</td><td>{row.storeRank || "—"}</td></tr>)}</tbody></table></div>
          <Pagination onPage={shopSummaryPagination.setPage} page={shopSummaryPagination.page} totalItems={shopSummaryPagination.totalItems} totalPages={shopSummaryPagination.totalPages} />
        </section>
      )}
    </div>
  );
}

function PromotionPage({ pages, start, end, selectedDate, onSelectDate }: { pages: PowerBiPages; start: string; end: string; selectedDate: string | null; onSelectDate: (date: string | null) => void }) {
  // 点选日行时，场景/商品聚合按所选日期过滤；每日推广费用表保持完整区间以便改选
  const effectiveStart = selectedDate ?? start;
  const effectiveEnd = selectedDate ?? end;
  const sceneDaily = inPeriod(pages.promotionSceneDaily, start, end);
  const sceneRows = aggregatePromotion(inPeriod(pages.promotionSceneDaily, effectiveStart, effectiveEnd), "scene");
  const productRows = aggregatePromotion(inPeriod(pages.promotionProductDaily, effectiveStart, effectiveEnd), "productId");
  const products = new Map(pages.products.map((item) => [item.productId, item]));
  const labelledProducts = productRows.map((row) => {
    const product = products.get(row.productId || "");
    return { ...row, displayLabel: product?.merchantCode || row.productId, imageUrl: product?.imageUrl || null };
  });
  return <div className="pb-detail-layout" data-search-anchor="analytics-tmall-promotion"><main><PromotionDailySpendTable end={end} onSelectDate={onSelectDate} rows={sceneDaily} selectedDate={selectedDate} start={start} /><section className="pb-panel-title">推广计划数据 <small>按场景聚合{selectedDate ? ` · 已选 ${selectedDate}` : ""}</small></section><PromotionTable labelKey="scene" rows={sceneRows} /><section className="pb-panel-title is-spaced">商品推广明细 <small>Top 60，按花费排序 · 图片链接</small></section><PromotionTable labelKey="productId" rows={labelledProducts} showProductImages variant="product-detail" /></main></div>;
}

function ProductPromotionPage({ pages, start, end, selectedDate, onSelectDate }: { pages: PowerBiPages; start: string; end: string; selectedDate: string | null; onSelectDate: (date: string | null) => void }) {
  // 点选日行时，商品列表与场景聚合按所选日期过滤；商品每日推广数据表保持完整区间以便改选
  const effectiveStart = selectedDate ?? start;
  const effectiveEnd = selectedDate ?? end;
  const availableRows = useMemo(() => inPeriod(pages.promotionProductDaily, effectiveStart, effectiveEnd), [pages.promotionProductDaily, effectiveStart, effectiveEnd]);
  const fullRangeRows = useMemo(() => inPeriod(pages.promotionProductDaily, start, end), [pages.promotionProductDaily, start, end]);
  const ranked = useMemo(() => aggregatePromotion(availableRows, "productId"), [availableRows]);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(ranked[0]?.productId || "");
  const products = new Map(pages.products.map((item) => [item.productId, item]));
  useEffect(() => { if (!ranked.some((item) => item.productId === selectedProduct)) setSelectedProduct(ranked[0]?.productId || ""); }, [ranked, selectedProduct]);
  const selectedRows = availableRows.filter((row) => row.productId === selectedProduct);
  const sceneRows = aggregatePromotion(selectedRows, "scene");
  const dailyRows = aggregatePromotion(
    fullRangeRows.filter((row) => row.productId === selectedProduct).map((row) => ({ ...row, productId: row.date })),
    "productId",
  ).sort((left, right) => String(right.productId).localeCompare(String(left.productId)));
  const filteredProducts = ranked.filter((row) => { const product = products.get(row.productId || ""); return `${product?.merchantCode || ""}${product?.productName || ""}${row.productId}`.toLowerCase().includes(search.toLowerCase()); });
  return (
    <div className="pb-product-promotion-layout" data-search-anchor="analytics-tmall-product">
      <aside className="pb-product-selector"><label><Search size={13} /><input onChange={(event) => setSearch(event.target.value)} placeholder="搜索商品编码" value={search} /></label><div>{filteredProducts.map((row, index) => { const product = products.get(row.productId || ""); const label = product?.merchantCode || row.productId || "未匹配商品"; return <button className={selectedProduct === row.productId ? "is-active" : ""} key={row.productId} onClick={() => setSelectedProduct(row.productId || "")} style={{ "--pb-row-delay": `${140 + Math.min(index, 12) * 30}ms` } as CSSProperties} type="button"><ProductThumb alt={product?.productName || label} src={product?.imageUrl} /><span>{label}</span><b>{money(row.spend)}</b><small>{product?.productName || "未匹配商品名称"}</small></button>; })}</div></aside>
      <main><section className="pb-panel-title">商品推广场景 <small>{products.get(selectedProduct)?.merchantCode || selectedProduct || "请选择商品"}{selectedDate ? ` · 已选 ${selectedDate}` : ""}</small></section><PromotionTable labelKey="scene" rows={sceneRows} /><section className="pb-panel-title is-spaced">商品每日推广数据 <small>{start} 至 {end} · 点击行联动本页数据</small></section><PromotionTable labelKey="productId" labelHeader="日期" onSelectDate={onSelectDate} rows={dailyRows.map((row) => ({ ...row, date: row.productId || "", productId: shortDate(row.productId || "") }))} selectedDate={selectedDate} /></main>
    </div>
  );
}

const COMPETITOR_CHANNELS = ["关键词推广", "内容营销", "全站推广", "人群推广"] as const;
const COMPETITOR_CHANNEL_COLORS: Record<string, string> = {
  关键词推广: "#12239E",
  内容营销: "#E66C37",
  全站推广: "#E044A7",
  人群推广: "#6B007B",
};

function competitorPeriodSortKey(period: string): string {
  const match = /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/.exec(period);
  if (!match) return `9999-${period}`;
  const year = match[1] ?? "2026";
  return `${year}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function competitorWan(value: number) {
  return `${(value || 0).toFixed(2)}万`;
}

/** PBIX 视觉中人群成本列按 Sum 聚合（忽略空值；全部为空时保持空）。 */
function competitorSum(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let seen = false;
  values.forEach((value) => {
    if (value != null && Number.isFinite(value)) {
      total += value;
      seen = true;
    }
  });
  return seen ? total : null;
}

interface CompetitorBrandSummary {
  brand: string;
  spendWan: number;
  revenueWan: number;
  impressionsWan: number;
  clicksWan: number;
  cpc: number | null;
  roi: number | null;
  ctr: number | null;
  visitCost: number | null;
  interestCost: number | null;
  firstPurchaseCost: number | null;
  repurchaseCost: number | null;
}

function summarizeCompetitorByBrand(rows: PowerBiCompetitorDaily[]): CompetitorBrandSummary[] {
  const groups = new Map<string, PowerBiCompetitorDaily[]>();
  rows.forEach((row) => {
    const list = groups.get(row.brand) ?? [];
    list.push(row);
    groups.set(row.brand, list);
  });
  const summaries: CompetitorBrandSummary[] = [];
  groups.forEach((list, brand) => {
    const spendWan = list.reduce((sum, row) => sum + (row.spendWan || 0), 0);
    const revenueWan = list.reduce((sum, row) => sum + (row.revenueWan || 0), 0);
    const impressionsWan = list.reduce((sum, row) => sum + (row.impressionsWan || 0), 0);
    const clicksWan = list.reduce((sum, row) => sum + (row.clicksWan || 0), 0);
    summaries.push({
      brand,
      spendWan,
      revenueWan,
      impressionsWan,
      clicksWan,
      // 万元 / 万点击 = 元/点击
      cpc: clicksWan ? spendWan / clicksWan : null,
      roi: spendWan ? revenueWan / spendWan : null,
      ctr: impressionsWan ? clicksWan / impressionsWan : null,
      visitCost: competitorSum(list.map((row) => row.visitCost)),
      interestCost: competitorSum(list.map((row) => row.interestCost)),
      firstPurchaseCost: competitorSum(list.map((row) => row.firstPurchaseCost)),
      repurchaseCost: competitorSum(list.map((row) => row.repurchaseCost)),
    });
  });
  return summaries.sort((left, right) => right.spendWan - left.spendWan);
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const scaled = value / base;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * base;
}

function CompetitorSpendChart({ rows, brands }: { rows: PowerBiCompetitorDaily[]; brands: string[] }) {
  const width = 640;
  const height = 386;
  const margin = { top: 24, right: 14, bottom: 78, left: 54 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const [hoveredBrand, setHoveredBrand] = useState<string | null>(null);
  const spendByKey = new Map<string, number>();
  const totalByBrand = new Map<string, number>();
  rows.forEach((row) => {
    const key = `${row.brand}|${row.channel}`;
    spendByKey.set(key, (spendByKey.get(key) || 0) + (row.spendWan || 0));
    totalByBrand.set(row.brand, (totalByBrand.get(row.brand) || 0) + (row.spendWan || 0));
  });
  const maxValue = Math.max(
    0,
    ...brands.flatMap((brand) => COMPETITOR_CHANNELS.map((channel) => spendByKey.get(`${brand}|${channel}`) || 0)),
  );
  const yMax = niceCeil(maxValue);
  const yFor = (value: number) => margin.top + plotHeight - (value / yMax) * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ratio * yMax);
  const tickLabel = (value: number) => (yMax >= 10 ? value.toFixed(0) : value.toFixed(1));
  const groupWidth = plotWidth / Math.max(1, brands.length);
  const gap = 2;
  const barWidth = Math.max(4, Math.min(16, (groupWidth - 12) / COMPETITOR_CHANNELS.length - gap));
  const groupTotalWidth = COMPETITOR_CHANNELS.length * barWidth + (COMPETITOR_CHANNELS.length - 1) * gap;
  const legendItemWidth = 86;
  const legendStartX = margin.left + (plotWidth - legendItemWidth * COMPETITOR_CHANNELS.length - 18 * (COMPETITOR_CHANNELS.length - 1)) / 2;
  return (
    <svg
      aria-label="品牌×渠道消耗柱状图（单位：万）"
      className="pb-competitor-chart-svg"
      onMouseLeave={() => setHoveredBrand(null)}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <text className="pb-competitor-axis-note" textAnchor="end" x={width - margin.right} y={14}>单位：万</text>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="pb-competitor-grid" x1={margin.left} x2={width - margin.right} y1={yFor(tick)} y2={yFor(tick)} />
          <text className="pb-competitor-tick" textAnchor="end" x={margin.left - 6} y={yFor(tick) + 3}>{tickLabel(tick)}</text>
        </g>
      ))}
      <line className="pb-competitor-axis" x1={margin.left} x2={width - margin.right} y1={margin.top + plotHeight} y2={margin.top + plotHeight} />
      {brands.map((brand, brandIndex) => {
        const groupCenter = margin.left + groupWidth * brandIndex + groupWidth / 2;
        const startX = groupCenter - groupTotalWidth / 2;
        const isHovered = hoveredBrand === brand;
        const isDimmed = hoveredBrand !== null && !isHovered;
        return (
          <g
            key={brand}
            onMouseEnter={() => setHoveredBrand(brand)}
            style={{ cursor: "crosshair" }}
          >
            {/* 隐形 hit area 覆盖整个 group，鼠标移出也保留 hover 直至鼠标移入下一组或 chart 区域外 */}
            <rect
              fill="transparent"
              height={plotHeight + 18}
              width={groupWidth}
              x={margin.left + groupWidth * brandIndex}
              y={margin.top - 6}
            />
            {COMPETITOR_CHANNELS.map((channel, channelIndex) => {
              const value = spendByKey.get(`${brand}|${channel}`) || 0;
              const barX = startX + channelIndex * (barWidth + gap);
              const barHeight = value > 0 ? Math.max(1, margin.top + plotHeight - yFor(value)) : 0;
              const barY = margin.top + plotHeight - barHeight;
              return (
                <g key={channel}>
                  {value > 0 && (
                    <rect
                      fill={COMPETITOR_CHANNEL_COLORS[channel]}
                      fillOpacity={isDimmed ? 0.18 : 1}
                      height={barHeight}
                      stroke={isHovered ? "rgba(0, 235, 207, 0.95)" : "transparent"}
                      strokeWidth={isHovered ? 1.2 : 0}
                      width={barWidth}
                      x={barX}
                      y={barY}
                    />
                  )}
                  {/* 悬停时在每根柱顶部展示该渠道消耗标签（精确数字） */}
                  {isHovered && value > 0 && (
                    <text
                      className="pb-competitor-hover-value"
                      textAnchor="middle"
                      x={barX + barWidth / 2}
                      y={barY - 4}
                    >{value.toFixed(1)}</text>
                  )}
                </g>
              );
            })}
            <text
              className={isHovered ? "pb-competitor-category is-hover" : "pb-competitor-category"}
              textAnchor="middle"
              x={groupCenter}
              y={margin.top + plotHeight + 18}
            >{brand}</text>
            {/* 悬停时在类别标签下方展示品牌合计 */}
            {isHovered && (
              <text
                className="pb-competitor-hover-total"
                textAnchor="middle"
                x={groupCenter}
                y={margin.top + plotHeight + 32}
              >合计 {(totalByBrand.get(brand) || 0).toFixed(1)} 万</text>
            )}
          </g>
        );
      })}
      {COMPETITOR_CHANNELS.map((channel, index) => (
        <g key={`legend-${channel}`}>
          <rect
            fill={COMPETITOR_CHANNEL_COLORS[channel]}
            height={9}
            rx={2}
            width={10}
            x={legendStartX + index * (legendItemWidth + 18)}
            y={margin.top + plotHeight + 36}
          />
          <text
            className="pb-competitor-legend-text"
            x={legendStartX + index * (legendItemWidth + 18) + 15}
            y={margin.top + plotHeight + 44}
          >{channel}</text>
        </g>
      ))}
    </svg>
  );
}

function CompetitorPage({ pages, refreshedAt }: { pages: PowerBiPages; refreshedAt?: string | null }) {
  const allRows = useMemo(() => pages.competitorDaily ?? [], [pages.competitorDaily]);
  const periods = useMemo(
    () => [...new Set(allRows.map((row) => row.period))].sort((left, right) => competitorPeriodSortKey(left).localeCompare(competitorPeriodSortKey(right))),
    [allRows],
  );
  const brands = useMemo(
    () => [...new Set(allRows.map((row) => row.brand))].sort((left, right) => left.localeCompare(right, "zh-Hans-CN")),
    [allRows],
  );
  const latestPeriod = periods.length ? periods[periods.length - 1] : "";
  const [period, setPeriod] = useState(latestPeriod);
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(() => new Set(brands));
  // 人群成本 hover 浮窗 portal：fixed 定位摆脱 overflow:auto 父容器裁切
  const [costTooltip, setCostTooltip] = useState<{ content: string; x: number; y: number } | null>(null);
  const showCostTooltip = (event: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>, content: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // 浮窗放在 chip 上方，水平右对齐；如贴顶则改放下方
    const preferAbove = rect.top > 220;
    const x = Math.max(8, Math.min(window.innerWidth - 296, rect.right - 280));
    const y = preferAbove ? rect.top - 8 : rect.bottom + 8;
    setCostTooltip({ content, x, y });
  };
  const hideCostTooltip = () => setCostTooltip(null);
  useEffect(() => {
    if (periods.length && !periods.includes(period)) setPeriod(latestPeriod);
  }, [periods, period, latestPeriod]);
  useEffect(() => {
    if (brands.length && !brands.some((brand) => selectedBrands.has(brand))) setSelectedBrands(new Set(brands));
  }, [brands, selectedBrands]);
  const filteredRows = useMemo(
    () => allRows.filter((row) => row.period === period && selectedBrands.has(row.brand)),
    [allRows, period, selectedBrands],
  );
  const selectedBrandList = useMemo(() => brands.filter((brand) => selectedBrands.has(brand)), [brands, selectedBrands]);
  const brandSummary = useMemo(() => summarizeCompetitorByBrand(filteredRows), [filteredRows]);
  const detailSort = useColumnSort("spendWan", "desc");
  const detailAccessors: Record<string, (row: PowerBiCompetitorDaily) => SortValue> = {
    brand: (row) => row.brand,
    channel: (row) => row.channel,
    spendWan: (row) => row.spendWan,
    roi: (row) => row.roi,
    spendShare: (row) => row.spendShare,
    impressionsWan: (row) => row.impressionsWan,
    clicksWan: (row) => row.clicksWan,
    ctr: (row) => row.ctr,
    visitCost: (row) => row.visitCost,
    interestCost: (row) => row.interestCost,
    firstPurchaseCost: (row) => row.firstPurchaseCost,
    repurchaseCost: (row) => row.repurchaseCost,
  };
  const sortedDetail = sortRows(filteredRows, detailSort.sortKey, detailSort.sortDir, detailAccessors);
  const detailPagination = usePagination(sortedDetail, `${period}-${[...selectedBrands].sort().join(",")}-${detailSort.sortKey}-${detailSort.sortDir}`);
  const summarySort = useColumnSort("spendWan", "desc");
  const summaryAccessors: Record<string, (row: CompetitorBrandSummary) => SortValue> = {
    brand: (row) => row.brand,
    spendWan: (row) => row.spendWan,
    roi: (row) => row.roi,
    impressionsWan: (row) => row.impressionsWan,
    clicksWan: (row) => row.clicksWan,
    cpc: (row) => row.cpc,
    ctr: (row) => row.ctr,
    revenueWan: (row) => row.revenueWan,
    visitCost: (row) => row.visitCost,
    interestCost: (row) => row.interestCost,
    firstPurchaseCost: (row) => row.firstPurchaseCost,
    repurchaseCost: (row) => row.repurchaseCost,
  };
  const sortedSummary = sortRows(brandSummary, summarySort.sortKey, summarySort.sortDir, summaryAccessors);
  const maxDetailSpend = Math.max(1, ...filteredRows.map((row) => row.spendWan || 0));
  // ROI 健康度：≥6 优秀（teal）/ 4-6 良好（amber）/ <4 掉队（magenta），避免用任意 /10 刻度
  // 排除 ROI > 30 的极值（冷启动/异常）以防 p99 极值把整张归一化压垮
  const saneRois = filteredRows.map((row) => row.roi).filter((v): v is number => v != null && Number.isFinite(v) && v <= 30 && v >= 0);
  const maxDetailRoi = Math.max(1, ...saneRois);
  const roiHealth = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "na";
    if (value >= 6) return "great";
    if (value >= 4) return "good";
    return "poor";
  };
  const roiHealthColor: Record<string, string> = {
    great: "rgba(0, 235, 207, 0.85)",
    good: "rgba(222, 168, 92, 0.85)",
    poor: "rgba(214, 69, 80, 0.85)",
    na: "rgba(127, 145, 148, 0.35)",
  };
  // 4 KPI：总消耗 / 消耗 Top 品牌 / 渠道 Top / ROI Top
  const totalSpend = filteredRows.reduce((sum, row) => sum + (row.spendWan || 0), 0);
  const leaderBrandRow = sortedSummary[0];
  const spendByChannel = new Map<string, number>();
  filteredRows.forEach((row) => spendByChannel.set(row.channel, (spendByChannel.get(row.channel) || 0) + (row.spendWan || 0)));
  const topChannel = [...spendByChannel.entries()].sort((left, right) => right[1] - left[1])[0];
  const topChannelShare = topChannel && totalSpend > 0 ? topChannel[1] / totalSpend : 0;
  const topRoiBrand = [...sortedSummary].filter((row) => row.roi != null && Number.isFinite(row.roi)).sort((left, right) => (right.roi ?? 0) - (left.roi ?? 0))[0];
  // 自动派生 1 句 pull quote：渠道集中度 + 头部品牌占比
  const top3Spend = sortedSummary.slice(0, 3).reduce((sum, row) => sum + row.spendWan, 0);
  const top3Share = totalSpend > 0 ? top3Spend / totalSpend : 0;
  const insight = topChannel
    ? `「${topChannel[0]}」独占本期 ${(topChannelShare * 100).toFixed(1)}% 消耗，Top 3 品牌合占 ${(top3Share * 100).toFixed(1)}%`
    : "";
  const toggleBrand = (brand: string) => {
    setSelectedBrands((current) => {
      const next = new Set(current);
      if (next.has(brand)) next.delete(brand);
      else next.add(brand);
      return next;
    });
  };

  if (!allRows.length) {
    return <div className="pb-empty">暂无竞品推广数据，请先同步 14-推广竞品数据 源。</div>;
  }

  return (
    <div className="pb-competitor-layout" data-search-anchor="analytics-competitor-promotion" data-testid="competitor-promotion-page">
      <header className="pb-competitor-header">
        <img alt="竞品推广数据页标识" className="pb-competitor-logo" src={logoWeixin} />
        <div>
          <h3>竞品推广流量数据</h3>
        </div>
        <div className="pb-competitor-slicers">
          <div className="pb-competitor-slicer">
            <span>品牌</span>
            <div className="pb-competitor-brand-chips">
              {brands.map((brand) => (
                <button
                  aria-pressed={selectedBrands.has(brand)}
                  className={clsx("pb-competitor-brand-chip", selectedBrands.has(brand) && "is-active")}
                  key={brand}
                  onClick={() => toggleBrand(brand)}
                  type="button"
                >
                  {brand}
                </button>
              ))}
            </div>
          </div>
          <label className="pb-competitor-period">
            <span>时间段</span>
            <select aria-label="时间段切片器" onChange={(event) => setPeriod(event.target.value)} value={period}>
              {periods.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
      </header>
      {/* 4 KPI hero：编辑型骨架，让用户 3 秒看到「谁烧钱最多、谁最会算账」 */}
      <div className="pb-competitor-kpi-strip" data-testid="competitor-kpi-strip">
        <div className="pb-competitor-kpi">
          <span className="pb-competitor-kpi-label">本期消耗总额</span>
          <b className="pb-competitor-kpi-value">{competitorWan(totalSpend)}</b>
          <small className="pb-competitor-kpi-foot">{selectedBrandList.length} 个品牌合计</small>
        </div>
        <div className="pb-competitor-kpi">
          <span className="pb-competitor-kpi-label">消耗 Top 品牌</span>
          <b className="pb-competitor-kpi-value">{leaderBrandRow ? leaderBrandRow.brand : "—"}</b>
          <small className="pb-competitor-kpi-foot">{leaderBrandRow ? `${competitorWan(leaderBrandRow.spendWan)} · ROI ${pbixDecimal(leaderBrandRow.roi)}` : "暂无"}</small>
        </div>
        <div className="pb-competitor-kpi is-accent">
          <span className="pb-competitor-kpi-label">主战场渠道</span>
          <b className="pb-competitor-kpi-value">{topChannel ? topChannel[0] : "—"}</b>
          <small className="pb-competitor-kpi-foot">{topChannel ? `占 4 渠道 ${(topChannelShare * 100).toFixed(1)}% · ${competitorWan(topChannel[1])}` : "暂无"}</small>
        </div>
        <div className="pb-competitor-kpi">
          <span className="pb-competitor-kpi-label">最高 ROI 品牌</span>
          <b className="pb-competitor-kpi-value">{topRoiBrand ? topRoiBrand.brand : "—"}</b>
          <small className="pb-competitor-kpi-foot">{topRoiBrand ? `ROI ${pbixDecimal(topRoiBrand.roi)} · 消耗 ${competitorWan(topRoiBrand.spendWan)}` : "暂无"}</small>
        </div>
      </div>
      {insight && <p className="pb-competitor-insight" data-testid="competitor-insight">{insight}<small>—— 推算自本期切片</small></p>}
      <small className="pb-competitor-sync-meta">竞品数据最近同步于 {dateTime(refreshedAt)} · 每日同步计划 11:00 / 18:00（北京时间）</small>
      <div className="pb-competitor-body">
        <section className="pb-competitor-chart">
          <div className="pb-panel-title">品牌×渠道消耗 <small>{period || "-"} · 鼠标悬停查看数据 · 单位：万</small></div>
          {filteredRows.length ? <CompetitorSpendChart brands={selectedBrandList} rows={filteredRows} /> : <div className="pb-empty">当前切片器选择下无数据</div>}
        </section>
        <div className="pb-competitor-tables">
          <section className="pb-competitor-table-block">
            <div className="pb-panel-title">品牌汇总 <small>{period || "-"} · 各渠道合计 · 冠军品牌行高亮</small></div>
            <div className="pb-table-wrap pb-animated-table">
              <table className="pb-data-table pb-competitor-summary-table" data-testid="competitor-brand-summary-table">
                <thead><tr>
                  <SortHeader columnKey="brand" label="品牌" sort={summarySort} />
                  <SortHeader columnKey="spendWan" label="消耗(万)" sort={summarySort} />
                  <SortHeader columnKey="roi" label="ROI(公式)" sort={summarySort} />
                  <SortHeader columnKey="impressionsWan" label="展现量(万)" sort={summarySort} />
                  <SortHeader columnKey="clicksWan" label="点击量(万)" sort={summarySort} />
                  <SortHeader columnKey="cpc" label="平均点击成本" sort={summarySort} />
                  <SortHeader columnKey="ctr" label="点击率(竞品)" sort={summarySort} />
                  <SortHeader columnKey="revenueWan" label="成交金额(万)" sort={summarySort} />
                  <th className="pb-competitor-cost-cell" scope="col">
                    <span>人群成本</span>
                    <small>hover 展开 4 列</small>
                  </th>
                </tr></thead>
                <tbody>
                  {sortedSummary.map((row, index) => {
                    const summaryCostTip = `访问 ${pbixDecimal(row.visitCost)} · 兴趣 ${pbixDecimal(row.interestCost)} · 首购 ${pbixDecimal(row.firstPurchaseCost)} · 复购 ${pbixDecimal(row.repurchaseCost)}`;
                    return (
                      <tr className={clsx("pb-table-row", row.brand === leaderBrandRow?.brand && "is-leader-row")} key={row.brand} style={{ "--pb-row-delay": `${180 + Math.min(index, 12) * 30}ms` } as CSSProperties}>
                        <td className="pb-row-label"><span title={row.brand}>{row.brand}{row.brand === leaderBrandRow?.brand ? " ▲" : ""}</span></td>
                        <td>{competitorWan(row.spendWan)}</td>
                        <td>{pbixDecimal(row.roi)}</td>
                        <td>{competitorWan(row.impressionsWan)}</td>
                        <td>{competitorWan(row.clicksWan)}</td>
                        <td>{pbixDecimal(row.cpc)}</td>
                        <td>{pbixPercent(row.ctr)}</td>
                        <td>{competitorWan(row.revenueWan)}</td>
                        <td className="pb-competitor-cost-cell">
                          <button
                            aria-label={`查看 ${row.brand} 4 列人群成本`}
                            className="pb-competitor-cost-chip"
                            onBlur={hideCostTooltip}
                            onFocus={(e) => showCostTooltip(e, summaryCostTip)}
                            onMouseEnter={(e) => showCostTooltip(e, summaryCostTip)}
                            onMouseLeave={hideCostTooltip}
                            type="button"
                          >
                            查看
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className="pb-competitor-table-block">
            <div className="pb-panel-title">品牌×渠道明细 <small>{period || "-"} · 4 列人群成本合并到 hover 浮窗 · 表头 sticky</small></div>
            <div className="pb-table-wrap pb-animated-table pb-competitor-detail-scroll">
              <table className="pb-data-table pb-competitor-detail-table" data-testid="competitor-brand-channel-table">
                <thead><tr>
                  <SortHeader columnKey="brand" label="品牌" sort={detailSort} />
                  <SortHeader columnKey="channel" label="渠道" sort={detailSort} />
                  <SortHeader columnKey="spendWan" label="消耗(万)" sort={detailSort} />
                  <SortHeader columnKey="roi" label="ROI" sort={detailSort} />
                  <SortHeader columnKey="spendShare" label="消耗占比" sort={detailSort} />
                  <SortHeader columnKey="impressionsWan" label="展现量(万)" sort={detailSort} />
                  <SortHeader columnKey="clicksWan" label="点击量(万)" sort={detailSort} />
                  <SortHeader columnKey="ctr" label="点击率" sort={detailSort} />
                  <th className="pb-competitor-cost-cell" scope="col">
                    <span>人群成本</span>
                    <small>hover 展开 4 列</small>
                  </th>
                </tr></thead>
                <tbody>
                  {detailPagination.pagedItems.map((row, index) => {
                    const health = roiHealth(row.roi);
                    const costTip = `访问 ${pbixDecimal(row.visitCost)} · 兴趣 ${pbixDecimal(row.interestCost)} · 首购 ${pbixDecimal(row.firstPurchaseCost)} · 复购 ${pbixDecimal(row.repurchaseCost)}`;
                    return (
                      <tr className="pb-table-row" key={`${row.brand}-${row.channel}`} style={{ "--pb-row-delay": `${180 + Math.min(index, 12) * 28}ms` } as CSSProperties}>
                        <td className="pb-row-label"><span title={row.brand}>{row.brand}</span></td>
                        <td><span className="pb-competitor-channel"><i style={{ background: COMPETITOR_CHANNEL_COLORS[row.channel] || "transparent" }} />{row.channel}</span></td>
                        <td><span className="pb-data-bar"><i style={{ width: `${Math.min(100, (row.spendWan || 0) / maxDetailSpend * 100)}%`, background: "linear-gradient(90deg, rgba(76, 190, 182, 0.22), rgba(76, 190, 182, 0.62))" }} /><b>{competitorWan(row.spendWan)}</b></span></td>
                        <td><span className="pb-data-bar" data-health={health}><i style={{ width: `${Math.min(100, ((row.roi ?? 0) / maxDetailRoi) * 100)}%`, background: roiHealthColor[health] }} /><b>{pbixDecimal(row.roi)}</b></span></td>
                        <td><span className="pb-data-bar"><i style={{ width: `${Math.min(100, (row.spendShare ?? 0) * 100)}%`, background: "rgba(214, 69, 80, 0.55)" }} /><b>{pbixPercent(row.spendShare)}</b></span></td>
                        <td>{competitorWan(row.impressionsWan)}</td>
                        <td>{competitorWan(row.clicksWan)}</td>
                        <td>{pbixPercent(row.ctr)}</td>
                        <td className="pb-competitor-cost-cell">
                          <button
                            aria-label={`查看 ${row.brand} · ${row.channel} 4 列人群成本`}
                            className="pb-competitor-cost-chip"
                            onBlur={hideCostTooltip}
                            onFocus={(e) => showCostTooltip(e, costTip)}
                            onMouseEnter={(e) => showCostTooltip(e, costTip)}
                            onMouseLeave={hideCostTooltip}
                            type="button"
                          >
                            查看
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination onPage={detailPagination.setPage} page={detailPagination.page} totalItems={detailPagination.totalItems} totalPages={detailPagination.totalPages} />
          </section>
        </div>
      </div>
      {costTooltip && createPortal(
        <div
          aria-hidden="true"
          className="pb-competitor-tooltip-portal"
          role="tooltip"
          style={{ left: costTooltip.x, top: costTooltip.y, transform: costTooltip.y < 0 ? "translateY(-100%)" : undefined }}
        >
          {costTooltip.content}
        </div>,
        document.body,
      )}
    </div>
  );
}

type ServiceMetricRow = Record<string, number | string | null | undefined>;

type AggregateConfig =
  | { key: string; aggregate: "sum" | "avg" | "avgOrNull" }
  | { key: string; aggregate: "weightedAverage"; weightKey: string };

function sumRows(rows: ServiceMetricRow[], key: string): number {
  return rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
}

/** 平均时忽略 null/NaN：数仓对无数据日产出 null（如京东转化率、天猫询单转化率），
 *  若把 null 当 0 计入分母会系统性拉低比率/时长类 KPI，范围越大偏差越大。 */
function avgRows(rows: ServiceMetricRow[], key: string): number {
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    const value = row[key];
    if (value == null) continue;
    const num = Number(value);
    if (!Number.isFinite(num)) continue;
    sum += num;
    count += 1;
  }
  return count ? sum / count : 0;
}

/** 与 avgRows 同口径忽略 null/NaN，但整列无数据时返回 null（渲染「—」）而非 0，
 *  避免把「该店铺无此指标」（如京东POP无首次响应）显示成虚假的 0.0s。 */
function avgRowsOrNull(rows: ServiceMetricRow[], key: string): number | null {
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    const value = row[key];
    if (value == null) continue;
    const num = Number(value);
    if (!Number.isFinite(num)) continue;
    sum += num;
    count += 1;
  }
  return count ? sum / count : null;
}

/** 加权平均：分子 = Σ(指标 × 权重)、分母 = Σ(权重)。
 *  null 视为「不参与」（与 avgRows 忽略 null 的语义对齐），权重 ≤ 0 同样跳过。
 *  分母为 0 时返回 null（渲染层用 "—" 表达无数据）。 */
function weightedAverageRows(rows: ServiceMetricRow[], key: string, weightKey: string): number | null {
  let num = 0;
  let den = 0;
  for (const row of rows) {
    const value = Number(row[key]);
    const weight = Number(row[weightKey]);
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    num += value * weight;
    den += weight;
  }
  return den > 0 ? num / den : null;
}

/** 按客服聚合（范围内每客服一行）：数值 SUM、比率/时长 AVG、比率/时长可加权，忽略无数据日。 */
function aggregateAgentRows(rows: PowerBiCustomerServiceAgent[], config: AggregateConfig[]): PowerBiCustomerServiceAgent[] {
  const groups = new Map<string, PowerBiCustomerServiceAgent[]>();
  for (const row of rows) {
    const list = groups.get(row.agent) ?? [];
    list.push(row);
    groups.set(row.agent, list);
  }
  return [...groups.entries()].map(([, list]) => {
    const base: PowerBiCustomerServiceAgent = { ...list[0], date: "" };
    const metricList = list as unknown as ServiceMetricRow[];
    for (const configItem of config) {
      const { key } = configItem;
      if (configItem.aggregate === "sum") {
        (base as unknown as Record<string, number>)[key] = sumRows(metricList, key);
      } else if (configItem.aggregate === "avg") {
        (base as unknown as Record<string, number>)[key] = avgRows(metricList, key);
      } else if (configItem.aggregate === "avgOrNull") {
        (base as unknown as Record<string, number | null>)[key] = avgRowsOrNull(metricList, key);
      } else if (configItem.aggregate === "weightedAverage") {
        (base as unknown as Record<string, number | null>)[key] = weightedAverageRows(metricList, key, configItem.weightKey);
      }
    }
    return base;
  });
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** range 前紧邻的同长度周期（用于「较上期」环比）；无 range 或无法前推时返回 null。 */
function previousRangeFor(range: { start: string; end: string } | null): { start: string; end: string } | null {
  if (!range) return null;
  const days = Math.round((new Date(`${range.end}T00:00:00Z`).getTime() - new Date(`${range.start}T00:00:00Z`).getTime()) / 86_400_000) + 1;
  return { start: shiftDate(range.start, -days), end: shiftDate(range.start, -1) };
}

function CustomerServiceTrendChart({ rows, leftSeries, rightSeries }: {
  rows: ServiceMetricRow[];
  leftSeries: Array<{ key: string; label: string; color: string; tooltipFormat?: (value: number) => string }>;
  rightSeries: Array<{ key: string; label: string; color: string; scaleValue: (value: number) => number; tooltipFormat?: (value: number) => string }>;
}) {
  const width = 960;
  const height = 240;
  const margin = { top: 28, right: 56, bottom: 30, left: 56 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const valid = rows.filter((row) => String(row.date || ""));
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const leftMax = Math.max(1, ...valid.map((row) => Number(row[leftSeries[0].key] ?? 0)));
  const rightValues = valid.flatMap((row) => rightSeries.map((series) => series.scaleValue(Number(row[series.key] ?? 0))));
  const rightMax = Math.max(1, ...rightValues);
  const step = valid.length > 1 ? plotWidth / (valid.length - 1) : 0;
  const xFor = (index: number) => margin.left + index * step;
  const leftYFor = (value: number) => margin.top + plotHeight - (value / leftMax) * plotHeight;
  const rightYFor = (value: number) => margin.top + plotHeight - (value / rightMax) * plotHeight;
  const pathFor = (key: string, yFor: (v: number) => number) =>
    valid.map((row, index) => `${index === 0 ? "M" : "L"}${xFor(index).toFixed(1)},${yFor(Number(row[key] ?? 0)).toFixed(1)}`).join(" ");
  const leftTicks = [0, 0.5, 1].map((ratio) => ratio * leftMax);
  const rightTicks = [0, 0.5, 1].map((ratio) => ratio * rightMax);
  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const node = containerRef.current;
    if (!rect || !node || valid.length < 2) return;
    // getBoundingClientRect 返回视觉像素（祖先有 zoom:1.3），CSS left 按容器本地像素生效，
    // 需换算回本地坐标系（clientWidth），否则 tooltip 位置随 zoom 倍率偏移。
    const localWidth = node.clientWidth;
    const hoverXLocal = (event.clientX - rect.left) * (localWidth / rect.width);
    const logicalX = hoverXLocal * (width / localWidth);
    const index = Math.round((logicalX - margin.left) / step);
    // 排除左侧 margin 越界：Math.round(-0.35) 返回 -0，而 -0 >= 0 为真，
    // 仅靠 index >= 0 无法拦截，需同时约束 logicalX 未越过 plot 左缘。
    if (logicalX >= margin.left && index >= 0 && index < valid.length) {
      setHoverIndex(index);
      setHoverX(hoverXLocal);
      setContainerWidth(localWidth);
    } else {
      setHoverIndex(null);
    }
  };
  const handleMouseLeave = () => setHoverIndex(null);
  const hoverRow = hoverIndex != null ? valid[hoverIndex] : null;
  const tooltipLeft = containerWidth ? Math.max(96, Math.min(hoverX, containerWidth - 96)) : 96;
  return (
    <div className="pb-chart-wrap" onMouseLeave={handleMouseLeave} onMouseMove={handleMouseMove} ref={containerRef}>
      <svg aria-label="每日客服趋势图" className="pb-competitor-chart-svg" role="img" viewBox={`0 0 ${width} ${height}`}>
        {leftSeries.map((series, index) => (
          <g key={series.key}>
            <rect fill={series.color} height={10} rx={2} width={10} x={margin.left + index * 130} y={8} />
            <text className="pb-competitor-legend-text" x={margin.left + index * 130 + 15} y={17}>{series.label}</text>
          </g>
        ))}
        {rightSeries.map((series, index) => (
          <g key={series.key}>
            <rect fill={series.color} height={10} rx={2} width={10} x={margin.left + (leftSeries.length + index) * 130} y={8} />
            <text className="pb-competitor-legend-text" x={margin.left + (leftSeries.length + index) * 130 + 15} y={17}>{series.label}</text>
          </g>
        ))}
        {leftTicks.map((tick) => (
          <g key={`l${tick}`}>
            <line className="pb-competitor-grid" x1={margin.left} x2={width - margin.right} y1={leftYFor(tick)} y2={leftYFor(tick)} />
            <text className="pb-competitor-tick" textAnchor="end" x={margin.left - 6} y={leftYFor(tick) + 3}>{tick >= 1000 ? (tick / 1000).toFixed(1) + "k" : tick.toFixed(0)}</text>
          </g>
        ))}
        {rightTicks.map((tick) => (
          <g key={`r${tick}`}>
            <text className="pb-competitor-tick" textAnchor="start" x={width - margin.right + 6} y={rightYFor(tick) + 3}>{tick.toFixed(tick >= 100 ? 0 : 1)}</text>
          </g>
        ))}
        <line className="pb-competitor-axis" x1={margin.left} x2={width - margin.right} y1={margin.top + plotHeight} y2={margin.top + plotHeight} />
        {leftSeries.map((series) => (
          <path d={pathFor(series.key, leftYFor)} fill="none" key={series.key} stroke={series.color} strokeLinejoin="round" strokeLinecap="round" strokeWidth={2.2} />
        ))}
        {rightSeries.map((series) => (
          <path d={pathFor(series.key, (value) => rightYFor(series.scaleValue(value)))} fill="none" key={series.key} stroke={series.color} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" strokeWidth={2.2} />
        ))}
        {hoverRow && hoverIndex != null && (
          <g>
            <line stroke="rgba(166, 229, 54, 0.35)" strokeWidth={1} x1={xFor(hoverIndex)} x2={xFor(hoverIndex)} y1={margin.top} y2={margin.top + plotHeight} />
            {leftSeries.map((series) => (
              <circle cx={xFor(hoverIndex)} cy={leftYFor(Number(hoverRow[series.key] ?? 0))} fill={series.color} key={series.key} r={4} />
            ))}
            {rightSeries.map((series) => (
              <circle cx={xFor(hoverIndex)} cy={rightYFor(series.scaleValue(Number(hoverRow[series.key] ?? 0)))} fill={series.color} key={series.key} r={4} />
            ))}
          </g>
        )}
        {valid.map((row, index) => (
          index % Math.max(1, Math.ceil(valid.length / 15)) === 0 ? (
            <text className="pb-competitor-category" key={row.date} textAnchor="middle" x={xFor(index)} y={height - 8}>{String(row.date).slice(5).replace("-", "/")}</text>
          ) : null
        ))}
      </svg>
      {hoverRow && hoverIndex != null && (
        <div className="pb-chart-tooltip" style={{ left: tooltipLeft }}>
          <b>{String(hoverRow.date)}</b>
          {leftSeries.map((series) => (
            <span key={series.key}><i style={{ background: series.color }} />{series.label}：{series.tooltipFormat ? series.tooltipFormat(Number(hoverRow[series.key] ?? 0)) : countFormat.format(Number(hoverRow[series.key] ?? 0))}</span>
          ))}
          {rightSeries.map((series) => (
            <span key={series.key}><i style={{ background: series.color }} />{series.label}：{series.tooltipFormat ? series.tooltipFormat(Number(hoverRow[series.key] ?? 0)) : series.scaleValue(Number(hoverRow[series.key] ?? 0)).toFixed(2)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

interface ServiceKpiTile {
  label: string;
  key: string;
  aggregate: "sum" | "avg" | "avgOrNull" | "weightedAverage";
  format: (value: number) => string;
  note?: string;
  /** 客服维度无此指标时显示「—」（如整体口径的当日询单/销售人数） */
  unavailable?: boolean;
  /** 严格口径（metricsCaliber=strict）下比率的区间口径 = SUM(分子)/SUM(分母)，等价于按分母加权平均；预置口径回落普通平均。 */
  weightKey?: string;
}

/** KPI 卡区：范围内聚合（数值 SUM、比率 AVG；strict 时按分母加权 = SUM/SUM），环比「较上期」（previousRows 同口径聚合）。 */
function ServiceKpiGrid({ rows, previousRows, tiles, strict }: {
  rows: Array<PowerBiCustomerServiceDaily | PowerBiCustomerServiceAgent>;
  previousRows: Array<PowerBiCustomerServiceDaily | PowerBiCustomerServiceAgent>;
  tiles: ServiceKpiTile[];
  strict?: boolean;
}) {
  const metricRows = rows as unknown as ServiceMetricRow[];
  const metricPrevRows = previousRows as unknown as ServiceMetricRow[];
  const aggregate = (list: ServiceMetricRow[], tile: ServiceKpiTile) =>
    tile.aggregate === "sum" ? sumRows(list, tile.key)
    : tile.aggregate === "avgOrNull" ? avgRowsOrNull(list, tile.key)
    : tile.aggregate === "weightedAverage" || (tile.weightKey && strict) ? weightedAverageRows(list, tile.key, tile.weightKey ?? "")
    : avgRows(list, tile.key);
  return (
    <div className="pb-kpi-grid">
      {tiles.map((tile, index) => {
        const current = tile.unavailable ? null : aggregate(metricRows, tile);
        const previous = tile.unavailable || !metricPrevRows.length ? null : aggregate(metricPrevRows, tile);
        return (
          <KpiTile
            current={current ?? 0}
            index={index}
            key={tile.key}
            label={tile.label}
            note={tile.note ?? ""}
            previous={previous}
            value={current == null ? "—" : tile.format(current)}
          />
        );
      })}
    </div>
  );
}

function TmallServicePage({ cs, range }: { cs: PowerBiCustomerService; range: { start: string; end: string } | null }) {
  const tmall = cs.tmall ?? { daily: [], byAgent: [], groups: [] };
  const inRange = (value: string) => !range || (value >= range.start && value <= range.end);
  const allDaily = [...tmall.daily].sort((a, b) => a.date.localeCompare(b.date));
  const daily = allDaily.filter((row) => inRange(row.date));
  const prevRange = previousRangeFor(range);
  const prevDaily = range && prevRange ? allDaily.filter((row) => row.date >= prevRange.start && row.date <= prevRange.end) : [];
  const [group, setGroup] = useState("全部");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const sort = useColumnSort("effectiveReceived");
  const detailRows = tmall.byAgent.filter((row) => inRange(row.date) && (group === "全部" || row.groupName === group));
  const selectedRows = selectedAgent ? detailRows.filter((row) => row.agent === selectedAgent) : [];
  // 严格口径 = 范围内每一行都带原子分子分母（metricsCaliber=strict）：比率按分母加权(SUM/SUM)；
  // 否则(旧结构/precomputed 混合)比率回落普通日平均，并提示「预置口径」。
  const rangeStrict = detailRows.length > 0 && detailRows.every((row) => row.metricsCaliber === "strict");
  const ratioAggregate = (key: string, weightKey: string): AggregateConfig =>
    rangeStrict ? { key, aggregate: "weightedAverage", weightKey } : { key, aggregate: "avg" };
  // 表格恒为「范围内按客服聚合」（每客服一行，无日期列），点击行联动卡片与趋势
  const aggregatedRows = aggregateAgentRows(detailRows, [
    { key: "effectiveReceived", aggregate: "sum" },
    { key: "netSalesWan", aggregate: "sum" },
    { key: "firstResponse", aggregate: "avg" },
    ratioAggregate("answerRatio", "buyerMsgNum"),
    { key: "avgResponse", aggregate: "avg" },
    { key: "unitPrice", aggregate: "avg" },
    ratioAggregate("inquiryConvRate", "consultNum"),
    ratioAggregate("satisfactionRate", "evaluationNum"),
  ]);
  const tableRows = sortRows(aggregatedRows, sort.sortKey, sort.sortDir, {
    agent: (row) => row.agent,
    groupName: (row) => row.groupName ?? null,
    effectiveReceived: (row) => row.effectiveReceived ?? null,
    netSalesWan: (row) => row.netSalesWan ?? null,
    firstResponse: (row) => row.firstResponse ?? null,
    answerRatio: (row) => row.answerRatio ?? null,
    avgResponse: (row) => row.avgResponse ?? null,
    unitPrice: (row) => row.unitPrice ?? null,
    inquiryConvRate: (row) => row.inquiryConvRate ?? null,
    satisfactionRate: (row) => row.satisfactionRate ?? null,
  });
  const agentPagination = usePagination(tableRows, `${selectedAgent ?? "all"}-${group}-${range?.start}-${range?.end}-${sort.sortKey}-${sort.sortDir}`, 10);
  // 选中客服失效时自动清除（改分组/全局日期后该客服可能不在当前明细集内）
  useEffect(() => {
    if (selectedAgent && !detailRows.some((row) => row.agent === selectedAgent)) setSelectedAgent(null);
  }, [selectedAgent, detailRows]);
  const prevAgentRows = selectedAgent
    ? tmall.byAgent.filter((row) => row.agent === selectedAgent && prevRange && row.date >= prevRange.start && row.date <= prevRange.end)
    : [];
  if (!cs.tmall) return null;
  if (!daily.length) return <div className="pb-empty">当前日期范围内无天猫客服数据，请调整日期筛选。</div>;
  const trendRows = selectedAgent ? [...selectedRows].sort((a, b) => a.date.localeCompare(b.date)) : daily;
  const kpiRows = selectedAgent ? selectedRows : daily;
  const kpiPrevRows = selectedAgent ? prevAgentRows : prevDaily;
  const overallTiles: ServiceKpiTile[] = [
    { label: "有效接待人数", key: "effectiveReceived", aggregate: "sum", format: (value) => countFormat.format(value), note: "范围内合计" },
    { label: "询单人数", key: "todayInquiry", aggregate: "sum", format: (value) => countFormat.format(value), note: "范围内合计" },
    { label: "询单最终付款人数", key: "finalPayCusNum", aggregate: "sum", format: (value) => countFormat.format(value), note: "范围内合计" },
    { label: "净销售额", key: "netSales", aggregate: "sum", format: (value) => `${moneyPreciseFormat.format(value / 10000)} 万`, note: "万元" },
    { label: "客单价", key: "unitPrice", aggregate: "avg", format: (value) => `¥${moneyFormat.format(value)}`, note: "每日平均" },
    { label: "询单转化率", key: "inquiryConversionRate", aggregate: "avg", weightKey: "consultNum", format: (value) => percent(value), note: "每日平均" },
  ];
  const agentTiles: ServiceKpiTile[] = [
    { label: "有效接待人数", key: "effectiveReceived", aggregate: "sum", format: (value) => countFormat.format(value), note: "范围内合计" },
    { label: "询单人数", key: "consultNum", aggregate: "sum", format: (value) => countFormat.format(value), note: "范围内合计" },
    { label: "询单最终付款人数", key: "finalPayCusNum", aggregate: "sum", format: (value) => countFormat.format(value), note: "范围内合计" },
    { label: "净销售额", key: "netSalesWan", aggregate: "sum", format: (value) => `${moneyPreciseFormat.format(value)} 万`, note: "万元" },
    { label: "客单价", key: "unitPrice", aggregate: "avg", format: (value) => `¥${moneyFormat.format(value)}`, note: "每日平均" },
    { label: "询单转化率", key: "inquiryConvRate", aggregate: "avg", weightKey: "consultNum", format: (value) => percent(value), note: "每日平均" },
  ];
  const serviceTiles: ServiceKpiTile[] = [
    { label: "首次响应时长", key: "firstResponse", aggregate: "avg", format: (value) => `${value.toFixed(1)}s`, note: "每日平均" },
    { label: "平均响应时长", key: "avgResponse", aggregate: "avg", format: (value) => `${value.toFixed(1)}s`, note: "每日平均" },
    { label: "答问比", key: "answerRatio", aggregate: "avg", weightKey: "buyerMsgNum", format: (value) => value.toFixed(2), note: "答 vs 问 · 每日平均" },
  ];
  const spend = selectedRows.reduce((sum, row) => sum + (row.netSalesWan ?? 0), 0);
  const selectedName = selectedAgent ?? "";
  return (
    <div className="pb-detail-layout" data-search-anchor="analytics-tmall-service">
      <main>
        <div className="pb-service-controls">
          <label><span>旺旺分组</span><select aria-label="筛选旺旺分组" onChange={(event) => setGroup(event.target.value)} value={group}>
            <option value="全部">全部</option>
            {tmall.groups.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <span className="pb-follow-global-date">全局日期 {range ? `${range.start} 至 ${range.end}` : "全部"} · {detailRows.length} 行明细{serviceCoverageNote(range, detailRows)}</span>
          {!rangeStrict && <span className="pb-precomputed-badge" title="2026-06-29 前的旧结构无原子分子分母，三个比率展示平台预制口径">预置口径</span>}
          {selectedAgent && <button className="pb-selected-agent-chip" onClick={() => setSelectedAgent(null)} type="button">已筛选：{selectedName} ✕</button>}
        </div>
        <section className="pb-panel-title">整体客服数据 <small>{selectedAgent ? `已联动客服：${selectedName}` : "全局范围"} · 较上期环比</small></section>
        <ServiceKpiGrid previousRows={kpiPrevRows} rows={kpiRows} strict={rangeStrict} tiles={selectedAgent ? agentTiles : overallTiles} />
        <section className="pb-panel-title is-spaced">客服明细数据 <small>{selectedAgent ? `仅显示 ${selectedName}` : "全局范围 × 客服"} · 点击行联动卡片与趋势</small></section>
        <div className="pb-table-wrap pb-animated-table">
          <table className="pb-data-table pb-service-table" data-testid="tmall-service-agent-table">
            <thead><tr>
              <SortHeader columnKey="agent" label="客服" sort={sort} />
              <SortHeader columnKey="groupName" label="分组" sort={sort} />
              <SortHeader columnKey="effectiveReceived" label="有效接待" sort={sort} />
              <SortHeader columnKey="netSalesWan" label="净销售额(万)" sort={sort} />
              <SortHeader columnKey="firstResponse" label="首次响应" sort={sort} />
              <SortHeader columnKey="answerRatio" label="答问比" sort={sort} />
              <SortHeader columnKey="avgResponse" label="平均响应" sort={sort} />
              <SortHeader columnKey="unitPrice" label="客单价" sort={sort} />
              <SortHeader columnKey="inquiryConvRate" label="询单转化率" sort={sort} />
              <SortHeader columnKey="satisfactionRate" label="满意率" sort={sort} />
            </tr></thead>
            <tbody>
              {agentPagination.pagedItems.map((row, index) => (
                <tr className={clsx("pb-table-row", row.agent === selectedAgent && "is-selected")} key={row.agent} onClick={() => setSelectedAgent(selectedAgent === row.agent ? null : row.agent)} style={{ "--pb-row-delay": `${180 + Math.min(index, 12) * 28}ms` } as CSSProperties}>
                  <td className="pb-row-label"><span title={row.agent}>{row.agent}</span></td>
                  <td>{row.groupName || "—"}</td>
                  <td>{countFormat.format(row.effectiveReceived ?? 0)}</td>
                  <td>{moneyPreciseFormat.format(row.netSalesWan ?? 0)}</td>
                  <td>{(row.firstResponse ?? 0).toFixed(1)}s</td>
                  <td>{(row.answerRatio ?? 0).toFixed(2)}</td>
                  <td>{(row.avgResponse ?? 0).toFixed(1)}s</td>
                  <td>¥{moneyFormat.format(row.unitPrice ?? 0)}</td>
                  <td>{percent(row.inquiryConvRate ?? 0)}</td>
                  <td>{row.satisfactionRate == null ? "—" : percent(row.satisfactionRate)}</td>
                </tr>
              ))}
              {!tableRows.length && <tr className="pb-table-row"><td colSpan={10}>当前范围内暂无客服明细</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination onPage={agentPagination.setPage} page={agentPagination.page} totalItems={agentPagination.totalItems} totalPages={agentPagination.totalPages} />
        <section className="pb-panel-title is-spaced">服务维度数据 <small>响应时效与问答质量 · 较上期环比</small></section>
        <ServiceKpiGrid previousRows={kpiPrevRows} rows={kpiRows} strict={rangeStrict} tiles={serviceTiles} />
        <section className="pb-panel-title is-spaced">每日趋势 <small>{selectedAgent ? `${selectedName} · 有效接待(左轴) · 净销售额万与询单转化率(右轴)` : "有效接待(左轴) · 净销售额万与询单转化率(右轴)"}</small></section>
        <CustomerServiceTrendChart
          rows={trendRows as unknown as ServiceMetricRow[]}
          leftSeries={[{ key: "effectiveReceived", label: "有效接待人数", color: "rgba(76, 190, 182, 0.85)", tooltipFormat: (value) => countFormat.format(value) }]}
          rightSeries={selectedAgent ? [
            { key: "netSalesWan", label: "净销售额(万)", color: "rgba(214, 69, 80, 0.85)", scaleValue: (value) => value, tooltipFormat: (value) => `${value.toFixed(1)}万` },
            { key: "inquiryConvRate", label: "询单转化率", color: "rgba(222, 168, 92, 0.9)", scaleValue: (value) => value * 100, tooltipFormat: (value) => percent(value) },
          ] : [
            { key: "netSales", label: "净销售额(万)", color: "rgba(214, 69, 80, 0.85)", scaleValue: (value) => value / 10000, tooltipFormat: (value) => `${(value / 10000).toFixed(1)}万` },
            { key: "inquiryConversionRate", label: "询单转化率", color: "rgba(222, 168, 92, 0.9)", scaleValue: (value) => value * 100, tooltipFormat: (value) => percent(value) },
          ]}
        />
        {spend > 0 && <p className="pb-source-bar">选中客服 {selectedName} 净销售额合计约 {moneyPreciseFormat.format(spend)} 万</p>}
      </main>
    </div>
  );
}

function JdServicePage({ cs, range }: { cs: PowerBiCustomerService; range: { start: string; end: string } | null }) {
  const jd = cs.jd ?? { daily: [], serviceDaily: [], byAgent: [], groups: [] };
  const inRange = (value: string) => !range || (value >= range.start && value <= range.end);
  const [store, setStore] = useState("全部");
  // 新快照 daily 每店一行 + '全部' rollup 行；旧快照无 store 字段时按原口径整体渲染（hasStoreDimension=false）
  const hasStoreDimension = jd.daily.some((row) => row.store) || jd.byAgent.some((row) => row.store);
  const storeOptions = ["全部", ...new Set(jd.daily.map((row) => row.store).filter((value): value is string => Boolean(value) && value !== "全部"))].sort();
  const dailyStoreMatch = (row: { store?: string }) =>
    !hasStoreDimension ? true : store === "全部" ? row.store === "全部" : row.store === store;
  const agentStoreMatch = (row: { store?: string }) =>
    !hasStoreDimension || store === "全部" ? true : row.store === store;
  const allDaily = [...jd.daily].sort((a, b) => a.date.localeCompare(b.date));
  const daily = allDaily.filter((row) => inRange(row.date) && dailyStoreMatch(row));
  const allServiceDaily = [...jd.serviceDaily].sort((a, b) => a.date.localeCompare(b.date));
  const serviceDaily = allServiceDaily.filter((row) => inRange(row.date) && dailyStoreMatch(row));
  const prevRange = previousRangeFor(range);
  const prevDaily = range && prevRange ? allDaily.filter((row) => row.date >= prevRange.start && row.date <= prevRange.end && dailyStoreMatch(row)) : [];
  const prevServiceDaily = range && prevRange ? allServiceDaily.filter((row) => row.date >= prevRange.start && row.date <= prevRange.end && dailyStoreMatch(row)) : [];
  const [group, setGroup] = useState("全部");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const sort = useColumnSort("received");
  const detailRows = jd.byAgent.filter((row) => inRange(row.date) && agentStoreMatch(row) && (group === "全部" || row.skillGroup === group));
  const selectedRows = selectedAgent ? detailRows.filter((row) => row.agent === selectedAgent) : [];
  // 表格恒为「范围内按客服聚合」（每客服一行，无日期列），点击行联动卡片与趋势
  const aggregatedRows = aggregateAgentRows(detailRows, [
    { key: "received", aggregate: "sum" },
    { key: "orderAmount", aggregate: "sum" },
    { key: "firstResponse", aggregate: "avgOrNull" },
    { key: "avgResponse", aggregate: "avgOrNull" },
    { key: "answerRatio", aggregate: "avgOrNull" },
    { key: "conversionRate", aggregate: "avg" },
    { key: "goodReviews", aggregate: "sum" },
    { key: "badReviews", aggregate: "sum" },
  ]);
  const tableRows = sortRows(aggregatedRows, sort.sortKey, sort.sortDir, {
    agent: (row) => row.agent,
    skillGroup: (row) => row.skillGroup ?? null,
    received: (row) => row.received ?? null,
    orderAmount: (row) => row.orderAmount ?? null,
    firstResponse: (row) => row.firstResponse ?? null,
    avgResponse: (row) => row.avgResponse ?? null,
    answerRatio: (row) => row.answerRatio ?? null,
    conversionRate: (row) => row.conversionRate ?? null,
    goodReviews: (row) => row.goodReviews ?? null,
    badReviews: (row) => row.badReviews ?? null,
  });
  const agentPagination = usePagination(tableRows, `${selectedAgent ?? "all"}-${store}-${group}-${range?.start}-${range?.end}-${sort.sortKey}-${sort.sortDir}`, 10);
  // 选中客服失效时自动清除（改分组/全局日期后该客服可能不在当前明细集内）
  useEffect(() => {
    if (selectedAgent && !detailRows.some((row) => row.agent === selectedAgent)) setSelectedAgent(null);
  }, [selectedAgent, detailRows]);
  const prevAgentRows = selectedAgent
    ? jd.byAgent.filter((row) => row.agent === selectedAgent && agentStoreMatch(row) && prevRange && row.date >= prevRange.start && row.date <= prevRange.end)
    : [];
  if (!cs.jd) return null;
  if (!daily.length) return <div className="pb-empty">当前日期范围内无京东客服数据，请调整日期筛选。</div>;
  const trendRows = selectedAgent ? [...selectedRows].sort((a, b) => a.date.localeCompare(b.date)) : daily;
  const kpiRows = selectedAgent ? selectedRows : daily;
  const kpiPrevRows = selectedAgent ? prevAgentRows : prevDaily;
  const serviceRows = selectedAgent ? selectedRows : serviceDaily;
  const servicePrevRows = selectedAgent ? prevAgentRows : prevServiceDaily;
  const overallTiles: ServiceKpiTile[] = [
    { label: "接待量", key: "received", aggregate: "sum", format: (value) => countFormat.format(value), note: "范围内合计" },
    { label: "首次平均响应", key: "firstResponse", aggregate: "avgOrNull", format: (value) => `${value.toFixed(1)}s`, note: "每日平均" },
    { label: "30s应答率", key: "response30s", aggregate: "avgOrNull", format: (value) => percent(value), note: "每日平均" },
    { label: "促成下单金额", key: "orderAmount", aggregate: "sum", format: (value) => `${moneyPreciseFormat.format(value / 10000)} 万`, note: "万元" },
    { label: "客单价(客服)", key: "unitPrice", aggregate: "avg", format: (value) => `¥${moneyFormat.format(value)}`, note: "促成金额 / 促成人数" },
    { label: "转化率", key: "conversionRate", aggregate: "avg", format: (value) => percent(value), note: "促成下单 / 售前接待 · 每日平均" },
  ];
  const agentTiles: ServiceKpiTile[] = [
    { label: "接待量", key: "received", aggregate: "sum", format: (value) => countFormat.format(value), note: "范围内合计" },
    { label: "促成下单金额", key: "orderAmount", aggregate: "sum", format: (value) => `${moneyPreciseFormat.format(value / 10000)} 万`, note: "万元" },
    { label: "客单价(客服)", key: "unitPrice", aggregate: "avg", format: (value) => `¥${moneyFormat.format(value)}`, note: "促成金额 / 促成人数" },
    { label: "转化率", key: "conversionRate", aggregate: "avg", format: (value) => percent(value), note: "促成下单 / 售前接待 · 每日平均" },
    { label: "好评量", key: "goodReviews", aggregate: "sum", format: (value) => countFormat.format(value) },
    { label: "差评量", key: "badReviews", aggregate: "sum", format: (value) => countFormat.format(value) },
  ];
  const serviceTiles: ServiceKpiTile[] = [
    { label: "好评量", key: "goodReviews", aggregate: "sum", format: (value) => countFormat.format(value) },
    { label: "差评量", key: "badReviews", aggregate: "sum", format: (value) => countFormat.format(value) },
    { label: "京东答问比", key: "answerRatio", aggregate: "avgOrNull", format: (value) => value.toFixed(2), note: "客服消息 / 客户消息 · 每日平均" },
  ];
  const selectedName = selectedAgent ?? "";
  return (
    <div className="pb-detail-layout" data-search-anchor="analytics-jd-service">
      <main>
        <div className="pb-service-controls">
          {hasStoreDimension && (
            <label><span>店铺</span><select aria-label="筛选店铺" onChange={(event) => { setStore(event.target.value); setSelectedAgent(null); }} value={store}>
              {storeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select></label>
          )}
          <label><span>技能组</span><select aria-label="筛选技能组" onChange={(event) => setGroup(event.target.value)} value={group}>
            <option value="全部">全部</option>
            {jd.groups.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <span className="pb-follow-global-date">全局日期 {range ? `${range.start} 至 ${range.end}` : "全部"} · {detailRows.length} 行明细{serviceCoverageNote(range, detailRows)}</span>
          {selectedAgent && <button className="pb-selected-agent-chip" onClick={() => setSelectedAgent(null)} type="button">已筛选：{selectedName} ✕</button>}
        </div>
        <section className="pb-panel-title">整体客服数据 <small>{selectedAgent ? `已联动客服：${selectedName}` : "全局范围"} · 较上期环比</small></section>
        <ServiceKpiGrid previousRows={kpiPrevRows} rows={kpiRows} tiles={selectedAgent ? agentTiles : overallTiles} />
        <section className="pb-panel-title is-spaced">客服明细数据 <small>{selectedAgent ? `仅显示 ${selectedName}` : "全局范围 × 客服"} · 点击行联动卡片与趋势</small></section>
        <div className="pb-table-wrap pb-animated-table">
          <table className="pb-data-table pb-service-table" data-testid="jd-service-agent-table">
            <thead><tr>
              <SortHeader columnKey="agent" label="客服" sort={sort} />
              <SortHeader columnKey="skillGroup" label="技能组" sort={sort} />
              <SortHeader columnKey="received" label="接待量" sort={sort} />
              <SortHeader columnKey="orderAmount" label="促成金额(万)" sort={sort} />
              <SortHeader columnKey="firstResponse" label="首次响应" sort={sort} />
              <SortHeader columnKey="avgResponse" label="平均响应" sort={sort} />
              <SortHeader columnKey="answerRatio" label="答问比" sort={sort} />
              <SortHeader columnKey="conversionRate" label="转化率" sort={sort} />
              <SortHeader columnKey="goodReviews" label="好评量" sort={sort} />
              <SortHeader columnKey="badReviews" label="差评量" sort={sort} />
            </tr></thead>
            <tbody>
              {agentPagination.pagedItems.map((row, index) => (
                <tr className={clsx("pb-table-row", row.agent === selectedAgent && "is-selected")} key={row.agent} onClick={() => setSelectedAgent(selectedAgent === row.agent ? null : row.agent)} style={{ "--pb-row-delay": `${180 + Math.min(index, 12) * 28}ms` } as CSSProperties}>
                  <td className="pb-row-label"><span title={row.agent}>{row.agent}</span></td>
                  <td>{row.skillGroup || "—"}</td>
                  <td>{countFormat.format(row.received ?? 0)}</td>
                  <td>{moneyPreciseFormat.format((row.orderAmount ?? 0) / 10000)}</td>
                  <td>{row.firstResponse == null ? "—" : `${row.firstResponse.toFixed(1)}s`}</td>
                  <td>{row.avgResponse == null ? "—" : `${row.avgResponse.toFixed(1)}s`}</td>
                  <td>{row.answerRatio == null ? "—" : row.answerRatio.toFixed(2)}</td>
                  <td>{percent(row.conversionRate ?? 0)}</td>
                  <td>{countFormat.format(row.goodReviews ?? 0)}</td>
                  <td>{countFormat.format(row.badReviews ?? 0)}</td>
                </tr>
              ))}
              {!tableRows.length && <tr className="pb-table-row"><td colSpan={10}>当前范围内暂无客服明细</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination onPage={agentPagination.setPage} page={agentPagination.page} totalItems={agentPagination.totalItems} totalPages={agentPagination.totalPages} />
        <section className="pb-panel-title is-spaced">服务维度数据 <small>评价与消息比 · 较上期环比</small></section>
        <ServiceKpiGrid previousRows={servicePrevRows} rows={serviceRows} tiles={serviceTiles} />
        <section className="pb-panel-title is-spaced">每日趋势 <small>{selectedAgent ? `${selectedName} · 接待量(左轴) · 促成金额万与转化率(右轴)` : "接待量(左轴) · 促成金额万与转化率(右轴)"}</small></section>
        <CustomerServiceTrendChart
          rows={trendRows as unknown as ServiceMetricRow[]}
          leftSeries={[{ key: "received", label: "接待量", color: "rgba(76, 190, 182, 0.85)", tooltipFormat: (value) => countFormat.format(value) }]}
          rightSeries={[
            { key: "orderAmount", label: "促成金额(万)", color: "rgba(214, 69, 80, 0.85)", scaleValue: (value) => value / 10000, tooltipFormat: (value) => `${(value / 10000).toFixed(1)}万` },
            { key: "conversionRate", label: "转化率", color: "rgba(222, 168, 92, 0.9)", scaleValue: (value) => value * 100, tooltipFormat: (value) => percent(value) },
          ]}
        />
      </main>
    </div>
  );
}

// 全局筛选后如实标注客服明细的实际覆盖日期：三源最新数据日常不一致（如抖音 T-1 领先一天），
// 筛选区间尾端可能无数据，只显示筛选区间会误导（2026-09-12 运营反馈）。
function serviceCoverageNote(range: { start: string; end: string } | null, rows: Array<{ date?: string }>): string {
  if (!range) return "";
  let min: string | null = null;
  let max: string | null = null;
  for (const row of rows) {
    if (!row.date) continue;
    if (!min || row.date < min) min = row.date;
    if (!max || row.date > max) max = row.date;
  }
  if (!min || !max) return "";
  return min > range.start || max < range.end ? ` · 实际数据 ${min} 至 ${max}` : "";
}

function servicePeriodRange(csPeriod: { start: string; end: string } | null, globalPeriod?: DatePeriod | null): { start: string; end: string } | null {
  if (!csPeriod) return null;
  if (!globalPeriod?.start || !globalPeriod?.end) return csPeriod;
  const start = globalPeriod.start > csPeriod.start ? globalPeriod.start : csPeriod.start;
  const end = globalPeriod.end < csPeriod.end ? globalPeriod.end : csPeriod.end;
  return start <= end ? { start, end } : null;
}

type PowerBiCoverageSourceKey = "base" | "product" | "promotion";

const COVERAGE_SOURCE_LABELS: Array<[PowerBiCoverageSourceKey, string]> = [
  ["base", "店铺基础"],
  ["product", "商品销售"],
  ["promotion", "推广花费"],
];

// 把按需重算返回的 coverage 转成一句缺口说明：只列出与所选区间有差异的来源表，
// 全部覆盖时返回「数仓覆盖完整」，让标签能区分「筛选了但没数据」与「数据齐全」。
function coverageSummary(coverage: PowerBiPages["coverage"], start: string, end: string) {
  if (!coverage) return "";
  const notes: string[] = [];
  for (const [key, label] of COVERAGE_SOURCE_LABELS) {
    const entry = coverage[key];
    if (!entry || !entry.days) {
      notes.push(`${label}无数据`);
      continue;
    }
    const parts: string[] = [];
    if (entry.min && entry.min > start) parts.push(`自 ${entry.min} 起`);
    if (entry.max && entry.max < end) parts.push(`截至 ${entry.max}`);
    if (entry.missingDays > 0) parts.push(`缺 ${entry.missingDays} 天`);
    if (parts.length) notes.push(`${label}${parts.join("、")}`);
  }
  return notes.length ? `数仓缺口：${notes.join("；")}` : "数仓覆盖完整";
}

function DouyinServicePage({ cs, range }: { cs: PowerBiCustomerService; range: { start: string; end: string } | null }) {
  const douyin = cs.douyin ?? { daily: [], byAgent: [], groups: [] };
  const inRange = (value: string) => !range || (value >= range.start && value <= range.end);
  const allDaily = [...douyin.daily].sort((a, b) => a.date.localeCompare(b.date));
  const daily = allDaily.filter((row) => inRange(row.date));
  const prevRange = previousRangeFor(range);
  const prevDaily = range && prevRange ? allDaily.filter((row) => row.date >= prevRange.start && row.date <= prevRange.end) : [];
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const sort = useColumnSort("received");
  const detailRows = douyin.byAgent.filter((row) => inRange(row.date));
  const selectedRows = selectedAgent ? detailRows.filter((row) => row.agent === selectedAgent) : [];
  // 表格恒为「范围内按客服聚合」（每客服一行，无日期列），点击行联动卡片与趋势；
  // 询单转化率按 SUM(支付人数)/SUM(询单人数) 重算，与后端 daily 口径一致
  const aggregatedRows = aggregateAgentRows(detailRows, [
    { key: "received", aggregate: "sum" },
    { key: "onlineSeconds", aggregate: "sum" },
    { key: "netSales", aggregate: "sum" },
    { key: "netSalesWan", aggregate: "sum" },
    { key: "inquiryCount", aggregate: "sum" },
    { key: "payCount", aggregate: "sum" },
    { key: "evalCount", aggregate: "sum" },
    { key: "firstResponse", aggregate: "avg" },
    { key: "avgResponse", aggregate: "avg" },
    { key: "satisfactionRate", aggregate: "weightedAverage", weightKey: "evalCount" },
  ])
    .map((row) => ({ ...row, inquiryConvRate: row.inquiryCount ? (row.payCount ?? 0) / row.inquiryCount : null }));
  const tableRows = sortRows(aggregatedRows, sort.sortKey, sort.sortDir, {
    agent: (row) => row.agent,
    onlineSeconds: (row) => row.onlineSeconds ?? null,
    received: (row) => row.received ?? null,
    avgResponse: (row) => row.avgResponse ?? null,
    inquiryConvRate: (row) => row.inquiryConvRate ?? null,
    netSalesWan: (row) => row.netSalesWan ?? null,
    satisfactionRate: (row) => row.satisfactionRate ?? null,
  });
  const agentPagination = usePagination(tableRows, `${selectedAgent ?? "all"}-${range?.start}-${range?.end}-${sort.sortKey}-${sort.sortDir}`, 10);
  // 选中客服失效时自动清除（改全局日期后该客服可能不在当前明细集内）
  useEffect(() => {
    if (selectedAgent && !detailRows.some((row) => row.agent === selectedAgent)) setSelectedAgent(null);
  }, [selectedAgent, detailRows]);
  const prevAgentRows = selectedAgent
    ? douyin.byAgent.filter((row) => row.agent === selectedAgent && prevRange && row.date >= prevRange.start && row.date <= prevRange.end)
    : [];
  if (!cs.douyin) return null;
  if (!daily.length) return <div className="pb-empty">当前日期范围内无抖音客服数据，请调整日期筛选。</div>;
  const trendRows = selectedAgent ? [...selectedRows].sort((a, b) => a.date.localeCompare(b.date)) : daily;
  const kpiRows = selectedAgent ? selectedRows : daily;
  const kpiPrevRows = selectedAgent ? prevAgentRows : prevDaily;
  const onlineHours = (seconds: number) => `${(seconds / 3600).toFixed(1)}h`;
  const overallTiles: ServiceKpiTile[] = [
    { label: "在线客服数", key: "agentCount", aggregate: "avg", format: (value) => countFormat.format(Math.round(value)), note: "日均在线" },
    { label: "接待会话量", key: "received", aggregate: "sum", format: (value) => countFormat.format(value), note: "范围内合计" },
    { label: "净销售额", key: "netSales", aggregate: "sum", format: (value) => `${moneyPreciseFormat.format(value / 10000)} 万`, note: "万元 · 已扣退款" },
    { label: "询单转化率", key: "inquiryConvRate", aggregate: "avg", format: (value) => percent(value), note: "支付人数/询单人数 · 每日平均" },
    { label: "全天满意率", key: "satisfactionRate", aggregate: "avgOrNull", format: (value) => percent(value), note: "按有效评价加权 · 每日平均" },
    { label: "平均响应时长", key: "avgResponse", aggregate: "avg", format: (value) => `${value.toFixed(1)}s`, note: "工作时间平响 · 每日平均" },
  ];
  const agentTiles: ServiceKpiTile[] = [
    { label: "接待会话量", key: "received", aggregate: "sum", format: (value) => countFormat.format(value), note: "范围内合计" },
    { label: "在线时长", key: "onlineSeconds", aggregate: "sum", format: onlineHours, note: "范围内合计" },
    { label: "净销售额", key: "netSalesWan", aggregate: "sum", format: (value) => `${moneyPreciseFormat.format(value)} 万`, note: "万元 · 已扣退款" },
    { label: "询单转化率", key: "inquiryConvRate", aggregate: "avg", format: (value) => percent(value), note: "每日平均" },
    { label: "全天满意率", key: "satisfactionRate", aggregate: "avgOrNull", format: (value) => percent(value), note: "每日平均" },
    { label: "平均响应时长", key: "avgResponse", aggregate: "avg", format: (value) => `${value.toFixed(1)}s`, note: "工作时间平响 · 每日平均" },
  ];
  const selectedName = selectedAgent ?? "";
  return (
    <div className="pb-detail-layout" data-search-anchor="analytics-douyin-service">
      <main>
        <div className="pb-service-controls">
          <span className="pb-follow-global-date">全局日期 {range ? `${range.start} 至 ${range.end}` : "全部"} · {detailRows.length} 行明细{serviceCoverageNote(range, detailRows)}</span>
          {selectedAgent && <button className="pb-selected-agent-chip" onClick={() => setSelectedAgent(null)} type="button">已筛选：{selectedName} ✕</button>}
        </div>
        <section className="pb-panel-title">整体客服数据 <small>{selectedAgent ? `已联动客服：${selectedName}` : "全局范围"} · 较上期环比</small></section>
        <ServiceKpiGrid previousRows={kpiPrevRows} rows={kpiRows} tiles={selectedAgent ? agentTiles : overallTiles} />
        <section className="pb-panel-title is-spaced">客服明细数据 <small>{selectedAgent ? `仅显示 ${selectedName}` : "全局范围 × 客服"} · 点击行联动卡片与趋势</small></section>
        <div className="pb-table-wrap pb-animated-table">
          <table className="pb-data-table pb-service-table" data-testid="douyin-service-agent-table">
            <thead><tr>
              <SortHeader columnKey="agent" label="客服" sort={sort} />
              <SortHeader columnKey="onlineSeconds" label="在线时长" sort={sort} />
              <SortHeader columnKey="received" label="接待会话量" sort={sort} />
              <SortHeader columnKey="avgResponse" label="平均响应" sort={sort} />
              <SortHeader columnKey="inquiryConvRate" label="询单转化率" sort={sort} />
              <SortHeader columnKey="netSalesWan" label="净销售额(万)" sort={sort} />
              <SortHeader columnKey="satisfactionRate" label="全天满意率" sort={sort} />
            </tr></thead>
            <tbody>
              {agentPagination.pagedItems.map((row, index) => (
                <tr className={clsx("pb-table-row", row.agent === selectedAgent && "is-selected")} key={row.agent} onClick={() => setSelectedAgent(selectedAgent === row.agent ? null : row.agent)} style={{ "--pb-row-delay": `${180 + Math.min(index, 12) * 28}ms` } as CSSProperties}>
                  <td className="pb-row-label"><span title={row.agent}>{row.agent}</span></td>
                  <td>{onlineHours(row.onlineSeconds ?? 0)}</td>
                  <td>{countFormat.format(row.received ?? 0)}</td>
                  <td>{row.avgResponse == null ? "—" : `${row.avgResponse.toFixed(1)}s`}</td>
                  <td>{row.inquiryConvRate == null ? "—" : percent(row.inquiryConvRate)}</td>
                  <td>{moneyPreciseFormat.format(row.netSalesWan ?? 0)}</td>
                  <td>{row.satisfactionRate == null ? "—" : percent(row.satisfactionRate)}</td>
                </tr>
              ))}
              {!tableRows.length && <tr className="pb-table-row"><td colSpan={7}>当前范围内暂无客服明细</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination onPage={agentPagination.setPage} page={agentPagination.page} totalItems={agentPagination.totalItems} totalPages={agentPagination.totalPages} />
        <section className="pb-panel-title is-spaced">每日趋势 <small>{selectedAgent ? `${selectedName} · 接待会话量(左轴) · 净销售额万(右轴)` : "接待会话量(左轴) · 净销售额万与询单转化率(右轴)"}</small></section>
        <CustomerServiceTrendChart
          rows={trendRows as unknown as ServiceMetricRow[]}
          leftSeries={[{ key: "received", label: "接待会话量", color: "rgba(76, 190, 182, 0.85)", tooltipFormat: (value) => countFormat.format(value) }]}
          rightSeries={selectedAgent ? [
            { key: "netSalesWan", label: "净销售额(万)", color: "rgba(214, 69, 80, 0.85)", scaleValue: (value) => value, tooltipFormat: (value) => `${value.toFixed(1)}万` },
          ] : [
            { key: "netSales", label: "净销售额(万)", color: "rgba(214, 69, 80, 0.85)", scaleValue: (value) => value / 10000, tooltipFormat: (value) => `${(value / 10000).toFixed(1)}万` },
            { key: "inquiryConvRate", label: "询单转化率", color: "rgba(222, 168, 92, 0.9)", scaleValue: (value) => value * 100, tooltipFormat: (value) => percent(value) },
          ]}
        />
      </main>
    </div>
  );
}

export function CustomerServiceWorkspace({ pages, globalPeriod }: { pages: PowerBiPages; globalPeriod?: DatePeriod | null }) {
  const cs = pages.customerService;
  const [tab, setTab] = useState<"tmall" | "jd" | "douyin">("tmall");
  if (!cs?.period) return <div className="pb-empty">客服数据尚未生成，请先同步本地数仓。</div>;
  const range = servicePeriodRange(cs.period, globalPeriod);
  if (!range) return <div className="pb-empty">当前页面日期范围与客服数据范围没有交集，请调整日期筛选。</div>;
  return (
    <div className={clsx("pb-replica-canvas", "pb-tmall-detail-scale")}>
      <div className="pb-replica-toolbar">
        <nav>
          <button className={tab === "tmall" ? "is-active" : ""} key="tmall" onClick={() => setTab("tmall")} type="button"><Headphones size={14} />天猫每日客服</button>
          <button className={tab === "jd" ? "is-active" : ""} key="jd" onClick={() => setTab("jd")} type="button"><Headphones size={14} />京东每日客服</button>
          <button className={tab === "douyin" ? "is-active" : ""} key="douyin" onClick={() => setTab("douyin")} type="button"><Headphones size={14} />抖音每日客服</button>
        </nav>
        <span className="pb-follow-global-date">跟随页面日期：{range.start} 至 {range.end}</span>
      </div>
      {tab === "tmall" ? (cs.tmall?.daily.length ? <TmallServicePage cs={cs} range={range} /> : <div className="pb-empty">天猫客服数据为空</div>)
        : tab === "jd" ? (cs.jd?.daily.length ? <JdServicePage cs={cs} range={range} /> : <div className="pb-empty">京东客服数据为空</div>)
        : (cs.douyin?.daily.length ? <DouyinServicePage cs={cs} range={range} /> : <div className="pb-empty">抖音客服数据为空</div>)}
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
  const requested = globalPeriod ?? defaultPeriod;
  const withinSnapshot = Boolean(requested && pages.period && requested.start >= pages.period.start && requested.end <= pages.period.end);
  // 快照固定 60 天滚动窗口；全局筛选超出时走 /api/analytics/powerbi-pages 按需重算，
  // 失败（同步锁库/查询异常）时回退快照交集数据并在标签注明
  const [demand, setDemand] = useState<{ pages: PowerBiPages; start: string; end: string } | null>(null);
  const [demandState, setDemandState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [demandError, setDemandError] = useState<string | null>(null);
  useEffect(() => {
    if (!requested || withinSnapshot) {
      setDemandState("idle");
      return;
    }
    let cancelled = false;
    setDemandState("loading");
    getPowerbiPagesOnDemand({ start: requested.start, end: requested.end })
      .then((payload) => {
        if (cancelled) return;
        if (payload.powerbiPages) {
          setDemand({ pages: payload.powerbiPages, start: requested.start, end: requested.end });
          setDemandState("ok");
        } else {
          setDemand(null);
          setDemandState("error");
          setDemandError(payload.error ?? "按需重算失败");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDemand(null);
        setDemandState("error");
        setDemandError(error instanceof Error ? error.message : "按需重算失败");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested?.start, requested?.end, withinSnapshot, warehouse.refreshedAt]);
  const usingDemand = demandState === "ok" && demand !== null && demand.start === requested?.start && demand.end === requested?.end;
  const activePages = usingDemand ? demand.pages : pages;
  const period = useMemo(() => {
    if (!pages.period) return null;
    if (!requested) return null;
    // 按需重算成功：版面区间 = 全局筛选区间，不再向快照窗口钳制
    if (usingDemand) return { start: demand.start, end: demand.end };
    const start = requested.start > pages.period.start ? requested.start : pages.period.start;
    const end = requested.end < pages.period.end ? requested.end : pages.period.end;
    return start <= end ? { start, end } : null;
  }, [demand, pages.period, requested, usingDemand]);
  // 每天核心数据日行点选：在整个天猫明细页范围内叠加单日筛选，不改变全局日期控件
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  useEffect(() => {
    setSelectedDate(null);
  }, [period?.start, period?.end]);
  if (!pages.period) return <div className="pb-empty">本地 PowerBI 独有数据尚未生成，请先同步本地数仓。</div>;
  if (!period) return <div className="pb-empty">当前页面日期范围与 PowerBI 本地数据范围没有交集，请调整日期筛选。</div>;
  const followLabel = usingDemand
    ? `跟随页面日期：${period.start} 至 ${period.end} · ${coverageSummary(demand.pages.coverage, period.start, period.end)}`
    : demandState === "loading"
      ? `按需重算中：${requested?.start} 至 ${requested?.end}…（约 20-70 秒，当前暂显示快照窗口 ${period.start} 至 ${period.end}）`
      : demandState === "error"
        ? `按需重算暂不可用${demandError ? `（${demandError}）` : ""}，当前显示快照窗口 ${period.start} 至 ${period.end}`
        : `跟随页面日期：${period.start} 至 ${period.end}`;
  return (
    <div className={clsx("pb-replica-canvas", "pb-tmall-detail-scale", `is-page-${page}`)}>
      <div className="pb-replica-toolbar">
        <nav>{([{ id: "overall", label: "旗舰店整体", icon: BarChart3 }, { id: "promotion", label: "推广费用明细", icon: Table2 }, { id: "product", label: "商品推广费用", icon: Database }, { id: "competitor", label: "竞品推广数据", icon: TrendingUp }] as const).map((item) => <button className={page === item.id ? "is-active" : ""} key={item.id} onClick={() => setPage(item.id)} type="button"><item.icon size={14} />{item.label}</button>)}</nav>
        {page !== "competitor" && <span className="pb-follow-global-date">{followLabel}</span>}
        {selectedDate && <button className="pb-selected-agent-chip" onClick={() => setSelectedDate(null)} type="button">已选日期：{selectedDate} ✕</button>}
      </div>
      {page === "overall" ? <OverallPage end={period.end} onSelectDate={setSelectedDate} pages={activePages} selectedDate={selectedDate} start={period.start} /> : page === "promotion" ? <PromotionPage end={period.end} onSelectDate={setSelectedDate} pages={activePages} selectedDate={selectedDate} start={period.start} /> : page === "product" ? <ProductPromotionPage end={period.end} onSelectDate={setSelectedDate} pages={activePages} selectedDate={selectedDate} start={period.start} /> : <CompetitorPage pages={activePages} refreshedAt={warehouse.refreshedAt} />}
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
