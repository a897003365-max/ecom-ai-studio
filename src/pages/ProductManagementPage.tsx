import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card } from "../components/Card";
import { PageHeader } from "../components/PageHeader";
import { SortableTable } from "../components/SortableTable";
import { StatusTag } from "../components/StatusTag";
import { Tabs } from "../components/Tabs";
import { getProductData, getProductPeriod, syncDataSource } from "../services/localApi";
import { useSearchTarget } from "../hooks/useSearchTarget";
import type { ProductManagementPages, ProductMatrix, ProductReturnDimensionBreakdownItem } from "../types/integration";
import type { SearchTarget } from "../types/search";
import { CustomizationStructurePanel } from "../components/product-management/CustomizationStructurePanel";
import { PriceStructurePanel } from "../components/product-management/PriceStructurePanel";
import { ProductCommandOverview } from "../components/product-management/ProductCommandOverview";
import { ProductGalleryView } from "../components/product-management/ProductGalleryView";
import { SizeStructurePanel } from "../components/product-management/SizeStructurePanel";
import { ChannelQualityPanel } from "../components/product-management/ChannelQualityPanel";
import { ProductFilters } from "../components/product-management/ProductFilters";
import { EMPTY_PRODUCT_FILTERS, normalizeProductFilters, productFilterError, productFilterKey, productFilterRequest, recentProductDays, type ProductFilterState } from "../components/product-management/productFilterState";
import { ViewStateProvider, ViewStateScope } from "../hooks/useViewState";
import { SpuTrendCard } from "../components/product-management/SpuTrendCard";
import { DailyTrendChart } from "../components/product-management/DailyTrendChart";
import { SpuTrendLineChart, SPU_TREND_COLORS, type SpuTrendSeries } from "../components/product-management/SpuTrendLineChart";
import { MatrixTable } from "../components/product-management/MatrixTable";
import { HierarchyTable } from "../components/product-management/HierarchyTable";
import { ProductStatusHierarchyTable } from "../components/product-management/ProductStatusHierarchyTable";

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

function matrixToTrendSeries(matrix: ProductMatrix | undefined | null): { series: SpuTrendSeries[]; dates: string[] } {
  if (!matrix) return { series: [], dates: [] };
  const dates = matrix.rows.map((r) => r.rowKey);
  // 系列不做截断：矩阵每一列都画出来，避免小体量维度（如床架工厂）被悄悄隐藏。
  const series = matrix.columns.map((col, i) => ({
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

export function ProductManagementPage({ onAction, searchTarget, onSearchConsumed }: ProductManagementPageProps) {
  // 数据与生效条件一起提交；请求失败时继续展示上次成功结果。
  const [result, setResult] = useState<{ pm: ProductManagementPages | null; refreshedAt: string | null; applied: ProductFilterState }>(
    { pm: null, refreshedAt: null, applied: EMPTY_PRODUCT_FILTERS },
  );
  const { pm, refreshedAt, applied } = result;
  const [draft, setDraft] = useState<ProductFilterState>(EMPTY_PRODUCT_FILTERS);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [periodError, setPeriodError] = useState("");
  const [tab, setTab] = useState<ProductTab>("overview");
  const [fullPeriod, setFullPeriod] = useState<DateRange | null>(null);
  const [selectedSpus, setSelectedSpus] = useState<string[]>([]);
  const loadTokenRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const periodControllerRef = useRef<AbortController | null>(null);
  const appliedRef = useRef(applied);
  const successfulKeyRef = useRef<string | null>(null);
  const pendingKeyRef = useRef<string | null>(null);
  const retryRef = useRef<ProductFilterState | null>(null);
  const mountedRef = useRef(true);
  const { channels } = applied;

  async function load(value: ProductFilterState, force = false) {
    const filters = normalizeProductFilters(value);
    const key = productFilterKey(filters);
    const validation = productFilterError(filters);
    if (validation) { setError(validation); return false; }
    if (!force && key === pendingKeyRef.current && !controllerRef.current?.signal.aborted) return false;
    if (!force && key === successfulKeyRef.current) {
      // 取消尚在进行的新条件请求，仍保留已成功应用的条件。
      controllerRef.current?.abort();
      ++loadTokenRef.current;
      pendingKeyRef.current = null;
      setLoading(false);
      setError("");
      return true;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const token = ++loadTokenRef.current;
    const draftAtStart = productFilterKey(draftRef.current);
    pendingKeyRef.current = key;
    retryRef.current = filters;
    setLoading(true);
    setError("");
    try {
      const payload = await getProductData(productFilterRequest(filters), { signal: controller.signal });
      if (!mountedRef.current || token !== loadTokenRef.current) return false;
      const productManagement = payload.productManagement;
      if (payload.status === "stale" || !productManagement) throw new Error(payload.error || "商品数据暂不可用，请稍后重试。");
      setResult({ pm: productManagement, refreshedAt: payload.refreshedAt, applied: filters });
      appliedRef.current = filters;
      successfulKeyRef.current = key;
      if (productFilterKey(draftRef.current) === draftAtStart) setDraft(filters);
      setSelectedSpus((current) => current.filter((spu) => productManagement.spuSalesTrend?.summaries.some((row) => row.spu === spu)));
      // 仅全周期快照缺字段时补查一次。日期请求已走按需计算，无需重复同一查询。
      if (!filters.start && !hasGalleryFields(productManagement) && productManagement.period?.start && productManagement.period.end) {
        const galleryFilters = { ...filters, start: String(productManagement.period.start).slice(0, 10), end: String(productManagement.period.end).slice(0, 10) };
        void getProductData(productFilterRequest(galleryFilters), { signal: controller.signal }).then((next) => {
          if (!mountedRef.current || token !== loadTokenRef.current || next.status === "stale" || !next.productManagement) return;
          setResult((current) => ({ ...current, pm: next.productManagement, refreshedAt: next.refreshedAt ?? current.refreshedAt }));
        }).catch(() => { /* 已有快照继续可用；下一次手动应用或刷新重新读取。 */ });
      }
      return true;
    } catch (loadError) {
      if (!controller.signal.aborted && mountedRef.current && token === loadTokenRef.current) setError(loadError instanceof Error ? loadError.message : "商品数据读取失败");
      return false;
    } finally {
      if (mountedRef.current && token === loadTokenRef.current) { pendingKeyRef.current = null; setLoading(false); }
    }
  }

  async function initialize(signal: AbortSignal) {
    setLoading(true);
    setPeriodError("");
    try {
      const meta = await getProductPeriod({ signal });
      if (signal.aborted || !mountedRef.current) return;
      const available = meta.period ? { start: meta.period.start.slice(0, 10), end: meta.period.end.slice(0, 10) } : null;
      setFullPeriod(available);
      setReady(true);
      if (loadTokenRef.current === 0) {
        const initial = { ...EMPTY_PRODUCT_FILTERS, ...(available ? recentProductDays(available) : {}) };
        setDraft(initial);
        void load(initial);
      } else if (!pendingKeyRef.current) {
        if (error && retryRef.current) void load(retryRef.current, true);
        else setLoading(false);
      }
    } catch (loadError) {
      if (!signal.aborted && mountedRef.current) {
        setPeriodError(loadError instanceof Error ? loadError.message : "商品周期读取失败");
        if (!pendingKeyRef.current) setLoading(false);
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    periodControllerRef.current = controller;
    void initialize(controller.signal);
    return () => { mountedRef.current = false; periodControllerRef.current?.abort(); controllerRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const searchRequestId = searchTarget?.requestId;
  useEffect(() => {
    if (searchTarget?.page !== "products") return;
    const target = searchTarget;
    if (target.tab) setTab(target.tab);
    const filters = target.filters;
    if (filters?.start || filters?.end || filters?.channels?.length || filters?.storeShortNames?.length) {
      const next = { ...EMPTY_PRODUCT_FILTERS, start: filters.start ?? "", end: filters.end ?? "", channels: filters.channels ?? [], storeShortNames: filters.storeShortNames ?? [] };
      setDraft(next);
      void load(next);
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
      if (!mountedRef.current) return;
      const refreshed = await load(appliedRef.current, true);
      onAction(refreshed ? "同步完成" : "同步完成，页面刷新失败", refreshed ? "商品管理看板已刷新" : "保留原有结果，可手动重试");
    } catch (syncError) {
      onAction("同步失败", syncError instanceof Error ? syncError.message : "数仓同步出错");
    } finally {
      setSyncing(false);
    }
  }

  const activeRangeLabel = applied.start ? `${applied.start} ~ ${applied.end}` : "全周期";
  const scopeActive = Boolean(applied.includeCodes || applied.excludeCodes || applied.includeIds || applied.excludeIds);
  const filterKey = productFilterKey(applied);
  const channelTrend = useMemo(() => matrixToTrendSeries(pm?.dailyChannelMatrix), [pm?.dailyChannelMatrix]);
  const warehouseTrend = useMemo(() => matrixToTrendSeries(pm?.dailyWarehouseMatrix), [pm?.dailyWarehouseMatrix]);
  const categoryTrend = useMemo(() => matrixToTrendSeries(pm?.dailyCategoryMatrix), [pm?.dailyCategoryMatrix]);
  const shipWarehouseTrend = useMemo(() => matrixToTrendSeries(pm?.dailyShipWarehouseMatrix), [pm?.dailyShipWarehouseMatrix]);
  const productChannelMatrix = useMemo(() => {
    if (!pm) return null;
    const selectedNames = new Set((pm.spuSalesTrend?.summaries ?? []).filter((row) => selectedSpus.includes(row.spu)).flatMap((row) => row.productNames?.length ? row.productNames : row.productName ? [row.productName] : []));
    return selectedSpus.length && selectedNames.size ? { ...pm.productChannelMatrix, rows: pm.productChannelMatrix.rows.filter((row) => selectedNames.has(row.rowKey)) } : pm.productChannelMatrix;
  }, [pm, selectedSpus]);

  return (
    <div className="product-management-page">
      <PageHeader
        title="商品管理"
        subtitle={`商品销售、履约、退货与渠道分布；数据周期 ${activeRangeLabel}，最近刷新 ${dateTime(refreshedAt)}。`}
        actions={<button className="btn" disabled={syncing || !ready} onClick={sync} type="button"><RefreshCw className="mr-1.5 inline-block" size={14} strokeWidth={2} />{syncing ? "同步中" : "同步数仓"}</button>}
      />
      <ProductFilters draft={draft} applied={applied} onChange={setDraft} onApply={() => void load(draft)} loading={loading} ready={ready} period={fullPeriod} options={{ statuses: pm?.availableStatuses ?? [], channels: pm?.availableChannels ?? [], storeShortNames: pm?.availableStoreShortNames ?? [] }} />
      {(error || periodError) && (
        <Card className="mb-4 border-[var(--orange)]">
          <div className="text-[13px] text-[var(--orange)]" role="alert">{periodError || error}{pm ? " 当前保留上次成功结果。" : ""}</div>
          <button className="btn mt-3" disabled={loading} type="button" onClick={() => { if (ready && retryRef.current) void load(retryRef.current, true); else { periodControllerRef.current?.abort(); const controller = new AbortController(); periodControllerRef.current = controller; void initialize(controller.signal); } }}>重试</button>
        </Card>
      )}

      {!error && scopeActive && pm && (pm.productOverview?.length ?? 0) === 0 && (
        <Card className="mb-4 border-[var(--orange)]">
          <div className="text-[13px] text-[var(--orange)]">
            当前筛选条件下没有匹配到商品；若使用了商品范围，请检查商品编码/商品ID 是否正确，或放宽排除范围。
          </div>
        </Card>
      )}

      {loading && !pm ? (
        <Card>
          <div role="status" aria-label="正在读取商品数据"><p className="text-[var(--muted)] text-sm">正在读取商品数据…</p><div className="product-data-skeleton" aria-hidden="true"><span /><span /><span /></div></div>
        </Card>
      ) : !pm ? (
        <Card>
          <div className="py-10 text-center text-[13px] text-[var(--muted)]">暂无商品数据。请点击右上角「同步数仓」。</div>
        </Card>
      ) : (
        <ViewStateProvider filterKey={filterKey}>
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

          <ViewStateScope name={tab}>
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
                  const t = channelTrend;
                  return <SpuTrendLineChart series={t.series} dates={t.dates} emptyHint="暂无渠道销量趋势数据" />;
                })()}
              </Card>
              <Card title="每日 × 发货仓销量趋势" className="mt-4">
                {(() => {
                  const t = warehouseTrend;
                  return <SpuTrendLineChart series={t.series} dates={t.dates} emptyHint="暂无发货仓销量趋势数据" />;
                })()}
              </Card>
              <Card title="床垫类别分布 · 每日销量趋势" className="mt-4">
                {(() => {
                  const t = categoryTrend;
                  return <SpuTrendLineChart series={t.series} dates={t.dates} emptyHint="暂无产品分类销量趋势数据" />;
                })()}
              </Card>
              <SpuTrendCard data={pm.spuSalesTrend} className="mt-4" selectedSpus={selectedSpus} onSelectedSpusChange={setSelectedSpus} />
              <Card title="产品名称 × 渠道销量" action={<span className="text-xs text-[var(--muted)]">{selectedSpus.length ? `已联动 ${selectedSpus.length} 个 SPU` : "全量，按销量排序"}</span>} className="mt-4">
                {productChannelMatrix && <MatrixTable matrix={productChannelMatrix} rowHeader="产品名称" minWidth={960} pageSize={15} />}
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
              <MatrixTable matrix={pm.warehouseStatusMatrix} dailyDetails={pm.warehouseStatusDaily} rowHeader="发货仓" minWidth={860} />
            </Card>
            <Card title="每日发货量趋势 · 发货日期 × 发货仓销售数量" className="mt-4">
              <div className="mb-3 text-[12px] text-[var(--muted)]">
                按发货日期统计，全局日期范围直接作用于发货日期；未发货订单不计入
              </div>
              {(() => {
                const t = shipWarehouseTrend;
                return <SpuTrendLineChart series={t.series} dates={t.dates} emptyHint="暂无按发货日期统计的发货仓数据" />;
              })()}
            </Card>
            <Card title="每日订单状态分布 · 日期 × 订单状态销售数量" className="mt-4">
              <MatrixTable matrix={pm.dailyStatusMatrix} rowHeader="日期" minWidth={960} pageSize={15} />
            </Card>
            <Card title="仓配履约 · 产品名称维度的订单量与发货时效差异" className="mt-4">
              <div className="mb-3 text-[12px] text-[var(--muted)]">
                时效 = 发货日期 − 订单日期 · 点 ▶ 展开子名称明细
              </div>
              <HierarchyTable
                minWidth={1220}
                rowKey={(r) => r.key}
                nameColumnKey="productName"
                rows={pm.fulfillmentByProductHierarchy.rows}
                emptyHint="当前筛选条件下暂无可计算的产品订单"
                columns={[
                  { key: "rank", label: "#", render: (_r, i) => <span className="text-[var(--muted)]">{i + 1}</span> },
                  { key: "productName", label: "产品名称", sortValue: (r) => r.name, render: (r) => <span className="font-semibold">{r.name}</span> },
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
            <Card title="产品名称 × 订单状态销售数量（全量）" className="mt-4">
              <ProductStatusHierarchyTable
                hierarchy={pm.productStatusHierarchy}
                rowHeader="产品名称"
                minWidth={860}
                pageSize={15}
              />
            </Card>
            </div>
          )}

          {tab === "price" && <div data-search-anchor="products-price"><PriceStructurePanel data={pm.priceStructure} /></div>}
          {tab === "size" && <div data-search-anchor="products-size"><SizeStructurePanel data={pm.sizeStructure} /></div>}
          {tab === "custom" && <div data-search-anchor="products-custom"><CustomizationStructurePanel data={pm.customizationStructure} /></div>}
          </ViewStateScope>
        </ViewStateProvider>
      )}
    </div>
  );
}
