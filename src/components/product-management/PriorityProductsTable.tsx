// 商品变化指挥中心 · 重点商品数据表
import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { money, percent, count } from "./useProductSummary";
import type { ProductRow } from "./useProductSummary";
import type { ProductMatrix } from "../../types/integration";
import { Pagination } from "../SortableTable";

const PAGE_SIZE = 15;

type SortDir = "asc" | "desc";

interface ColDef {
  key: string;
  label: string;
  sortValue: (row: ProductRow) => string | number;
}

// 全部数据列均可排序；序号列（#）为当前排序下的排名，不参与排序。
const COLUMNS: ColDef[] = [
  { key: "name", label: "商品", sortValue: (r) => r.name },
  { key: "channel", label: "主渠道", sortValue: (r) => r.channel },
  { key: "received", label: "商家实收", sortValue: (r) => r.received },
  { key: "prev", label: "上期", sortValue: (r) => r.prev ?? Number.NEGATIVE_INFINITY },
  { key: "share", label: "净销售额占比", sortValue: (r) => r.share },
  { key: "units", label: "销量", sortValue: (r) => r.units },
  { key: "refundRate", label: "退货率", sortValue: (r) => r.refundRate ?? Number.NEGATIVE_INFINITY },
  { key: "growth", label: "变化判断", sortValue: (r) => r.growth ?? Number.NEGATIVE_INFINITY },
];

interface ProductMatrixLookup {
  [productName: string]: { [channel: string]: number };
}

function buildMatrixLookup(matrix: ProductMatrix): ProductMatrixLookup {
  const lookup: ProductMatrixLookup = {};
  for (const row of matrix.rows) {
    const productName = row.rowKey;
    const channels: { [channel: string]: number } = {};
    for (const col of matrix.columns) {
      channels[col] = row.values[col] || 0;
    }
    lookup[productName] = channels;
  }
  return lookup;
}

export function PriorityProductsTable({
  rows,
  currentPeriod,
  previousPeriod,
  productChannelMatrix,
  productChannelRevenueMatrix,
  productChannelRefundMatrix,
}: {
  rows: ProductRow[];
  currentPeriod: { start: string; end: string } | null;
  previousPeriod: { start: string; end: string } | null;
  productChannelMatrix: ProductMatrix;
  productChannelRevenueMatrix: ProductMatrix;
  productChannelRefundMatrix: ProductMatrix;
}) {
  const [sortKey, setSortKey] = useState<string>("received");
  const [dir, setDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const unitLookup = useMemo(() => buildMatrixLookup(productChannelMatrix), [productChannelMatrix]);
  const revenueLookup = useMemo(() => buildMatrixLookup(productChannelRevenueMatrix), [productChannelRevenueMatrix]);
  const refundLookup = useMemo(() => buildMatrixLookup(productChannelRefundMatrix), [productChannelRefundMatrix]);

  const allChannels = useMemo(() => {
    const set = new Set<string>();
    for (const m of [productChannelMatrix, productChannelRevenueMatrix, productChannelRefundMatrix]) {
      for (const col of m.columns) set.add(col);
    }
    return Array.from(set);
  }, [productChannelMatrix, productChannelRevenueMatrix, productChannelRefundMatrix]);

  function toggleExpanded(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggle(key: string) {
    if (sortKey === key) {
      setDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir("asc");
    }
    setPage(0);
  }

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (!col) return rows;
    const getter = col.sortValue;
    return [...rows].sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, sortKey, dir]);

  const paginate = sorted.length > PAGE_SIZE;
  const pageCount = paginate ? Math.ceil(sorted.length / PAGE_SIZE) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visible = paginate ? sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE) : sorted;
  const baseIndex = paginate ? safePage * PAGE_SIZE : 0;

  return (
    <>
      {(currentPeriod || previousPeriod) && (
        <p className="mb-2 text-[10.5px] text-[var(--muted-2)]" style={{ fontVariantNumeric: "tabular-nums" }}>
          {currentPeriod && (
            <>本期 <b className="font-semibold text-[var(--text)]">{currentPeriod.start} ~ {currentPeriod.end}</b></>
          )}
          {currentPeriod && previousPeriod && <span className="mx-2 text-[var(--border-2)]">·</span>}
          {previousPeriod && (
            <>上期 <b className="font-semibold text-[var(--text)]">{previousPeriod.start} ~ {previousPeriod.end}</b></>
          )}
        </p>
      )}
      <article className="panel product-panel">
      <header className="panel-head">
        <div>
          <span className="panel-kicker">Priority Products</span>
          <h2>重点商品数据</h2>
        </div>
        <span className="mini-chip">{rows.length} 个商品</span>
      </header>
      <div className="table-wrap">
        <table className="priority-products-table" aria-label="重点商品数据明细">
          <thead>
            <tr>
              <th>#</th>
              {COLUMNS.map((col) => {
                const active = sortKey === col.key;
                const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th key={col.key}>
                    <button className="th-sort" type="button" onClick={() => toggle(col.key)}>
                      <span>{col.label}</span>
                      <Icon aria-hidden="true" className={active ? "th-sort-active" : "th-sort-idle"} size={12} strokeWidth={2} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={COLUMNS.length + 1} style={{ textAlign: "center", color: "var(--muted)", padding: "32px" }}>当前筛选下暂无重点商品</td></tr>
            ) : visible.map((row, index) => {
              const refundGood = row.refundRate == null ? null : row.refundRate < 0.1;
              const isExpanded = expanded.has(row.name);
              const channelUnits = unitLookup[row.name];
              const channelRevenue = revenueLookup[row.name];
              const channelRefund = refundLookup[row.name];
              const hasChannelData = channelUnits && allChannels.some((c) => (channelUnits[c] || 0) > 0);
              return (
                <Fragment key={`${row.name}-${baseIndex + index}`}>
                  <tr>
                    <td>{baseIndex + index + 1}</td>
                    <td>
                      {hasChannelData ? (
                        <button type="button" className="priority-hierarchy-toggle" onClick={() => toggleExpanded(row.name)} aria-label={isExpanded ? "收起渠道数据" : "展开渠道数据"} aria-expanded={isExpanded}>
                          <span aria-hidden="true" className="priority-hierarchy-icon">{isExpanded ? "−" : "+"}</span>
                          <span className="product-name">{row.name}<small>{row.spu}</small></span>
                        </button>
                      ) : (
                        <span className="priority-hierarchy-leaf">
                          <span aria-hidden="true" className="priority-hierarchy-spacer" />
                          <span className="product-name">{row.name}<small>{row.spu}</small></span>
                        </span>
                      )}
                    </td>
                    <td><span className="platform-badge">{row.channel}</span></td>
                    <td className="amount">{money(row.received)}</td>
                    <td className="amount">{row.prev != null ? money(row.prev) : "-"}</td>
                    <td>{percent(row.share, 1)}</td>
                    <td>{count(row.units)}</td>
                    <td className={refundGood == null ? "" : refundGood ? "status-good" : "status-risk"}>
                      {percent(row.refundRate, 2)}
                    </td>
                    <td>
                      <span className={`delta ${row.growth == null ? "flat" : row.growth >= 0 ? "good" : "bad"}`}>
                        {row.growth == null ? "-" : `${row.growth >= 0 ? "增长" : "下滑"} ${percent(row.growth, 1)}`}
                      </span>
                    </td>
                  </tr>
                  {isExpanded && hasChannelData && (
                    <tr className="priority-channel-row">
                      <td colSpan={COLUMNS.length + 1} style={{ padding: 0 }}>
                        <table className="priority-channel-table">
                          <thead>
                            <tr>
                              <th>渠道平台</th>
                              <th style={{ textAlign: "right" }}>销量</th>
                              <th style={{ textAlign: "right" }}>商家实收</th>
                              <th style={{ textAlign: "right" }}>退货金额</th>
                              <th style={{ textAlign: "right" }}>退货率</th>
                              <th style={{ textAlign: "right" }}>占比</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allChannels.filter((c) => (channelUnits?.[c] || 0) > 0).map((channel) => {
                              const units = channelUnits?.[channel] || 0;
                              const revenue = channelRevenue?.[channel] || 0;
                              const refund = channelRefund?.[channel] || 0;
                              const rate = revenue > 0 ? refund / revenue : 0;
                              const totalUnits = allChannels.reduce((s, c) => s + (channelUnits?.[c] || 0), 0);
                              const share = totalUnits > 0 ? units / totalUnits : 0;
                              return (
                                <tr key={channel}>
                                  <td><span className="platform-badge" style={{ fontSize: "11px" }}>{channel}</span></td>
                                  <td style={{ textAlign: "right" }}>{count(units)}</td>
                                  <td style={{ textAlign: "right" }}>{money(revenue)}</td>
                                  <td style={{ textAlign: "right" }}>{money(refund)}</td>
                                  <td style={{ textAlign: "right" }}>{percent(rate, 2)}</td>
                                  <td style={{ textAlign: "right" }}>{percent(share, 1)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {paginate && (
        <Pagination page={safePage} pageCount={pageCount} total={sorted.length} onChange={setPage} />
      )}
      </article>
    </>
  );
}