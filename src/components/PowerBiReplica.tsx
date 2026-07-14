import { useEffect, useMemo, useState, type ReactNode } from "react";
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
const countFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const PROMOTION_SUM_FIELDS = ["impressions", "clicks", "spend", "revenue", "carts", "directCarts", "consultations"] as const;

function money(value: number) {
  return `¥${moneyFormat.format((value || 0) / 10_000)}万`;
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

function shortDate(value: string) {
  return value.slice(5);
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

function KpiTile({ label, value, current, previous, note }: { label: string; value: string; current: number; previous: number; note: string }) {
  return (
    <div className="pb-kpi">
      <div className="pb-kpi-label"><span>{label}</span><Delta current={current} previous={previous} /></div>
      <b>{value}</b>
      <small>{note}</small>
    </div>
  );
}

function SourceBar({ pages, dingtalk }: { pages: PowerBiPages; dingtalk: DingTalkSnapshot }) {
  return (
    <div className="pb-source-bar">
      <span><Database size={13} /> PowerBI 本地逻辑 <b>{pages.period?.start} 至 {pages.period?.end}</b></span>
      <span className="is-dingtalk">钉钉经营口径 <b>{dingtalk.period.start} 至 {dingtalk.period.end}</b></span>
      <small>本地源文件 → Polars → DuckDB，无 PowerBI/MCP 运行时依赖</small>
    </div>
  );
}

function PromotionTable({ rows, labelKey }: { rows: PowerBiPromotionDaily[]; labelKey: "scene" | "productId" }) {
  const maxRoi = Math.max(1, ...rows.map((row) => rate(row.revenue, row.spend)));
  const totalSpend = rows.reduce((sum, item) => sum + item.spend, 0);
  return (
    <div className="pb-table-wrap">
      <table className="pb-data-table">
        <thead><tr><th>{labelKey === "scene" ? "推广场景" : "商品"}</th><th>花费</th><th>费用占比</th><th>ROI</th><th>点击</th><th>CTR</th><th>CPC</th><th>加购</th><th>加购率</th><th>加购成本</th><th>直接加购率</th><th>咨询</th></tr></thead>
        <tbody>
          {rows.map((row, index) => {
            const roi = rate(row.revenue, row.spend);
            return (
              <tr key={`${String(row[labelKey])}-${index}`}>
                <td className="pb-row-label">{String(row[labelKey] || "未分类")}</td>
                <td>{money(row.spend)}</td><td>{percent(rate(row.spend, totalSpend))}</td>
                <td><span className="pb-data-bar"><i style={{ width: `${Math.min(100, roi / maxRoi * 100)}%` }} /><b>{roi.toFixed(2)}</b></span></td>
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

function OverallPage({ pages, dingtalk, start, end }: { pages: PowerBiPages; dingtalk: DingTalkSnapshot; start: string; end: string }) {
  const daily = inPeriod(pages.overallDaily, start, end);
  const current = daily.at(-1);
  const previous = daily.at(-2);
  const products = aggregateProductRows(inPeriod(pages.productDaily, start, end));
  const promotionProducts = aggregatePromotion(inPeriod(pages.promotionProductDaily, start, end), "productId");
  const spendByProduct = new Map(promotionProducts.map((item) => [item.productId, item.spend]));
  const fallback = {} as PowerBiOverallDaily;
  const today = current ?? fallback;
  const yesterday = previous ?? fallback;
  const totalSpend = (today.fullSiteSpend || 0) + (today.keywordSpend || 0) + (today.audienceSpend || 0);
  const previousSpend = (yesterday.fullSiteSpend || 0) + (yesterday.keywordSpend || 0) + (yesterday.audienceSpend || 0);

  return (
    <div className="pb-overall-layout">
      <aside className="pb-date-rail">
        <span>当前日期范围</span><b>{start}</b><i>↓</i><b>{end}</b>
        <small>{daily.length} 个可用数据日</small>
      </aside>
      <div className="pb-overall-main">
        <section className="pb-panel-title">店铺基础数据 <small>最新完整日 {current?.date ?? "—"}</small></section>
        <div className="pb-kpi-grid">
          <KpiTile current={today.visitors} label="访客数" note="PowerBI 店铺漏斗" previous={yesterday.visitors} value={number(today.visitors)} />
          <KpiTile current={rate(today.payBuyers, today.visitors)} label="访客支付转化率" note="支付买家 / 访客" previous={rate(yesterday.payBuyers, yesterday.visitors)} value={percent(rate(today.payBuyers, today.visitors))} />
          <KpiTile current={today.addToCart} label="加购人数" note="PowerBI 店铺行为" previous={yesterday.addToCart} value={number(today.addToCart)} />
          <KpiTile current={rate(today.addToCart, today.visitors)} label="加购率" note="加购人数 / 访客" previous={rate(yesterday.addToCart, yesterday.visitors)} value={percent(rate(today.addToCart, today.visitors))} />
          <KpiTile current={totalSpend} label="细分推广花费" note="全站+关键词+人群" previous={previousSpend} value={money(totalSpend)} />
          <KpiTile current={today.bounceRate} label="跳失率" note="流量质量护栏" previous={yesterday.bounceRate} value={percent(today.bounceRate)} />
        </div>
        <section className="pb-panel-title is-fee">推广费比数据 <small>分母为 PowerBI 支付金额，仅用于过程诊断</small></section>
        <div className="pb-fee-grid">
          {[['全站推广费比', today.fullSiteSpend, yesterday.fullSiteSpend], ['关键词推广费比', today.keywordSpend, yesterday.keywordSpend], ['精准人群费比', today.audienceSpend, yesterday.audienceSpend]].map(([label, value, prior]) => (
            <KpiTile current={rate(value as number, today.payAmount)} key={label as string} label={label as string} note="较昨天" previous={rate(prior as number, yesterday.payAmount)} value={percent(rate(value as number, today.payAmount))} />
          ))}
          <div className="pb-dingtalk-context"><span>钉钉经营口径</span><b>{money(dingtalk.totals.netRevenue)}</b><small>筛选期回款额，不从 PowerBI 重算</small></div>
        </div>
      </div>
      <section className="pb-daily-matrix">
        <div className="pb-panel-title">每天核心数据 <small>单位：人 / 元</small></div>
        <div className="pb-table-wrap"><table className="pb-data-table"><thead><tr><th>日期</th><th>访客</th><th>商品访客</th><th>加购</th><th>支付买家</th><th>转化率</th><th>UV价值</th><th>新客占比</th><th>跳失率</th></tr></thead><tbody>{daily.slice(-16).reverse().map((row) => <tr key={row.date}><td>{shortDate(row.date)}</td><td>{number(row.visitors)}</td><td>{number(row.productVisitors)}</td><td>{number(row.addToCart)}</td><td>{number(row.payBuyers)}</td><td>{percent(rate(row.payBuyers, row.visitors))}</td><td>{`¥${rate(row.payAmount, row.visitors).toFixed(2)}`}</td><td>{percent(rate(row.newVisitors, row.newVisitors + row.returningVisitors))}</td><td>{percent(row.bounceRate)}</td></tr>)}</tbody></table></div>
      </section>
      <section className="pb-product-table">
        <div className="pb-panel-title">商品经营明细 <small>Top 30，按支付金额排序</small></div>
        <div className="pb-table-wrap"><table className="pb-data-table"><thead><tr><th>商品</th><th>访客</th><th>支付买家</th><th>转化率</th><th>支付金额</th><th>支付件数</th><th>退款额</th><th>退款占比</th><th>加购</th><th>加购率</th><th>推广花费</th><th>商品费比</th><th>件单价</th></tr></thead><tbody>{products.slice(0, 30).map((row) => { const spend = spendByProduct.get(row.productId) || 0; return <tr key={row.productId}><td className="pb-row-label" title={row.productName}>{row.productName}</td><td>{number(row.visitors)}</td><td>{number(row.payBuyers)}</td><td>{percent(rate(row.payBuyers, row.visitors))}</td><td>{money(row.payAmount)}</td><td>{number(row.paidUnits)}</td><td>{money(row.refund)}</td><td>{percent(rate(row.refund, row.payAmount))}</td><td>{number(row.addToCart)}</td><td>{percent(rate(row.addToCart, row.visitors))}</td><td>{money(spend)}</td><td>{percent(rate(spend, row.payAmount))}</td><td>{`¥${rate(row.payAmount, row.paidUnits).toFixed(0)}`}</td></tr>; })}</tbody></table></div>
      </section>
    </div>
  );
}

function PromotionPage({ pages, start, end }: { pages: PowerBiPages; start: string; end: string }) {
  const sceneRows = aggregatePromotion(inPeriod(pages.promotionSceneDaily, start, end), "scene");
  const productRows = aggregatePromotion(inPeriod(pages.promotionProductDaily, start, end), "productId");
  const products = new Map(pages.products.map((item) => [item.productId, item]));
  const labelledProducts = aggregatePromotion(
    productRows.map((row) => ({ ...row, productId: products.get(row.productId || "")?.merchantCode || row.productId })),
    "productId",
  );
  return <div className="pb-detail-layout"><aside className="pb-date-rail"><span>日期筛选</span><b>{start}</b><i>↓</i><b>{end}</b><small>联动上下两张表</small></aside><main><section className="pb-panel-title">推广计划数据 <small>按场景聚合</small></section><PromotionTable labelKey="scene" rows={sceneRows} /><section className="pb-panel-title is-spaced">商品推广明细 <small>Top 60，按花费排序</small></section><PromotionTable labelKey="productId" rows={labelledProducts} /></main></div>;
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
      <aside className="pb-product-selector"><label><Search size={13} /><input onChange={(event) => setSearch(event.target.value)} placeholder="搜索商品编码" value={search} /></label><div>{filteredProducts.map((row) => { const product = products.get(row.productId || ""); return <button className={selectedProduct === row.productId ? "is-active" : ""} key={row.productId} onClick={() => setSelectedProduct(row.productId || "")} type="button"><span>{product?.merchantCode || row.productId}</span><b>{money(row.spend)}</b><small>{product?.productName || "未匹配商品名称"}</small></button>; })}</div></aside>
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
    <div className="pb-replica-canvas">
      <SourceBar dingtalk={dingtalk} pages={pages} />
      <div className="pb-replica-toolbar">
        <nav>{([{ id: "overall", label: "旗舰店整体", icon: BarChart3 }, { id: "promotion", label: "推广费用明细", icon: Table2 }, { id: "product", label: "商品推广费用", icon: Database }] as const).map((item) => <button className={page === item.id ? "is-active" : ""} key={item.id} onClick={() => setPage(item.id)} type="button"><item.icon size={14} />{item.label}</button>)}</nav>
        <span className="pb-follow-global-date">跟随页面日期：{period.start} 至 {period.end}</span>
      </div>
      <header className="pb-page-heading"><div><small>POWERBI LAYOUT REPLICA</small><h2>{page === "overall" ? "天猫旗舰店整体数据" : page === "promotion" ? "天猫推广费用明细" : "天猫商品推广费用"}</h2></div><span>1280×720 原始比例 · 网页响应式适配</span></header>
      {page === "overall" ? <OverallPage dingtalk={dingtalk} end={period.end} pages={pages} start={period.start} /> : page === "promotion" ? <PromotionPage end={period.end} pages={pages} start={period.start} /> : <ProductPromotionPage end={period.end} pages={pages} start={period.start} />}
    </div>
  );
}

export function PowerBiReplica({ overview, warehouse, dingtalk, period }: PowerBiReplicaProps) {
  const [workspace, setWorkspace] = useState<Workspace>("overview");
  return (
    <section data-testid="powerbi-replica">
      <div className="analytics-workspace-tabs" role="tablist" aria-label="运营数据视图">
        <button aria-selected={workspace === "overview"} className={workspace === "overview" ? "is-active" : ""} onClick={() => setWorkspace("overview")} role="tab" type="button">经营概览</button>
        <button aria-selected={workspace === "diagnosis"} className={workspace === "diagnosis" ? "is-active" : ""} onClick={() => setWorkspace("diagnosis")} role="tab" type="button">增长诊断</button>
      </div>
      {workspace === "overview" ? overview : warehouse?.powerbiPages ? <GrowthDiagnosis dingtalk={dingtalk} globalPeriod={period} warehouse={warehouse} /> : <div className="pb-empty">正在等待 PowerBI 本地数仓快照…</div>}
    </section>
  );
}
