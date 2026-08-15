import { useEffect, useRef, useState } from "react";
import { ChevronDown, Filter, RefreshCw, Store, X } from "lucide-react";
import { AnalyticsDateFilter } from "../components/AnalyticsDateFilter";
import { Card } from "../components/Card";
import { PageHeader } from "../components/PageHeader";
import { SortableTable } from "../components/SortableTable";
import { StatusTag } from "../components/StatusTag";
import { Tabs } from "../components/Tabs";
import { getProductData, syncDataSource } from "../services/localApi";
import { useSearchTarget } from "../hooks/useSearchTarget";
import type { ProductManagementPages, ProductMatrix, ProductReturnDimensionBreakdownItem } from "../types/integration";
import type { SearchTarget } from "../types/search";
import { CustomizationStructurePanel } from "../components/product-management/CustomizationStructurePanel";
import { PriceStructurePanel } from "../components/product-management/PriceStructurePanel";
import { ProductCommandOverview } from "../components/product-management/ProductCommandOverview";
import { ProductGalleryView } from "../components/product-management/ProductGalleryView";
import { SizeStructurePanel } from "../components/product-management/SizeStructurePanel";
import { ChannelQualityPanel } from "../components/product-management/ChannelQualityPanel";
import { SpuTrendCard } from "../components/product-management/SpuTrendCard";
import { DailyTrendChart } from "../components/product-management/DailyTrendChart";
import { SpuTrendLineChart, SPU_TREND_COLORS, type SpuTrendSeries } from "../components/product-management/SpuTrendLineChart";
import { MatrixTable } from "../components/product-management/MatrixTable";

interface DateRange {
  start: string;
  end: string;
}

interface ProductManagementPageProps {
  onAction: (title: string, detail?: string) => void;
  searchTarget?: SearchTarget | null;
  onSearchConsumed?: () => void;
}

type ProductTab = "overview" | "gallery" | "channel" | "trend" | "returns" | "fulfillment" | "price" | "size" | "custom";

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

function hasGalleryFields(pm: ProductManagementPages | null) {
  if (!pm) return true;
  const product = pm.productNameOverview[0];
  const sku = pm.productOverview[0];
  const productReady = !product || Object.prototype.hasOwnProperty.call(product, "imageUrl");
  const skuReady = !sku || ["grossProfit", "matchedReceived", "grossMargin", "prevReceivedAmount"]
    .every((field) => Object.prototype.hasOwnProperty.call(sku, field));
  return productReady && skuReady;
}

function matrixToTrendSeries(matrix: ProductMatrix | undefined | null, topN = 8): { series: SpuTrendSeries[]; dates: string[] } {
  if (!matrix) return { series: [], dates: [] };
  const dates = matrix.rows.map((r) => r.rowKey);
  const series = matrix.columns.slice(0, topN).map((col, i) => ({
    spu: col,
    productName: "",
    values: matrix.rows.map((r) => r.values[col] || 0),
    color: SPU_TREND_COLORS[i % SPU_TREND_COLORS.length],
  }));
  return { series, dates };
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
        minWidth={820}
        rowKey={(r) => r.dim}
        rows={rows}
        emptyHint={emptyHint}
        columns={[
          { key: "rank", label: "#", render: (_r, i) => <span className="text-[var(--muted)]">{i + 1}</span> },
          { key: "dim", label: dimLabel, sortValue: (r) => r.dim, render: (r) => <span className="font-semibold">{r.dim}</span> },
          { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.receivedAmount)}</span> },
          { key: "refundAmount", label: "退货金额", align: "right", sortValue: (r) => r.refundAmount, render: (r) => <span className="font-semibold text-[var(--pink)]">{money(r.refundAmount)}</span> },
          { key: "refundRate", label: "退货率", align: "right", sortValue: (r) => r.refundRate ?? 99, render: (r) => <StatusTag label={percent(r.refundRate)} tone={r.refundRate !== null && r.refundRate >= 0.1 ? "red" : "muted"} /> },
          { key: "fullRefundShare", label: "全额退款占比", align: "right", sortValue: (r) => r.fullRefundShare ?? -1, render: (r) => <StatusTag label={percent(r.fullRefundShare)} tone="muted" /> },
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

export function ProductManagementPage({ onAction, searchTarget, onSearchConsumed }: ProductManagementPageProps) {
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
  const [selectedSpus, setSelectedSpus] = useState<string[]>([]);
  // 防止后台 gallery 刷新覆盖更新后的筛选结果：每次 load 自增，过期 token 的回调丢弃
  const loadTokenRef = useRef(0);

  async function load(
    date: DateRange | null = null,
    newStatuses: string[] = statuses,
    newChannels: string[] = channels,
    newStoreShortNames: string[] = storeShortNames,
  ) {
    const token = ++loadTokenRef.current;
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
      const productManagement = payload.productManagement;
      // 首包即渲染，不阻塞在画册字段补查上（快照缺 gallery 字段时后台补，见下方）
      setPm(productManagement);
      setRefreshedAt(payload.refreshedAt);
      setDateRange(date);
      setStatuses(newStatuses);
      setChannels(newChannels);
      setStoreShortNames(newStoreShortNames);
      if (productManagement?.period?.start && productManagement?.period?.end) {
        const dataPeriod = {
          start: String(productManagement.period.start).slice(0, 10),
          end: String(productManagement.period.end).slice(0, 10),
        };
        // 仅在无任何筛选（全周期）时更新可选范围，避免维度筛选缩短日期控件范围。
        if (!date && newStatuses.length === 0 && newChannels.length === 0 && newStoreShortNames.length === 0) {
          setFullPeriod(dataPeriod);
        }
      }
      if (payload.status === "stale" && !productManagement) {
        setError("商品数据尚未同步，点击右上角同步数仓生成看板。");
      }
      // 快照缺画册字段时后台按全周期 on-demand 补查（含 gallery 字段）。
      // 不阻塞首屏；若用户已换筛选则丢弃过期回调，避免覆盖新结果。
      if (!hasGalleryFields(productManagement) && productManagement?.period?.start && productManagement.period.end) {
        void getProductData({
          start: String(productManagement.period.start).slice(0, 10),
          end: String(productManagement.period.end).slice(0, 10),
          statuses: newStatuses.length ? newStatuses : undefined,
          channels: newChannels.length ? newChannels : undefined,
          storeShortNames: newStoreShortNames.length ? newStoreShortNames : undefined,
        })
          .then((refreshedPayload) => {
            if (token !== loadTokenRef.current) return;
            const refreshed = refreshedPayload.productManagement;
            if (refreshed) {
              setPm(refreshed);
              setRefreshedAt(refreshedPayload.refreshedAt ?? payload.refreshedAt);
            }
          })
          .catch(() => { /* 保留首包数据 */ });
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

  // 顶部智能找数：应用页签/日期/渠道/店铺筛选
  const searchRequestId = searchTarget?.requestId;
  useEffect(() => {
    if (searchTarget?.page !== "products") return;
    const target = searchTarget;
    if (target.tab) setTab(target.tab);
    const date = target.filters?.start && target.filters?.end ? { start: target.filters.start, end: target.filters.end } : null;
    const channels = target.filters?.channels ?? [];
    const storeShortNames = target.filters?.storeShortNames ?? [];
    if (date || channels.length || storeShortNames.length) {
      void load(date, [], channels, storeShortNames);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRequestId]);

  useSearchTarget(
    searchTarget?.page === "products" ? searchTarget : null,
    Boolean(pm),
    () => onSearchConsumed?.(),
    () => onAction("已进入对应数据页", "目标区域暂未加载"),
  );

  const searchFocus = searchTarget?.page === "products" ? searchTarget.focus : undefined;

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
          <div className="product-filter-toolbar" data-testid="product-operations-filter" data-ui="filter-bar">
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
              { id: "gallery", label: "商品画册" },
              { id: "channel", label: "渠道质量" },
              { id: "trend", label: "销售趋势" },
              { id: "returns", label: "退货分析" },
              { id: "fulfillment", label: "仓配履约" },
              { id: "price", label: "价格结构" },
              { id: "size", label: "尺寸结构" },
              { id: "custom", label: "定制结构" },
            ]}
          />

          {tab === "overview" && (
            <div data-search-anchor="products-overview">
              <ProductCommandOverview channelScoped={channels.length > 0} focusTarget={searchFocus} pm={pm} />
            </div>
          )}

          {tab === "gallery" && <div data-search-anchor="products-gallery"><ProductGalleryView pm={pm} /></div>}

          {tab === "channel" && <div data-search-anchor="products-channel"><ChannelQualityPanel pm={pm} /></div>}

          {tab === "trend" && (
            <div data-search-anchor="products-trend">
              <Card title="月度商家实收趋势">
                <SortableTable
                  minWidth={920}
                  rowKey={(r) => r.month}
                  rows={pm.monthlyTrend}
                  defaultSortKey="month"
                  defaultSortDir="desc"
                  columns={[
                    { key: "month", label: "月份", sortValue: (r) => r.month, render: (r) => <span className="font-medium">{r.month}</span> },
                    { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="font-semibold text-[var(--green)]">{money(r.receivedAmount)}</span> },
                    { key: "salesUnits", label: "销量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
                    { key: "refundAmount", label: "退货金额", align: "right", sortValue: (r) => r.refundAmount, render: (r) => <span className="text-[var(--pink)]">{money(r.refundAmount)}</span> },
                    { key: "refundRate", label: "退款率", align: "right", sortValue: (r) => r.refundRate ?? -1, render: (r) => <StatusTag label={percent(r.refundRate)} tone={r.refundRate !== null && r.refundRate >= 0.1 ? "red" : "muted"} /> },
                    { key: "grossProfit", label: "毛利额", align: "right", sortValue: (r) => r.grossProfit ?? -1, render: (r) => r.grossProfit !== null ? <span className="text-[var(--purple)]">{money(r.grossProfit)}</span> : "-" },
                    { key: "grossMargin", label: "毛利率", align: "right", sortValue: (r) => r.grossMargin ?? -1, render: (r) => r.grossMargin !== null ? percent(r.grossMargin) : "-" },
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
              <Card title="每日 × 渠道平台销量趋势" className="mt-4">
                {(() => {
                  const t = matrixToTrendSeries(pm.dailyChannelMatrix);
                  return <SpuTrendLineChart series={t.series} dates={t.dates} emptyHint="暂无渠道销量趋势数据" />;
                })()}
              </Card>
              <Card title="每日 × 发货仓销量趋势" className="mt-4">
                {(() => {
                  const t = matrixToTrendSeries(pm.dailyWarehouseMatrix);
                  return <SpuTrendLineChart series={t.series} dates={t.dates} emptyHint="暂无发货仓销量趋势数据" />;
                })()}
              </Card>
              <Card title="床垫类别分布 · 每日销量趋势" className="mt-4">
                {(() => {
                  const t = matrixToTrendSeries(pm.dailyCategoryMatrix);
                  return <SpuTrendLineChart series={t.series} dates={t.dates} emptyHint="暂无产品分类销量趋势数据" />;
                })()}
              </Card>
              <SpuTrendCard data={pm.spuSalesTrend} className="mt-4" selectedSpus={selectedSpus} onSelectedSpusChange={setSelectedSpus} />
              <Card title={selectedSpus.length > 0 ? `产品名称 × 渠道销量（已联动 ${selectedSpus.length} 个 SPU）` : "产品名称 × 渠道销量（Top 30）"} className="mt-4">
                {(() => {
                  const summaries = pm.spuSalesTrend?.summaries ?? [];
                  const spuToProductName = new Map(summaries.map((s) => [s.spu, s.productName]));
                  const selectedNames = selectedSpus.length > 0
                    ? new Set(selectedSpus.map((spu) => spuToProductName.get(spu)).filter(Boolean))
                    : null;
                  const matrix = pm.productChannelMatrix;
                  const filtered = selectedNames && selectedNames.size > 0
                    ? { ...matrix, rows: matrix.rows.filter((r) => selectedNames.has(r.rowKey)) }
                    : matrix;
                  return <MatrixTable matrix={filtered} rowHeader="产品名称" minWidth={960} />;
                })()}
              </Card>
              <Card title="床垫类别 × 渠道销量" className="mt-4">
                <MatrixTable matrix={pm.categoryChannelMatrix} rowHeader="床垫类别" minWidth={960} />
              </Card>
              <Card title="每日渠道销量 · 日期 × 渠道销售数量" className="mt-4">
                <MatrixTable matrix={pm.dailyChannelMatrix} rowHeader="日期" minWidth={960} pageSize={15} />
              </Card>
            </div>
          )}

          {tab === "returns" && (
            <div data-search-anchor="products-returns">
              <ReturnBreakdownTable title="渠道退货拆分 · 按退货金额排序" rows={pm.returnChannelBreakdown} dimLabel="渠道平台" />
              <ReturnBreakdownTable title="店铺退货拆分 · 按退货金额排序" rows={pm.returnStoreBreakdown} dimLabel="店铺简称" />
              <ReturnBreakdownTable title="床垫类别退货拆分 · 按退货金额排序" rows={pm.returnCategoryBreakdown} dimLabel="床垫类别" emptyHint="产品主表未同步，无床垫类别数据" />
              <Card title="退货排名（按退货金额）· 定位高退货商品，结合回款与售后复盘" className="mt-4">
                <SortableTable
                  minWidth={820}
                  rowKey={(r) => r.productName}
                  rows={pm.returnRanking}
                  columns={[
                    { key: "rank", label: "#", render: (_r, i) => <span className="text-[var(--muted)]">{i + 1}</span> },
                    { key: "spu", label: "SPU", sortValue: (r) => r.spu, render: (r) => <span className="text-[var(--muted)]">{r.spu}</span> },
                    { key: "productName", label: "产品名称", sortValue: (r) => r.productName || "", render: (r) => <span className="font-semibold">{r.productName || "-"}</span> },
                    { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.receivedAmount)}</span> },
                    { key: "refundAmount", label: "退货金额", align: "right", sortValue: (r) => r.refundAmount, render: (r) => <span className="font-semibold text-[var(--pink)]">{money(r.refundAmount)}</span> },
                    { key: "refundRate", label: "退货率", align: "right", sortValue: (r) => r.refundRate ?? 99, render: (r) => <StatusTag label={percent(r.refundRate)} tone={r.refundRate !== null && r.refundRate >= 0.1 ? "red" : "orange"} /> },
                                      ]}
                />
              </Card>
            </div>
          )}

          {tab === "fulfillment" && (
            <div data-search-anchor="products-fulfillment">
            <Card title="渠道平台 × 订单状态明细">
              <MatrixTable matrix={pm.channelStatusMatrix ?? { columns: [], rows: [] }} rowHeader="渠道平台" minWidth={860} />
            </Card>
            <Card title="发货仓 × 订单状态 销售数量" className="mt-4">
              <MatrixTable matrix={pm.warehouseStatusMatrix} rowHeader="发货仓" minWidth={860} />
            </Card>
            <Card title="每日订单状态分布 · 日期 × 订单状态销售数量" className="mt-4">
              <MatrixTable matrix={pm.dailyStatusMatrix} rowHeader="日期" minWidth={960} pageSize={15} />
            </Card>
            <Card title="仓配履约 · 产品名称维度的订单量与发货时效差异" className="mt-4">
              <div className="mb-3 text-[12px] text-[var(--muted)]">
                时效 = 发货日期 − 订单日期
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
            <Card title="产品名称 × 订单状态销售数量（Top 30）" className="mt-4">
              <MatrixTable matrix={pm.productStatusMatrix} rowHeader="产品名称" minWidth={860} />
            </Card>
            </div>
          )}

          {tab === "price" && <div data-search-anchor="products-price"><PriceStructurePanel data={pm.priceStructure} /></div>}
          {tab === "size" && <div data-search-anchor="products-size"><SizeStructurePanel data={pm.sizeStructure} /></div>}
          {tab === "custom" && <div data-search-anchor="products-custom"><CustomizationStructurePanel data={pm.customizationStructure} /></div>}
        </>
      )}
    </div>
  );
}
