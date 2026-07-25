import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Filter, RefreshCw, Store, X } from "lucide-react";
import { AnalyticsDateFilter } from "../components/AnalyticsDateFilter";
import { Card } from "../components/Card";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { SortableTable } from "../components/SortableTable";
import { StatusTag } from "../components/StatusTag";
import { TableShell } from "../components/TableShell";
import { Tabs } from "../components/Tabs";
import { getProductData, syncDataSource } from "../services/localApi";
import type { KpiMetric } from "../types";
import type { ProductManagementPages, ProductMatrix, ProductMonthlyComparison, ProductReturnDimensionBreakdownItem } from "../types/integration";
import { CustomizationStructurePanel } from "../components/product-management/CustomizationStructurePanel";
import { PriceStructurePanel } from "../components/product-management/PriceStructurePanel";
import { SizeStructurePanel } from "../components/product-management/SizeStructurePanel";
import { SpuSalesTrendPanel } from "../components/product-management/SpuSalesTrendPanel";
import { DailyTrendChart } from "../components/product-management/DailyTrendChart";

interface DateRange {
  start: string;
  end: string;
}

interface ProductManagementPageProps {
  onAction: (title: string, detail?: string) => void;
}

type ProductTab = "overview" | "trend" | "returns" | "channel" | "daily" | "fulfillment" | "price" | "size" | "spu" | "custom";

const compactNumber = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const currencyNumber = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  notation: "compact",
  maximumFractionDigits: 2,
});

function money(value: number | null | undefined) {
  return currencyNumber.format(value || 0);
}

function count(value: number | null | undefined) {
  return compactNumber.format(value || 0);
}

function percent(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function shippingDays(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(2).replace(/\.?0+$/, "")}天`;
}

function dateTime(value?: string | null) {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(value))
    .replaceAll("/", "-");
}

function buildKpis(pm: ProductManagementPages): KpiMetric[] {
  const k = pm.kpis as Record<string, number>;
  // 总毛利和毛利率只使用已匹配成本的商品。
  const marginTone = k.grossMargin !== null && k.grossMargin >= 0.5 ? "green" : "orange";
  return [
    { label: "净销售额", value: money(k.totalNetSales), detail: "销售金额 - 退货金额", tone: "green" },
    { label: "销售量", value: count(k.totalSalesUnits), detail: "销售数量合计", tone: "blue" },
    { label: "总毛利", value: k.totalGrossProfit !== null ? money(k.totalGrossProfit) : "-", detail: k.matchedProductCount ? `匹配 ${count(k.matchedProductCount)} 商品` : "未接入成本", tone: "purple" },
    { label: "毛利率", value: percent(k.grossMargin), detail: "总毛利 / 匹配行商家实收", tone: marginTone },
    { label: "件单价", value: k.avgUnitPrice ? `¥${count(k.avgUnitPrice)}` : "-", detail: "商家实收 / 销售数量", tone: "purple" },
    { label: "回款率", value: percent(k.collectionRate), detail: "商家实收 / 销售金额", tone: "green" },
    { label: "退货率", value: percent(k.refundRate), detail: "退货金额 / 商家实收", tone: "red" },
    { label: "商家实收", value: money(k.totalReceivedAmount), detail: "商家实际到账", tone: "orange" },
  ];
}

function TrendBar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-[var(--bg-3)]">
      <div className="h-full rounded bg-[var(--brand)]" style={{ width: `${width}%` }} />
    </div>
  );
}

function MatrixProgress({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const visualWidth = Math.max(0.75, ratio);
  return (
    <div className="matrix-progress" aria-label={`占全表最大销量 ${ratio.toFixed(1)}%`} title={`占全表最大销量 ${ratio.toFixed(1)}%`}>
      <div className="matrix-progress-fill" style={{ width: `${visualWidth}%` }} />
    </div>
  );
}

function MatrixTable({ matrix, rowHeader, minWidth }: { matrix: ProductMatrix; rowHeader: string; minWidth: number }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  if (!matrix.rows.length) {
    return (
      <TableShell minWidth={minWidth}>
        <tbody>
          <tr>
            <td className="py-6 text-center text-[var(--muted)]">暂无数据</td>
          </tr>
        </tbody>
      </TableShell>
    );
  }
  const sharedMax = Math.max(
    1,
    ...matrix.rows.flatMap((row) => matrix.columns.map((column) => row.values[column] || 0)),
  );
  function toggle(k: string) {
    if (sortKey === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setDir("asc"); }
  }
  const valueOf = (r: ProductMatrix["rows"][number], k: string) =>
    k === "rowKey" ? r.rowKey : k === "total" ? r.total : (r.values[k] || 0);
  const sorted = sortKey
    ? [...matrix.rows].sort((a, b) => {
        const av = valueOf(a, sortKey);
        const bv = valueOf(b, sortKey);
        if (av < bv) return dir === "asc" ? -1 : 1;
        if (av > bv) return dir === "asc" ? 1 : -1;
        return 0;
      })
    : matrix.rows;
  function Th({ k, children }: { k: string; children: ReactNode }) {
    const active = sortKey === k;
    const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th>
        <button className="th-sort" onClick={() => toggle(k)} type="button">
          <span>{children}</span>
          <Icon aria-hidden="true" className={active ? "th-sort-active" : "th-sort-idle"} size={12} strokeWidth={2} />
        </button>
      </th>
    );
  }
  return (
    <div className="matrix-table-wrap">
      <div className="matrix-scale-note" data-testid="matrix-shared-scale">
        <span>统一量尺</span>
        <span>进度条按全表最大单元格 {count(sharedMax)} 相对显示</span>
      </div>
      <TableShell minWidth={minWidth}>
        <thead>
          <tr>
            <Th k="rowKey">{rowHeader}</Th>
            {matrix.columns.map((col) => (<Th key={col} k={col}>{col}</Th>))}
            <Th k="total">总计</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr className="matrix-row" key={row.rowKey}>
              <td className="font-semibold">{row.rowKey}</td>
              {matrix.columns.map((col) => {
                const val = row.values[col] || 0;
                return (
                  <td className="matrix-value-cell" key={col}>
                    <span className={val > 0 ? "matrix-value" : "text-[var(--muted-2)]"}>{val > 0 ? count(val) : "-"}</span>
                    {val > 0 && <MatrixProgress value={val} max={sharedMax} />}
                  </td>
                );
              })}
              <td className="matrix-total-cell">{count(row.total)}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}

const COMPARISON_ROWS: Array<{ key: string; label: string; kind: "money" | "count" }> = [
  { key: "receivedAmount", label: "商家实收", kind: "money" },
  { key: "refundAmount", label: "退货金额", kind: "money" },
];

function MonthlyComparisonCard({ comparison }: { comparison: ProductMonthlyComparison }) {
  return (
    <Card title={`整体经营总览 · ${comparison.currentMonth} vs ${comparison.previousMonth ?? "-"}`}>
      <SortableTable
                  minWidth={720}
                  rowKey={(r) => r.key}
                  rows={COMPARISON_ROWS.map((r) => ({ ...r, cur: comparison.current[r.key] ?? 0, prev: comparison.previous[r.key] ?? 0, delta: comparison.deltas[r.key] ?? null }))}
                  columns={[
                    { key: "label", label: "指标", sortValue: (r) => r.label, render: (r) => <span className="font-semibold">{r.label}</span> },
                    { key: "cur", label: comparison.currentMonth, align: "right", sortValue: (r) => r.cur, render: (r) => <span className="text-[var(--green)]">{r.kind === "money" ? money(r.cur) : count(r.cur)}</span> },
                    { key: "prev", label: comparison.previousMonth ?? "上月", align: "right", sortValue: (r) => r.prev, render: (r) => <span className="text-[var(--muted)]">{comparison.previousMonth ? (r.kind === "money" ? money(r.prev) : count(r.prev)) : "-"}</span> },
                    { key: "delta", label: "环比", align: "right", sortValue: (r) => r.delta ?? -999, render: (r) => <StatusTag label={r.delta === null ? "-" : `${r.delta >= 0 ? "+" : ""}${(r.delta * 100).toFixed(1)}%`} tone={r.delta === null ? "muted" : r.delta >= 0 ? "green" : "red"} /> },
                  ]}
                />
    </Card>
  );
}

function ReturnBreakdownTable({
  title,
  rows,
  dimLabel,
  emptyHint,
}: {
  title: string;
  rows: ProductReturnDimensionBreakdownItem[];
  dimLabel: string;
  emptyHint?: string;
}) {
  return (
    <Card title={title} className="mt-4">
      <SortableTable
        minWidth={920}
        rowKey={(r) => r.dim}
        rows={rows}
        emptyHint={emptyHint}
        columns={[
          { key: "rank", label: "#", render: (_r, i) => <span className="text-[var(--muted)]">{i + 1}</span> },
          { key: "dim", label: dimLabel, sortValue: (r) => r.dim, render: (r) => <span className="font-semibold">{r.dim}</span> },
          { key: "refundAmount", label: "退货金额", align: "right", sortValue: (r) => r.refundAmount, render: (r) => <span className="font-semibold text-[var(--pink)]">{money(r.refundAmount)}</span> },
          { key: "refundUnits", label: "退货数量", align: "right", sortValue: (r) => r.refundUnits, render: (r) => count(r.refundUnits) },
          { key: "refundOrderCount", label: "退款订单数", align: "right", sortValue: (r) => r.refundOrderCount, render: (r) => count(r.refundOrderCount) },
          { key: "refundOrderShare", label: "退款订单占比", align: "right", sortValue: (r) => r.refundOrderShare ?? -1, render: (r) => <StatusTag label={percent(r.refundOrderShare, 1)} tone={r.refundOrderShare !== null && r.refundOrderShare >= 0.15 ? "red" : "muted"} /> },
          { key: "refundRate", label: "退货率", align: "right", sortValue: (r) => r.refundRate ?? 99, render: (r) => <StatusTag label={percent(r.refundRate)} tone={r.refundRate !== null && r.refundRate >= 0.1 ? "red" : "muted"} /> },
          { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.receivedAmount)}</span> },
                  ]}
      />
    </Card>
  );
}

function MultiValueSlicer({
  label,
  ariaLabel,
  options,
  selected,
  onApply,
  loading,
  kind = "filter",
}: {
  label: string;
  ariaLabel: string;
  options: string[];
  selected: string[];
  onApply: (values: string[]) => void;
  loading?: boolean;
  kind?: "filter" | "store";
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  useEffect(() => setDraft(selected), [selected, open]);
  const buttonLabel = selected.length === 0 ? `${label}：全部` : selected.length === 1 ? `${label}：${selected[0]}` : `${label}：${selected.length} 项`;
  const Icon = kind === "store" ? Store : Filter;
  function toggle(s: string) {
    setDraft((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }
  return (
    <div className="date-filter">
      <button aria-expanded={open} aria-label={ariaLabel} className="btn-select min-w-[170px]" onClick={() => setOpen((c) => !c)} type="button">
        <span className="flex items-center gap-2"><Icon aria-hidden="true" size={14} />{buttonLabel}</span>
        <ChevronDown aria-hidden="true" className={open ? "rotate-180" : ""} size={14} />
      </button>
      {open && (
        <div className="date-filter-panel" role="dialog" aria-label={ariaLabel}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold">{label}切片器</div>
            <button aria-label="关闭" className="icon-btn" onClick={() => setOpen(false)} type="button"><X size={15} /></button>
          </div>
          <div className="mt-3 flex flex-col gap-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={draft.length === 0} onChange={() => setDraft([])} /> 全部（不设筛选）
            </label>
            {options.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                <input type="checkbox" checked={draft.includes(s)} onChange={() => toggle(s)} /> {s}
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-end gap-3 border-t border-[var(--border)] pt-3">
            <button className="btn" onClick={() => setDraft(selected)} type="button">重置</button>
            <button className="btn-primary" disabled={loading} onClick={() => { onApply(draft); setOpen(false); }} type="button">{loading ? "更新中..." : "应用筛选"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProductManagementPage({ onAction }: ProductManagementPageProps) {
  const [pm, setPm] = useState<ProductManagementPages | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<ProductTab>("overview");
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [storeShortNames, setStoreShortNames] = useState<string[]>([]);
  const [fullPeriod, setFullPeriod] = useState<DateRange | null>(null);

  async function load(
    date: DateRange | null = null,
    newStatuses: string[] = statuses,
    newChannels: string[] = channels,
    newStoreShortNames: string[] = storeShortNames,
  ) {
    setLoading(true);
    setError("");
    try {
      const payload = await getProductData({
        start: date?.start,
        end: date?.end,
        statuses: newStatuses.length ? newStatuses : undefined,
        channels: newChannels.length ? newChannels : undefined,
        storeShortNames: newStoreShortNames.length ? newStoreShortNames : undefined,
      });
      setPm(payload.productManagement);
      setRefreshedAt(payload.refreshedAt);
      setDateRange(date);
      setStatuses(newStatuses);
      setChannels(newChannels);
      setStoreShortNames(newStoreShortNames);
      if (payload.productManagement?.period?.start && payload.productManagement?.period?.end) {
        const dataPeriod = {
          start: String(payload.productManagement.period.start).slice(0, 10),
          end: String(payload.productManagement.period.end).slice(0, 10),
        };
        // 仅在无任何筛选（全周期）时更新可选范围，避免维度筛选缩短日期控件范围。
        if (!date && newStatuses.length === 0 && newChannels.length === 0 && newStoreShortNames.length === 0) {
          setFullPeriod(dataPeriod);
        }
      }
      if (payload.status === "stale" && !payload.productManagement) {
        setError("商品数据尚未同步，点击右上角同步数仓生成看板。");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "商品数据读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function sync() {
    setSyncing(true);
    try {
      onAction("同步数仓", "正在读取聚水潭商品数据并刷新快照（约 1 分钟）");
      await syncDataSource("warehouse");
      await load(dateRange, statuses, channels, storeShortNames);
      onAction("同步完成", "商品管理看板已刷新");
    } catch (syncError) {
      onAction("同步失败", syncError instanceof Error ? syncError.message : "数仓同步出错");
    } finally {
      setSyncing(false);
    }
  }

  const period = pm?.period;
  const filterPeriod = dateRange ?? fullPeriod;
  const activeRangeLabel = dateRange ? `${dateRange.start} ~ ${dateRange.end}（已筛选）` : period ? `${period.start} ~ ${period.end}` : "尚未同步";
  const activeFilterCount = (dateRange ? 1 : 0) + statuses.length + channels.length + storeShortNames.length;

  return (
    <div>
      <PageHeader
        title="商品管理"
        subtitle={`商品销售、履约、退货与渠道分布；数据周期 ${activeRangeLabel}，最近刷新 ${dateTime(refreshedAt)}。`}
        actions={
          <div className="product-filter-toolbar" data-testid="product-operations-filter">
            <div className="product-filter-kicker">
              <span className="product-filter-status-dot" aria-hidden="true" />
              <span>运营筛选</span>
              <span className="product-filter-state">{activeFilterCount ? `已启用 ${activeFilterCount} 项` : "全量口径"}</span>
            </div>
            {fullPeriod && (
              <AnalyticsDateFilter
                available={fullPeriod}
                completedThrough={fullPeriod.end}
                loading={loading}
                period={filterPeriod ?? fullPeriod}
                onApply={(range) => void load(range, statuses, channels, storeShortNames)}
              />
            )}
            {pm && pm.availableStatuses.length > 0 && (
              <MultiValueSlicer
                ariaLabel="订单状态筛选"
                label="订单状态"
                options={pm.availableStatuses}
                selected={statuses}
                loading={loading}
                onApply={(values) => void load(dateRange, values, channels, storeShortNames)}
              />
            )}
            {pm && (pm.availableChannels ?? []).length > 0 && (
              <MultiValueSlicer
                ariaLabel="渠道平台筛选"
                label="渠道平台"
                options={pm.availableChannels ?? []}
                selected={channels}
                loading={loading}
                onApply={(values) => void load(dateRange, statuses, values, storeShortNames)}
              />
            )}
            {pm && (pm.availableStoreShortNames ?? []).length > 0 && (
              <MultiValueSlicer
                ariaLabel="店铺简称筛选"
                kind="store"
                label="店铺简称"
                options={pm.availableStoreShortNames ?? []}
                selected={storeShortNames}
                loading={loading}
                onApply={(values) => void load(dateRange, statuses, channels, values)}
              />
            )}
            {activeFilterCount > 0 && (
              <button
                className="btn"
                disabled={loading}
                onClick={() => void load(null, [], [], [])}
                title="清除日期、状态、渠道平台和店铺简称筛选"
                type="button"
              >
                <X className="mr-1 inline-block" size={13} strokeWidth={2} />
                重置
              </button>
            )}
            <button className="btn-primary" disabled={syncing || loading} onClick={sync} type="button">
              <RefreshCw className="mr-1.5 inline-block" size={14} strokeWidth={2} />
              {syncing ? "同步中" : "同步数仓"}
            </button>
          </div>
        }
      />

      {error && (
        <Card className="mb-4 border-[var(--orange)]">
          <div className="text-[13px] text-[var(--orange)]">{error}</div>
        </Card>
      )}

      {loading ? (
        <Card>
          <div className="py-10 text-center text-[13px] text-[var(--muted)]">正在读取商品数据…</div>
        </Card>
      ) : !pm ? (
        <Card>
          <div className="py-10 text-center text-[13px] text-[var(--muted)]">暂无商品数据。请点击右上角「同步数仓」。</div>
        </Card>
      ) : (
        <>
          <Tabs<ProductTab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "overview", label: "商品总览" },
              { id: "trend", label: "销售趋势" },
              { id: "returns", label: "退货分析" },
              { id: "channel", label: "渠道与达人" },
              { id: "daily", label: "每日订单分析" },
              { id: "fulfillment", label: "仓配履约" },
              { id: "price", label: "价格结构" },
              { id: "size", label: "尺寸结构" },
              { id: "spu", label: "SPU 销量" },
              { id: "custom", label: "定制结构" },
            ]}
          />

          {tab === "overview" && (
            <>
              <div className="metric-grid mb-5">
                {buildKpis(pm).map((metric) => (
                  <MetricCard key={metric.label} metric={metric} />
                ))}
              </div>
              <Card title="各渠道商家实收与金额占比" className="mb-4">
                {pm.channelBreakdown.length === 0 ? (
                  <div className="py-6 text-center text-[12px] text-[var(--muted)]">当前筛选条件下暂无渠道数据</div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {(() => {
                      const maxAmount = Math.max(...pm.channelBreakdown.map((x) => x.receivedAmount), 1);
                      return [...pm.channelBreakdown]
                        .sort((a, b) => b.receivedAmount - a.receivedAmount)
                        .map((c) => (
                          <div key={c.channel} className="grid grid-cols-[minmax(88px,140px)_1fr_auto] items-center gap-3">
                            <span className="truncate text-[13px] font-semibold" title={c.channel}>{c.channel}</span>
                            <TrendBar value={c.receivedAmount} max={maxAmount} />
                            <span className="whitespace-nowrap text-[13px] tabular-nums">
                              <span className="font-semibold text-[var(--green)]">{money(c.receivedAmount)}</span>
                              <span className="ml-2 text-[var(--muted)]">{percent(c.amountShare, 1)}</span>
                            </span>
                          </div>
                        ));
                    })()}
                  </div>
                )}
              </Card>
              {pm.monthlyComparison && (
                <div className="mb-4">
                  <MonthlyComparisonCard comparison={pm.monthlyComparison} />
                </div>
              )}
              <Card title="单品明细分析（按产品名称）">
                <SortableTable
                  minWidth={1080}
                  rowKey={(r) => r.productName}
                  rows={pm.productNameOverview}
                  columns={[
                    { key: "rank", label: "#", render: (_r, i) => <span className="text-[var(--muted)]">{i + 1}</span> },
                    { key: "productName", label: "产品名称", sortValue: (r) => r.productName, render: (r) => <span className="font-semibold">{r.productName}</span> },
                    { key: "salesUnits", label: "销量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
                    { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="font-semibold text-[var(--green)]">{money(r.receivedAmount)}</span> },
                    { key: "avgUnitPrice", label: "件单件", align: "right", sortValue: (r) => r.avgUnitPrice ?? -1, render: (r) => (r.avgUnitPrice ? `¥${count(r.avgUnitPrice)}` : "-") },
                    { key: "amountShare", label: "金额占比", align: "right", sortValue: (r) => r.amountShare, render: (r) => percent(r.amountShare, 1) },
                    { key: "grossMargin", label: "毛利率", align: "right", sortValue: (r) => r.grossMargin ?? -1, render: (r) => <StatusTag label={percent(r.grossMargin)} tone={r.grossMargin !== null && r.grossMargin >= 0.5 ? "green" : "muted"} /> },
                    { key: "refundAmount", label: "退货金额", align: "right", sortValue: (r) => r.refundAmount, render: (r) => <span className="text-[var(--pink)]">{money(r.refundAmount)}</span> },
                    { key: "refundRate", label: "退货率", align: "right", sortValue: (r) => r.refundRate ?? 99, render: (r) => <StatusTag label={percent(r.refundRate)} tone={r.refundRate !== null && r.refundRate >= 0.1 ? "red" : "muted"} /> },
                                      ]}
                />
              </Card>
              <Card title="渠道销售明细" className="mt-4">
                <SortableTable
                  minWidth={820}
                  rowKey={(r) => r.channel}
                  rows={pm.channelBreakdown}
                  columns={[
                    { key: "channel", label: "渠道平台", sortValue: (r) => r.channel, render: (r) => <span className="font-semibold">{r.channel}</span> },
                    { key: "salesUnits", label: "销量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
                    { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => money(r.receivedAmount) },
                    { key: "amountShare", label: "占比", align: "right", sortValue: (r) => r.amountShare, render: (r) => percent(r.amountShare, 1) },
                    { key: "avgUnitPrice", label: "件单件", align: "right", sortValue: (r) => r.avgUnitPrice ?? -1, render: (r) => (r.avgUnitPrice ? `¥${count(r.avgUnitPrice)}` : "-") },
                    { key: "grossMargin", label: "毛利率", align: "right", sortValue: (r) => r.grossMargin ?? -1, render: (r) => <StatusTag label={percent(r.grossMargin)} tone={r.grossMargin !== null && r.grossMargin >= 0.5 ? "green" : "muted"} /> },
                    { key: "refundAmount", label: "退货金额", align: "right", sortValue: (r) => r.refundAmount, render: (r) => <span className="text-[var(--pink)]">{money(r.refundAmount)}</span> },
                    { key: "refundRate", label: "退货率", align: "right", sortValue: (r) => r.refundRate ?? 99, render: (r) => <StatusTag label={percent(r.refundRate)} tone={r.refundRate !== null && r.refundRate >= 0.1 ? "red" : "muted"} /> },
                                      ]}
                />
              </Card>
              <Card title="床垫类别销售分析" className="mt-4">
                <SortableTable
                  minWidth={960}
                  rowKey={(r) => r.category}
                  rows={pm.mattressCategoryBreakdown}
                  emptyHint="产品主表未同步，无床垫类别数据"
                  columns={[
                    { key: "category", label: "床垫类别", sortValue: (r) => r.category, render: (r) => <span className="font-semibold">{r.category}</span> },
                    { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="font-semibold text-[var(--green)]">{money(r.receivedAmount)}</span> },
                    { key: "salesUnits", label: "销量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
                    { key: "amountShare", label: "金额占比", align: "right", sortValue: (r) => r.amountShare, render: (r) => percent(r.amountShare, 1) },
                    { key: "grossMargin", label: "毛利率", align: "right", sortValue: (r) => r.grossMargin ?? -1, render: (r) => <StatusTag label={percent(r.grossMargin)} tone={r.grossMargin !== null && r.grossMargin >= 0.6 ? "green" : "muted"} /> },
                    { key: "refundAmount", label: "退货金额", align: "right", sortValue: (r) => r.refundAmount, render: (r) => <span className="text-[var(--pink)]">{money(r.refundAmount)}</span> },
                    { key: "refundRate", label: "退货率", align: "right", sortValue: (r) => r.refundRate ?? 99, render: (r) => <StatusTag label={percent(r.refundRate)} tone={r.refundRate !== null && r.refundRate >= 0.1 ? "red" : "muted"} /> },
                                      ]}
                />
              </Card>
              <Card className="mt-4 border-[var(--orange)]">
                <div className="text-[12.5px] leading-relaxed text-[var(--muted)]">
                  <span className="font-semibold text-[var(--orange)]">毛利率说明：</span>
                  当前成本匹配覆盖 57.8% 的商品；未匹配商品显示“—”。
                </div>
              </Card>
              <Card title={`SKU 明细（按商品编码）· 快照 ${pm.productOverview.length} 条`} className="mt-4">
                <SortableTable
                  minWidth={1180}
                  rowKey={(r) => r.productCode}
                  rows={pm.productOverview}
                  columns={[
                    { key: "rank", label: "#", render: (_r, i) => <span className="text-[var(--muted)]">{i + 1}</span> },
                    { key: "productName", label: "产品名称", sortValue: (r) => r.productName || "", render: (r) => <span className="font-semibold">{r.productName || "-"}</span> },
                    { key: "productCode", label: "商品编码", sortValue: (r) => r.productCode, render: (r) => <span className="text-[var(--muted)]">{r.productCode}</span> },
                    { key: "category", label: "类目", sortValue: (r) => r.category || "", render: (r) => r.category || "-" },
                    { key: "salesUnits", label: "销售数量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
                    { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="font-semibold text-[var(--green)]">{money(r.receivedAmount)}</span> },
                    { key: "collectionRate", label: "回款率", align: "right", sortValue: (r) => r.collectionRate ?? -1, render: (r) => <StatusTag label={percent(r.collectionRate)} tone={r.collectionRate !== null && r.collectionRate >= 0.8 ? "green" : "orange"} /> },
                    { key: "refundAmount", label: "退货金额", align: "right", sortValue: (r) => r.refundAmount, render: (r) => <span className="text-[var(--pink)]">{money(r.refundAmount)}</span> },
                    { key: "refundRate", label: "退货率", align: "right", sortValue: (r) => r.refundRate ?? 99, render: (r) => <StatusTag label={percent(r.refundRate)} tone={r.refundRate !== null && r.refundRate >= 0.1 ? "red" : "muted"} /> },
                                      ]}
                />
              </Card>
            </>
          )}

          {tab === "trend" && (
            <>
              <Card title="月度商家实收趋势">
                <SortableTable
                  minWidth={620}
                  rowKey={(r) => r.month}
                  rows={pm.monthlyTrend}
                  defaultSortKey="month"
                  defaultSortDir="desc"
                  columns={[
                    { key: "month", label: "月份", sortValue: (r) => r.month, render: (r) => <span className="font-medium">{r.month}</span> },
                    { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="font-semibold text-[var(--green)]">{money(r.receivedAmount)}</span> },
                    { key: "salesUnits", label: "销量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
                    { key: "refundAmount", label: "退货金额", align: "right", sortValue: (r) => r.refundAmount, render: (r) => <span className="text-[var(--pink)]">{money(r.refundAmount)}</span> },
                                      ]}
                />
              </Card>
              <Card title="每日经营趋势 · 商家实收 / 退货金额 / 退款金额占比" className="mt-4">
                <DailyTrendChart
                  data={pm.dailyTrend.map((r) => ({
                    date: r.date,
                    receivedAmount: r.receivedAmount,
                    refundAmount: r.refundAmount,
                    refundRate: r.receivedAmount > 0 ? r.refundAmount / r.receivedAmount : 0,
                  }))}
                />
              </Card>
              <Card title="产品分类分布" className="mt-4">
                <SortableTable
                  minWidth={620}
                  rowKey={(r) => r.category}
                  rows={pm.categoryBreakdown}
                  columns={[
                    { key: "category", label: "产品分类", sortValue: (r) => r.category, render: (r) => <span className="font-semibold">{r.category}</span> },
                    { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.receivedAmount)}</span> },
                    { key: "salesUnits", label: "销量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
                    { key: "refundAmount", label: "退货金额", align: "right", sortValue: (r) => r.refundAmount, render: (r) => <span className="text-[var(--pink)]">{money(r.refundAmount)}</span> },
                                      ]}
                />
              </Card>
            </>
          )}

          {tab === "returns" && (
            <>
              <Card title="退货排名（按退货金额）· 定位高退货商品，结合回款与售后复盘">
                <SortableTable
                  minWidth={1040}
                  rowKey={(r) => r.productCode}
                  rows={pm.returnRanking}
                  columns={[
                    { key: "rank", label: "#", render: (_r, i) => <span className="text-[var(--muted)]">{i + 1}</span> },
                    { key: "productName", label: "产品名称", sortValue: (r) => r.productName || "", render: (r) => <span className="font-semibold">{r.productName || "-"}</span> },
                    { key: "productCode", label: "商品编码", sortValue: (r) => r.productCode, render: (r) => <span className="text-[var(--muted)]">{r.productCode}</span> },
                    { key: "refundUnits", label: "退货数量", align: "right", sortValue: (r) => r.refundUnits, render: (r) => count(r.refundUnits) },
                    { key: "refundAmount", label: "退货金额", align: "right", sortValue: (r) => r.refundAmount, render: (r) => <span className="font-semibold text-[var(--pink)]">{money(r.refundAmount)}</span> },
                    { key: "refundOrderCount", label: "退款订单数", align: "right", sortValue: (r) => r.refundOrderCount, render: (r) => count(r.refundOrderCount) },
                    { key: "refundOrderShare", label: "退款订单占比", align: "right", sortValue: (r) => r.refundOrderShare ?? -1, render: (r) => <StatusTag label={percent(r.refundOrderShare, 1)} tone={r.refundOrderShare !== null && r.refundOrderShare >= 0.15 ? "red" : "muted"} /> },
                    { key: "refundRate", label: "退货率", align: "right", sortValue: (r) => r.refundRate ?? 99, render: (r) => <StatusTag label={percent(r.refundRate)} tone={r.refundRate !== null && r.refundRate >= 0.1 ? "red" : "orange"} /> },
                    { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.receivedAmount)}</span> },
                                      ]}
                />
              </Card>
              <ReturnBreakdownTable title="渠道退货拆分 · 按退货金额排序" rows={pm.returnChannelBreakdown} dimLabel="渠道平台" />
              <ReturnBreakdownTable title="店铺退货拆分 · 按退货金额排序" rows={pm.returnStoreBreakdown} dimLabel="店铺简称" />
              <ReturnBreakdownTable title="达人退货拆分 · 按退货金额排序" rows={pm.returnDarenBreakdown} dimLabel="达人" emptyHint="该批次无达人关联订单" />
              <ReturnBreakdownTable title="床垫类别退货拆分 · 按退货金额排序" rows={pm.returnCategoryBreakdown} dimLabel="床垫类别" emptyHint="产品主表未同步，无床垫类别数据" />
            </>
          )}

          {tab === "channel" && (
            <>
              <Card title="店铺简称贡献排名 · 按商家实收排序的店铺分布">
                <SortableTable
                  minWidth={720}
                  rowKey={(r) => r.store}
                  rows={pm.storeBreakdown}
                  columns={[
                    { key: "store", label: "店铺简称", sortValue: (r) => r.store, render: (r) => <span className="font-semibold">{r.store}</span> },
                    { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.receivedAmount)}</span> },
                    { key: "salesUnits", label: "销量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
                    { key: "refundAmount", label: "退货金额", align: "right", sortValue: (r) => r.refundAmount, render: (r) => <span className="text-[var(--pink)]">{money(r.refundAmount)}</span> },
                                      ]}
                />
              </Card>
              <Card title="达人贡献排名 · 按商家实收排序的带货达人" className="mt-4">
                <SortableTable
                  minWidth={620}
                  rowKey={(r) => r.daren}
                  rows={pm.darenBreakdown}
                  emptyHint="该批次无达人关联订单"
                  columns={[
                    { key: "daren", label: "达人", sortValue: (r) => r.daren, render: (r) => <span className="font-semibold">{r.daren}</span> },
                    { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.receivedAmount)}</span> },
                    { key: "salesUnits", label: "销量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
                                      ]}
                />
              </Card>
            </>
          )}

          {tab === "daily" && (
            <>
              <Card title="床垫类别 × 渠道销量">
                <MatrixTable matrix={pm.categoryChannelMatrix} rowHeader="床垫类别" minWidth={960} />
              </Card>
              <Card title="发货仓 × 订单状态 销售数量" className="mt-4">
                <MatrixTable matrix={pm.warehouseStatusMatrix} rowHeader="发货仓" minWidth={860} />
              </Card>
              <Card title="每日渠道销量 · 日期 × 渠道销售数量" className="mt-4">
                <MatrixTable matrix={pm.dailyChannelMatrix} rowHeader="日期" minWidth={960} />
              </Card>
              <Card title="每日订单状态分布 · 日期 × 订单状态销售数量" className="mt-4">
                <MatrixTable matrix={pm.dailyStatusMatrix} rowHeader="日期" minWidth={960} />
              </Card>
              <Card title="产品名称 × 渠道销量（Top 30）" className="mt-4">
                <MatrixTable matrix={pm.productChannelMatrix} rowHeader="产品名称" minWidth={960} />
              </Card>
              <Card title="产品名称 × 订单状态销售数量（Top 30）" className="mt-4">
                <MatrixTable matrix={pm.productStatusMatrix} rowHeader="产品名称" minWidth={860} />
              </Card>
            </>
          )}

          {tab === "fulfillment" && (
            <Card title="仓配履约 · 产品名称维度的订单量与发货时效差异">
              <div className="mb-3 text-[12px] leading-relaxed text-[var(--muted)]">
                时效 = 发货日期 − 订单日期；平均时效仅统计已发货订单。第 N 天为订单后第 N 个自然日发货，15 天内为 0–15 天累计占全部订单的比例。
              </div>
              <SortableTable
                minWidth={1220}
                rowKey={(r) => r.productName}
                rows={pm.fulfillmentByProduct}
                emptyHint="当前筛选条件下暂无可计算的产品订单"
                columns={[
                  { key: "rank", label: "#", render: (_r, i) => <span className="text-[var(--muted)]">{i + 1}</span> },
                  { key: "productName", label: "产品名称", sortValue: (r) => r.productName, render: (r) => <span className="font-semibold">{r.productName}</span> },
                  { key: "orderCount", label: "订单量", align: "right", sortValue: (r) => r.orderCount, render: (r) => <span className="font-semibold text-[var(--green)]">{count(r.orderCount)}</span> },
                  { key: "avgShippingDays", label: "平均发货时效", align: "right", sortValue: (r) => r.avgShippingDays ?? -1, render: (r) => <span className={r.avgShippingDays === null ? "text-[var(--muted)]" : r.avgShippingDays >= 7 ? "font-semibold text-[var(--pink)]" : r.avgShippingDays >= 5 ? "font-semibold text-[var(--orange)]" : "font-semibold text-[var(--green)]"}>{shippingDays(r.avgShippingDays)}</span> },
                  { key: "day3Share", label: "第3天发货占比", align: "right", sortValue: (r) => r.day3Share, render: (r) => percent(r.day3Share, 1) },
                  { key: "day5Share", label: "第5天发货占比", align: "right", sortValue: (r) => r.day5Share, render: (r) => percent(r.day5Share, 1) },
                  { key: "day7Share", label: "第7天发货占比", align: "right", sortValue: (r) => r.day7Share, render: (r) => percent(r.day7Share, 1) },
                  { key: "day10Share", label: "第10天发货占比", align: "right", sortValue: (r) => r.day10Share, render: (r) => percent(r.day10Share, 1) },
                  { key: "within15DayShare", label: "15天内累计发货占比", align: "right", sortValue: (r) => r.within15DayShare, render: (r) => <span className="font-semibold text-[var(--green)]">{percent(r.within15DayShare, 1)}</span> },
                ]}
              />
            </Card>
          )}

          {tab === "price" && <PriceStructurePanel data={pm.priceStructure} />}
          {tab === "size" && <SizeStructurePanel data={pm.sizeStructure} />}
          {tab === "spu" && <SpuSalesTrendPanel data={pm.spuSalesTrend} />}
          {tab === "custom" && <CustomizationStructurePanel data={pm.customizationStructure} />}
        </>
      )}
    </div>
  );
}
