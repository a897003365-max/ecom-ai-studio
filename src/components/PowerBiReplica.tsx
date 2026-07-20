import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { BarChart3, Database, Search, Table2 } from "lucide-react";
import type {
  DingTalkSnapshot,
  PowerBiOverallDaily,
  PowerBiPages,
  PowerBiProductDaily,
  PowerBiPromotionDaily,
  WarehouseSnapshot,
} from "../types/integration";
import { clsx } from "../utils/format";

type Workspace = "overview" | "diagnosis";
type ReplicaPage = "overall" | "promotion" | "product";
type DatePeriod = { start: string; end: string };

interface PowerBiReplicaProps {
  overview: ReactNode;
  warehouse: WarehouseSnapshot | null;
  dingtalk: DingTalkSnapshot;
  period?: DatePeriod | null;
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

function rate(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}

function subsidizedAmount(row: PowerBiOverallDaily) {
  return ((row.payAmount || 0) - (row.refund || 0)) * 0.85;
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

function SourceBar({ pages, dingtalk }: { pages: PowerBiPages; dingtalk: DingTalkSnapshot }) {
  return (
    <div className="pb-source-bar">
      <span><Database size={13} /> 经营数据 <b>{pages.period?.start} 至 {pages.period?.end}</b></span>
      <span className="is-dingtalk">钉钉经营口径 <b>{dingtalk.period.start} 至 {dingtalk.period.end}</b></span>
    </div>
  );
}

function PromotionTable({ rows, labelKey, variant = "default", showProductImages = false }: { rows: PowerBiPromotionDaily[]; labelKey: "scene" | "productId"; variant?: "default" | "product-detail"; showProductImages?: boolean }) {
  const maxFeeRate = Math.max(0.01, ...rows.map((row) => rate(row.spend, row.revenue)));
  const totalSpend = rows.reduce((sum, item) => sum + item.spend, 0);
  const withImages = showProductImages && labelKey === "productId";
  return (
    <div className="pb-table-wrap pb-animated-table">
      <table className={clsx("pb-data-table", variant === "product-detail" && "pb-promotion-product-table")}>
        <thead><tr><th>{labelKey === "scene" ? "推广场景" : "商品"}</th><th>花费</th><th>费用占比</th><th>费比</th><th>点击</th><th>CTR</th><th>CPC</th><th>加购</th><th>加购率</th><th>加购成本</th><th>直接加购率</th><th>咨询</th></tr></thead>
        <tbody>
          {rows.map((row, index) => {
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
  );
}

function OverallPage({ pages, start, end }: { pages: PowerBiPages; start: string; end: string }) {
  const daily = inPeriod(pages.overallDaily, start, end);
  const current = daily.at(-1);
  const previous = daily.at(-2);
  const products = aggregateProductRows(inPeriod(pages.productDaily, start, end));
  const productsById = new Map(pages.products.map((item) => [item.productId, item]));
  const promotionProducts = aggregatePromotion(inPeriod(pages.promotionProductDaily, start, end), "productId");
  const spendByProduct = new Map(promotionProducts.map((item) => [item.productId, item.spend]));
  const promotionSpendByDate = new Map<string, number>();
  inPeriod(pages.promotionSceneDaily, start, end).forEach((row) => {
    promotionSpendByDate.set(row.date, (promotionSpendByDate.get(row.date) || 0) + (row.spend || 0));
  });
  const fallback = {} as PowerBiOverallDaily;
  const today = current ?? fallback;
  const yesterday = previous ?? fallback;
  const totalSpend = promotionSpendByDate.get(today.date) || 0;
  const previousSpend = promotionSpendByDate.get(yesterday.date) || 0;
  const todaySubsidizedAmount = subsidizedAmount(today);
  const previousSubsidizedAmount = subsidizedAmount(yesterday);
  const todayStorePromotionSpend = totalSpend + (today.taokeSpend || 0);
  const previousStorePromotionSpend = previousSpend + (yesterday.taokeSpend || 0);
  const storePromotionRatio = rate(todayStorePromotionSpend, todaySubsidizedAmount);
  const previousStorePromotionRatio = rate(previousStorePromotionSpend, previousSubsidizedAmount);

  return (
    <div className="pb-overall-layout">
      <aside className="pb-date-rail">
        <span>当前日期范围</span><b>{start}</b><i>↓</i><b>{end}</b>
        <small>{daily.length} 个可用数据日</small>
      </aside>
      <div className="pb-overall-main">
        <section className="pb-panel-title">店铺基础数据 <small>最新完整日 {current?.date ?? "—"}</small></section>
        <div className="pb-kpi-grid">
          <KpiTile current={todaySubsidizedAmount} index={0} label="国补后金额(店铺)" note="(支付金额 - 成功退款金额) × 85%" previous={previousSubsidizedAmount} value={moneyPrecise(todaySubsidizedAmount)} />
          <KpiTile current={today.visitors} index={1} label="访客数" note="到店访客" previous={yesterday.visitors} value={number(today.visitors)} />
          <KpiTile current={rate(today.payBuyers, today.visitors)} index={2} label="访客支付转化率" note="支付买家 / 访客" previous={rate(yesterday.payBuyers, yesterday.visitors)} value={percent(rate(today.payBuyers, today.visitors))} />
          <KpiTile current={today.addToCart} index={3} label="加购人数" note="产生加购的访客" previous={yesterday.addToCart} value={number(today.addToCart)} />
          <KpiTile current={rate(today.addToCart, today.visitors)} index={4} label="加购率" note="加购人数 / 访客" previous={rate(yesterday.addToCart, yesterday.visitors)} value={percent(rate(today.addToCart, today.visitors))} />
          <KpiTile current={totalSpend} index={5} label="细分推广花费" note="站内推广花费（不含达人）" previous={previousSpend} value={moneyPrecise(totalSpend)} />
        </div>
        <section className="pb-panel-title is-fee">推广费比数据 <small>按国补后金额计算</small></section>
        <div className="pb-fee-grid">
          <KpiTile current={storePromotionRatio} index={6} label="店铺推广费比" note="站内推广费用 / 国补后金额" previous={previousStorePromotionRatio} value={percent(storePromotionRatio)} />
          {[['全站推广费比', today.fullSiteSpend, yesterday.fullSiteSpend], ['关键词推广费比', today.keywordSpend, yesterday.keywordSpend], ['精准人群费比', today.audienceSpend, yesterday.audienceSpend]].map(([label, value, prior], index) => (
            <KpiTile current={rate(value as number, todaySubsidizedAmount)} index={index + 7} key={label as string} label={label as string} note="较昨天" previous={rate(prior as number, previousSubsidizedAmount)} value={percent(rate(value as number, todaySubsidizedAmount))} />
          ))}
        </div>
      </div>
      <section className="pb-daily-matrix">
        <div className="pb-panel-title">每天核心数据 <small>单位：人 / 元</small></div>
        <div className="pb-table-wrap pb-animated-table"><table className="pb-data-table"><thead><tr><th>日期</th><th>访客</th><th>商品访客</th><th>加购</th><th>支付买家</th><th>转化率</th><th>UV价值</th><th>新客占比</th><th>跳失率</th></tr></thead><tbody>{daily.slice(-16).reverse().map((row, index) => <tr className="pb-table-row" key={row.date} style={{ "--pb-row-delay": `${260 + Math.min(index, 12) * 28}ms` } as CSSProperties}><td>{shortDate(row.date)}</td><td>{number(row.visitors)}</td><td>{number(row.productVisitors)}</td><td>{number(row.addToCart)}</td><td>{number(row.payBuyers)}</td><td>{percent(rate(row.payBuyers, row.visitors))}</td><td>{`¥${rate(row.payAmount, row.visitors).toFixed(2)}`}</td><td>{percent(rate(row.newVisitors, row.newVisitors + row.returningVisitors))}</td><td>{percent(row.bounceRate)}</td></tr>)}</tbody></table></div>
      </section>
      <section className="pb-product-table">
        <div className="pb-panel-title">商品经营明细 <small>Top 30，按支付金额排序</small></div>
        <div className="pb-table-wrap pb-animated-table"><table className="pb-data-table pb-business-product-table"><thead><tr><th>商品</th><th>访客</th><th>支付买家</th><th>转化率</th><th>支付金额</th><th>支付件数</th><th>退款额</th><th>退款占比</th><th>加购</th><th>加购率</th><th>推广花费</th><th>商品费比</th><th>件单价</th></tr></thead><tbody>{products.slice(0, 30).map((row, index) => { const spend = spendByProduct.get(row.productId) || 0; const product = productsById.get(row.productId); const shortName = product?.merchantCode || row.productId || "未匹配商品"; return <tr className="pb-table-row pb-business-product-row" key={row.productId} style={{ "--pb-row-delay": `${300 + Math.min(index, 12) * 32}ms` } as CSSProperties}><td className="pb-row-label pb-product-label" title={row.productName}><ProductThumb alt={row.productName || shortName} size="md" src={product?.imageUrl} /><span>{shortName}</span></td><td>{number(row.visitors)}</td><td>{number(row.payBuyers)}</td><td>{percent(rate(row.payBuyers, row.visitors))}</td><td>{money(row.payAmount)}</td><td>{number(row.paidUnits)}</td><td>{money(row.refund)}</td><td>{percent(rate(row.refund, row.payAmount))}</td><td>{number(row.addToCart)}</td><td>{percent(rate(row.addToCart, row.visitors))}</td><td>{money(spend)}</td><td>{percent(rate(spend, row.payAmount))}</td><td>{`¥${rate(row.payAmount, row.paidUnits).toFixed(0)}`}</td></tr>; })}</tbody></table></div>
      </section>
    </div>
  );
}

function PromotionPage({ pages, start, end }: { pages: PowerBiPages; start: string; end: string }) {
  const sceneRows = aggregatePromotion(inPeriod(pages.promotionSceneDaily, start, end), "scene");
  const productRows = aggregatePromotion(inPeriod(pages.promotionProductDaily, start, end), "productId");
  const products = new Map(pages.products.map((item) => [item.productId, item]));
  const labelledProducts = productRows.map((row) => {
    const product = products.get(row.productId || "");
    return { ...row, displayLabel: product?.merchantCode || row.productId, imageUrl: product?.imageUrl || null };
  });
  return <div className="pb-detail-layout"><aside className="pb-date-rail"><span>日期筛选</span><b>{start}</b><i>↓</i><b>{end}</b><small>联动上下两张表</small></aside><main><section className="pb-panel-title">推广计划数据 <small>按场景聚合</small></section><PromotionTable labelKey="scene" rows={sceneRows} /><section className="pb-panel-title is-spaced">商品推广明细 <small>Top 60，按花费排序 · 图片链接</small></section><PromotionTable labelKey="productId" rows={labelledProducts} showProductImages variant="product-detail" /></main></div>;
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
    <div className="pb-product-promotion-layout">
      <aside className="pb-product-selector"><label><Search size={13} /><input onChange={(event) => setSearch(event.target.value)} placeholder="搜索商品编码" value={search} /></label><div>{filteredProducts.map((row, index) => { const product = products.get(row.productId || ""); const label = product?.merchantCode || row.productId || "未匹配商品"; return <button className={selectedProduct === row.productId ? "is-active" : ""} key={row.productId} onClick={() => setSelectedProduct(row.productId || "")} style={{ "--pb-row-delay": `${140 + Math.min(index, 12) * 30}ms` } as CSSProperties} type="button"><ProductThumb alt={product?.productName || label} src={product?.imageUrl} /><span>{label}</span><b>{money(row.spend)}</b><small>{product?.productName || "未匹配商品名称"}</small></button>; })}</div></aside>
      <main><section className="pb-panel-title">商品推广场景 <small>{products.get(selectedProduct)?.merchantCode || selectedProduct || "请选择商品"}</small></section><PromotionTable labelKey="scene" rows={sceneRows} /><section className="pb-panel-title is-spaced">商品每日推广数据 <small>{start} 至 {end}</small></section><PromotionTable labelKey="productId" rows={dailyRows.map((row) => ({ ...row, productId: shortDate(row.productId || "") }))} /></main>
    </div>
  );
}

function GrowthDiagnosis({ warehouse, dingtalk, globalPeriod }: { warehouse: WarehouseSnapshot; dingtalk: DingTalkSnapshot; globalPeriod?: DatePeriod | null }) {
  const pages = warehouse.powerbiPages;
  const [page, setPage] = useState<ReplicaPage>("overall");
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
    <div className={clsx("pb-replica-canvas", `is-page-${page}`)}>
      <SourceBar dingtalk={dingtalk} pages={pages} />
      <div className="pb-replica-toolbar">
        <nav>{([{ id: "overall", label: "旗舰店整体", icon: BarChart3 }, { id: "promotion", label: "推广费用明细", icon: Table2 }, { id: "product", label: "商品推广费用", icon: Database }] as const).map((item) => <button className={page === item.id ? "is-active" : ""} key={item.id} onClick={() => setPage(item.id)} type="button"><item.icon size={14} />{item.label}</button>)}</nav>
        <span className="pb-follow-global-date">跟随页面日期：{period.start} 至 {period.end}</span>
      </div>
      <header className="pb-page-heading" key={page}><div><h2>{page === "overall" ? "天猫旗舰店整体数据" : page === "promotion" ? "天猫推广费用明细" : "天猫商品推广费用"}</h2></div><span>{period.start} 至 {period.end}</span></header>
      {page === "overall" ? <OverallPage end={period.end} pages={pages} start={period.start} /> : page === "promotion" ? <PromotionPage end={period.end} pages={pages} start={period.start} /> : <ProductPromotionPage end={period.end} pages={pages} start={period.start} />}
    </div>
  );
}

export function PowerBiReplica({ overview, warehouse, dingtalk, period }: PowerBiReplicaProps) {
  const [workspace, setWorkspace] = useState<Workspace>("overview");
  return (
    <section data-testid="powerbi-replica">
      <div className="analytics-workspace-tabs" role="tablist" aria-label="运营数据视图">
        <button aria-selected={workspace === "overview"} className={workspace === "overview" ? "is-active" : ""} onClick={() => setWorkspace("overview")} role="tab" type="button">全渠道总览</button>
        <button aria-selected={workspace === "diagnosis"} className={workspace === "diagnosis" ? "is-active" : ""} onClick={() => setWorkspace("diagnosis")} role="tab" type="button">天猫明细</button>
      </div>
      {workspace === "overview" ? overview : warehouse?.powerbiPages ? <GrowthDiagnosis dingtalk={dingtalk} globalPeriod={period} warehouse={warehouse} /> : <div className="pb-empty">正在等待 PowerBI 本地数仓快照…</div>}
    </section>
  );
}
