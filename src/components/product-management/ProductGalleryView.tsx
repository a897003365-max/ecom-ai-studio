import {
  ArrowDownRight,
  ArrowUpRight,
  ImageOff,
  Minus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Pagination } from "../SortableTable";
import type {
  ProductManagementPages,
  ProductNameOverviewItem,
  ProductOverviewItem,
} from "../../types/integration";
import "../../styles/product-gallery.css";

const PAGE_SIZE = 32;
const SKU_PAGE_SIZE = 20;

type ProductSort = "received" | "margin" | "units" | "growth";
type SkuSort = "received" | "growth" | "margin" | "units" | "code";

const compactMoney = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  notation: "compact",
  maximumFractionDigits: 1,
});
const fullMoney = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  maximumFractionDigits: 0,
});
const compactCount = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function money(value: number | null | undefined, compact = true) {
  return (compact ? compactMoney : fullMoney).format(Number(value) || 0);
}

function count(value: number | null | undefined) {
  return compactCount.format(Number(value) || 0);
}

function percent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "数据不足";
  return `${(value * 100).toFixed(digits)}%`;
}

function growth(current: number | null | undefined, previous: number | null | undefined) {
  if (previous === null || previous === undefined || previous <= 0) return null;
  return (Number(current) || 0) / previous - 1;
}

function safePage(page: number, pageCount: number) {
  return Math.min(page, Math.max(0, pageCount - 1));
}

function ProductArtwork({
  imageUrl,
  productName,
  detail = false,
}: {
  imageUrl?: string | null;
  productName: string;
  detail?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUrl]);

  return (
    <div className={`product-gallery-artwork${detail ? " is-detail" : ""}`}>
      {imageUrl && !failed ? (
        <img
          alt={`${productName} 商品主图`}
          loading="lazy"
          onError={() => setFailed(true)}
          src={imageUrl}
        />
      ) : (
        <div className="product-gallery-placeholder" role="img" aria-label={`${productName} 图片缺失`}>
          <ImageOff aria-hidden="true" size={detail ? 20 : 24} />
          {!detail && <small>暂无可信主图</small>}
        </div>
      )}
    </div>
  );
}

function TrendValue({ value, compact = false }: { value: number | null; compact?: boolean }) {
  if (value === null) {
    return (
      <span className={`product-gallery-trend is-neutral${compact ? " is-compact" : ""}`}>
        <Minus aria-hidden="true" size={12} /> {compact ? "—" : "数据不足"}
      </span>
    );
  }
  const positive = value >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`product-gallery-trend ${positive ? "is-up" : "is-down"}${compact ? " is-compact" : ""}`}>
      <Icon aria-hidden="true" size={12} /> {compact ? "" : "较上期 "}{positive ? "+" : ""}{(value * 100).toFixed(1)}%
    </span>
  );
}

function DrawerMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return (
    <article className={`product-gallery-drawer-metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function ProductGalleryView({ pm }: { pm: ProductManagementPages }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProductSort>("received");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ProductNameOverviewItem | null>(null);
  const [skuQuery, setSkuQuery] = useState("");
  const [skuSort, setSkuSort] = useState<SkuSort>("received");
  const [skuPage, setSkuPage] = useState(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const skusByProduct = useMemo(() => {
    const result = new Map<string, ProductOverviewItem[]>();
    for (const sku of pm.productOverview ?? []) {
      const rows = result.get(sku.productName) ?? [];
      rows.push(sku);
      result.set(sku.productName, rows);
    }
    return result;
  }, [pm.productOverview]);

  const products = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    const rows = (pm.productNameOverview ?? []).filter((product) => {
      if (!normalized) return true;
      if (product.productName.toLocaleLowerCase("zh-CN").includes(normalized)) return true;
      if ((product.spu || "").toLocaleLowerCase("zh-CN").includes(normalized)) return true;
      return (skusByProduct.get(product.productName) ?? []).some((sku) =>
        String(sku.productCode || "").toLocaleLowerCase("zh-CN").includes(normalized),
      );
    });
    const score = (product: ProductNameOverviewItem) => {
      if (sort === "received") return Number(product.receivedAmount) || 0;
      if (sort === "margin") return product.grossMargin ?? Number.NEGATIVE_INFINITY;
      if (sort === "units") return Number(product.salesUnits) || 0;
      return growth(product.receivedAmount, product.prevReceivedAmount) ?? Number.NEGATIVE_INFINITY;
    };
    return rows.sort((a, b) => score(b) - score(a) || a.productName.localeCompare(b.productName, "zh-CN"));
  }, [pm.productNameOverview, query, skusByProduct, sort]);

  const pageCount = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const productPage = safePage(page, pageCount);
  const visibleProducts = products.slice(productPage * PAGE_SIZE, productPage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => setPage(0), [query, sort]);
  useEffect(() => {
    if (page !== productPage) setPage(productPage);
  }, [page, productPage]);

  const selectedSkus = useMemo(() => {
    if (!selected) return [];
    const normalized = skuQuery.trim().toLocaleLowerCase("zh-CN");
    const rows = (skusByProduct.get(selected.productName) ?? []).filter((sku) =>
      !normalized || String(sku.productCode || "").toLocaleLowerCase("zh-CN").includes(normalized),
    );
    const score = (sku: ProductOverviewItem): number | string => {
      if (skuSort === "received") return Number(sku.receivedAmount) || 0;
      if (skuSort === "growth") return growth(sku.receivedAmount, sku.prevReceivedAmount) ?? Number.NEGATIVE_INFINITY;
      if (skuSort === "margin") return sku.grossMargin ?? Number.NEGATIVE_INFINITY;
      if (skuSort === "units") return Number(sku.salesUnits) || 0;
      return String(sku.productCode || "");
    };
    return rows.sort((a, b) => {
      const aValue = score(a);
      const bValue = score(b);
      if (typeof aValue === "string" && typeof bValue === "string") return aValue.localeCompare(bValue, "zh-CN");
      return Number(bValue) - Number(aValue);
    });
  }, [selected, skuQuery, skuSort, skusByProduct]);

  const skuPageCount = Math.max(1, Math.ceil(selectedSkus.length / SKU_PAGE_SIZE));
  const currentSkuPage = safePage(skuPage, skuPageCount);
  const visibleSkus = selectedSkus.slice(currentSkuPage * SKU_PAGE_SIZE, currentSkuPage * SKU_PAGE_SIZE + SKU_PAGE_SIZE);

  useEffect(() => setSkuPage(0), [selected, skuQuery, skuSort]);
  useEffect(() => {
    if (skuPage !== currentSkuPage) setSkuPage(currentSkuPage);
  }, [currentSkuPage, skuPage]);

  function closeDrawer() {
    setSelected(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!selected) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [selected]);

  function openDrawer(product: ProductNameOverviewItem, event: ReactMouseEvent<HTMLButtonElement>) {
    triggerRef.current = event.currentTarget;
    setSkuQuery("");
    setSkuSort("received");
    setSkuPage(0);
    setSelected(product);
  }

  const totalReceived = (pm.productNameOverview ?? []).reduce((sum, product) => sum + (Number(product.receivedAmount) || 0), 0);
  const selectedShare = selected && totalReceived > 0 ? selected.receivedAmount / totalReceived : 0;

  return (
    <section className="product-gallery" data-testid="product-gallery" aria-label="商品画册">
      <header className="product-gallery-intro">
        <div>
          <span className="product-gallery-eyebrow"><Sparkles aria-hidden="true" size={13} /> Product Gallery</span>
          <h2>商品经营画册</h2>
          <p>先看产品规模与变化，再点开逐项核对 SKU；当前周期 {pm.period ? `${pm.period.start} ~ ${pm.period.end}` : "尚未同步"}。</p>
        </div>
        <div className="product-gallery-total">
          <span>产品实收合计</span>
          <strong>{money(totalReceived)}</strong>
          <small>{(pm.productNameOverview ?? []).length.toLocaleString()} 个产品</small>
        </div>
      </header>

      <div className="product-gallery-toolbar" data-ui="filter-bar">
        <label className="product-gallery-search">
          <span>搜索商品</span>
          <Search aria-hidden="true" size={15} />
          <input
            aria-label="搜索产品、SPU 或 SKU"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索产品、SPU 或 SKU"
            type="search"
            value={query}
          />
        </label>
        <label className="product-gallery-sort">
          <span>排序</span>
          <select aria-label="商品画册排序" onChange={(event) => setSort(event.target.value as ProductSort)} value={sort}>
            <option value="received">商家实收 · 从高到低</option>
            <option value="margin">毛利率 · 从高到低</option>
            <option value="units">销量 · 从高到低</option>
            <option value="growth">变化 · 从高到低</option>
          </select>
        </label>
        <div className="product-gallery-result-count" aria-live="polite">
          <span>画册结果</span>
          <strong>{products.length.toLocaleString()}</strong>
          <small>/ {(pm.productNameOverview ?? []).length.toLocaleString()} 个产品</small>
        </div>
      </div>

      {visibleProducts.length ? (
        <div className="product-gallery-grid">
          {visibleProducts.map((product, index) => {
            const productGrowth = growth(product.receivedAmount, product.prevReceivedAmount);
            const skuCount = (skusByProduct.get(product.productName) ?? []).length;
            return (
              <button
                aria-controls="product-gallery-detail"
                aria-haspopup="dialog"
                aria-label={`查看 ${product.productName} 详情，共 ${skuCount} 个 SKU`}
                className="product-gallery-card"
                data-testid="product-card"
                key={product.productName}
                onClick={(event) => openDrawer(product, event)}
                style={{ "--gallery-order": index } as CSSProperties}
                type="button"
              >
                <div className="product-gallery-card-media">
                  <ProductArtwork imageUrl={product.imageUrl} productName={product.productName} />
                  <span className="product-gallery-rank">#{productPage * PAGE_SIZE + index + 1}</span>
                  <TrendValue compact value={productGrowth} />
                </div>
                <div className="product-gallery-card-body">
                  <div className="product-gallery-card-heading">
                    <h3>{product.productName}</h3>
                  </div>
                  <div className="product-gallery-primary-value">
                    <span>商家实收</span>
                    <strong>{money(product.receivedAmount)}</strong>
                  </div>
                  <div className="product-gallery-metric-pair">
                    <div><span>销量</span><b>{count(product.salesUnits)} 件</b></div>
                    <div><span>毛利率</span><b>{percent(product.grossMargin)}</b></div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="product-gallery-empty">
          <Search aria-hidden="true" size={24} />
          <strong>没有找到匹配产品</strong>
          <span>请换一个产品名、SPU 或 SKU 编码。</span>
        </div>
      )}

      {products.length > PAGE_SIZE && (
        <div className="product-gallery-pagination">
          <Pagination onChange={setPage} page={productPage} pageCount={pageCount} total={products.length} />
        </div>
      )}

      {selected && (
        <div
          className="product-gallery-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDrawer();
          }}
          role="presentation"
        >
          <aside
            aria-labelledby="product-gallery-detail-title"
            aria-modal="true"
            className="product-gallery-drawer"
            data-testid="product-detail-drawer"
            id="product-gallery-detail"
            ref={dialogRef}
            role="dialog"
          >
            <header className="product-gallery-drawer-header">
              <div className="product-gallery-drawer-identity">
                <ProductArtwork
                  detail
                  imageUrl={selected.imageUrl}
                  productName={selected.productName}
                />
                <div>
                  <span className="product-gallery-eyebrow">Product Detail</span>
                  <h2 id="product-gallery-detail-title">{selected.productName}</h2>
                  <p>{selected.spu || "未识别 SPU"} · {(skusByProduct.get(selected.productName) ?? []).length.toLocaleString()} 个 SKU</p>
                  <small>{pm.period ? `${pm.period.start} ~ ${pm.period.end}` : "当前筛选周期"}</small>
                </div>
              </div>
              <button aria-label="关闭商品详情" className="product-gallery-close" onClick={closeDrawer} ref={closeButtonRef} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </header>

            <div className="product-gallery-drawer-scroll">
              <section className="product-gallery-drawer-kpis" aria-label="产品总数据">
                <DrawerMetric label="商家实收" value={money(selected.receivedAmount)} detail={`上期 ${selected.prevReceivedAmount == null ? "数据不足" : money(selected.prevReceivedAmount)}`} tone="accent" />
                <DrawerMetric label="毛利率" value={percent(selected.grossMargin)} detail={`毛利额 ${money(selected.grossProfit)}`} tone="neutral" />
                <DrawerMetric label="销量" value={`${count(selected.salesUnits)} 件`} detail={`件单价 ${money(selected.avgUnitPrice)}`} tone="neutral" />
                <DrawerMetric label="实收变化" value={growth(selected.receivedAmount, selected.prevReceivedAmount) == null ? "数据不足" : `${growth(selected.receivedAmount, selected.prevReceivedAmount)! >= 0 ? "+" : ""}${(growth(selected.receivedAmount, selected.prevReceivedAmount)! * 100).toFixed(1)}%`} detail="与等长上期比较" tone={growth(selected.receivedAmount, selected.prevReceivedAmount) != null && growth(selected.receivedAmount, selected.prevReceivedAmount)! < 0 ? "danger" : "success"} />
              </section>

              <section className="product-gallery-drawer-secondary" aria-label="次要指标">
                <div><span>件单价</span><b>{money(selected.avgUnitPrice)}</b></div>
                <div><span>上期实收</span><b>{selected.prevReceivedAmount == null ? "数据不足" : money(selected.prevReceivedAmount)}</b></div>
                <div><span>退货率</span><b>{percent(selected.refundRate)}</b></div>
                <div>
                  <span>实收占比</span><b>{percent(selectedShare, 2)}</b>
                  <span className="product-gallery-drawer-share" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, selectedShare * 100))}%` }} /></span>
                </div>
              </section>

              <section className="product-gallery-sku-section" aria-label="SKU 数据">
                <div className="product-gallery-sku-heading">
                  <div>
                    <span className="product-gallery-eyebrow">SKU Breakdown</span>
                    <h3>SKU 对应数据</h3>
                    <p>产品总数据可由下列 SKU 逐项求和复核；毛利率按各 SKU 成本覆盖实收重算。</p>
                  </div>
                  <strong>{selectedSkus.length.toLocaleString()} SKU</strong>
                </div>
                <div className="product-gallery-sku-toolbar">
                  <label>
                    <Search aria-hidden="true" size={14} />
                    <span>搜索 SKU</span>
                    <input aria-label="搜索 SKU 编码" onChange={(event) => setSkuQuery(event.target.value)} placeholder="搜索 SKU 编码" type="search" value={skuQuery} />
                  </label>
                  <select aria-label="SKU 排序" onChange={(event) => setSkuSort(event.target.value as SkuSort)} value={skuSort}>
                    <option value="received">商家实收</option>
                    <option value="growth">较上期</option>
                    <option value="margin">毛利率</option>
                    <option value="units">销量</option>
                    <option value="code">SKU 编码</option>
                  </select>
                </div>
                <div className="product-gallery-sku-table-wrap">
                  <table data-testid="product-sku-table">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>商家实收</th>
                        <th>较上期</th>
                        <th>毛利率</th>
                        <th>销量</th>
                        <th>占产品比</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSkus.length ? visibleSkus.map((sku) => {
                        const share = selected.receivedAmount > 0 ? sku.receivedAmount / selected.receivedAmount : 0;
                        return (
                          <tr key={sku.productCode}>
                            <td><strong>{sku.productCode}</strong><small>{sku.brand || sku.category || "未分类"}</small></td>
                            <td className="is-received">{money(sku.receivedAmount, false)}</td>
                            <td><TrendValue compact value={growth(sku.receivedAmount, sku.prevReceivedAmount)} /></td>
                            <td className={sku.grossMargin == null ? "is-muted" : "is-margin"}>{percent(sku.grossMargin)}</td>
                            <td className="is-units">{count(sku.salesUnits)} 件</td>
                            <td><div className="product-gallery-table-share"><b>{percent(share, 2)}</b><span><i style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }} /></span></div></td>
                          </tr>
                        );
                      }) : (
                        <tr><td className="product-gallery-sku-empty" colSpan={6}>没有匹配的 SKU 编码</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {selectedSkus.length > SKU_PAGE_SIZE && (
                  <div className="product-gallery-sku-pagination">
                    <Pagination onChange={setSkuPage} page={currentSkuPage} pageCount={skuPageCount} total={selectedSkus.length} />
                  </div>
                )}
              </section>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
