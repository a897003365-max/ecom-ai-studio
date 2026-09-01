// 产品名称 × 订单状态销售数量（全量）· 可折叠层级矩阵
// 父行 = 产品名称（默认收起，合计 = 子名称之和）；展开后子行 = 子名称（主键）。
// 列（已发货 / 待发货 / …）与数据（销售数量）与扁平矩阵一致，沿用 MatrixTable 视觉语言。
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { TableShell } from "../TableShell";
import type { ProductStatusChildRow, ProductStatusHierarchy } from "../../types/integration";

const compactNumber = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });

function count(value: number | null | undefined) {
  return compactNumber.format(value || 0);
}

function percent(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(digits)}%`;
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

interface ProductStatusHierarchyTableProps {
  hierarchy: ProductStatusHierarchy;
  rowHeader: string;
  minWidth: number;
  pageSize?: number;
  valueFormat?: "count" | "percent";
}

export function ProductStatusHierarchyTable({
  hierarchy,
  rowHeader,
  minWidth,
  pageSize = 0,
  valueFormat = "count",
}: ProductStatusHierarchyTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  // 默认全部收起：只显示产品名称父行
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 兼容旧快照/未同步场景：字段缺失时退化为空表，避免整页渲染崩溃（白屏）
  const safeHierarchy: ProductStatusHierarchy = hierarchy ?? { columns: [], rows: [] };
  const rows = safeHierarchy.rows;

  // 全表统一量尺：父行 + 子行所有单元格
  const sharedMax = useMemo(() => {
    let m = 1;
    for (const r of rows) {
      for (const c of safeHierarchy.columns) m = Math.max(m, r.values[c] || 0);
      if (r.hasChildren) for (const ch of r.children) for (const c of safeHierarchy.columns) m = Math.max(m, ch.values[c] || 0);
    }
    return m;
  }, [rows, safeHierarchy.columns]);

  function toggleSort(k: string) {
    if (sortKey === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setDir("asc"); }
  }

  type Sortable = { values: Record<string, number | null>; total: number | null; productName?: string; subName?: string };
  function sortValueOf(row: Sortable, k: string): number | string {
    if (k === "rowKey") return row.productName ?? row.subName ?? "";
    if (k === "total") return row.total ?? 0;
    return row.values[k] ?? 0;
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = sortValueOf(a, sortKey) as number | string;
      const bv = sortValueOf(b, sortKey) as number | string;
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, dir]);

  const paginate = pageSize > 0 && sorted.length > pageSize;
  const pageCount = paginate ? Math.ceil(sorted.length / pageSize) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visible = paginate ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted;

  function cell(val: number | null | undefined) {
    const has = val != null && val > 0;
    return (
      <td className="matrix-value-cell">
        <span className={has ? "matrix-value" : "text-[var(--muted-2)]"}>
          {has ? (valueFormat === "percent" ? percent(val) : count(val)) : "-"}
        </span>
        {has && <MatrixProgress value={val as number} max={sharedMax} />}
      </td>
    );
  }

  function Th({ k, children }: { k: string; children: ReactNode }) {
    const active = sortKey === k;
    const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th>
        <button className="th-sort" onClick={() => toggleSort(k)} type="button">
          <span>{children}</span>
          <Icon aria-hidden="true" className={active ? "th-sort-active" : "th-sort-idle"} size={12} strokeWidth={2} />
        </button>
      </th>
    );
  }

  function totalCell(val: number | null | undefined) {
    return (
      <td className="matrix-total-cell">
        {val != null ? (valueFormat === "percent" ? percent(val) : count(val)) : "-"}
      </td>
    );
  }

  function toggleRow(pname: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pname)) next.delete(pname);
      else next.add(pname);
      return next;
    });
  }

  // 子行排序：跟随父级排序列（状态/总计），否则保持按子行总计降序
  function sortChildren(children: ProductStatusChildRow[]): ProductStatusChildRow[] {
    if (!sortKey || sortKey === "rowKey") return children;
    const arr = [...children];
    arr.sort((a, b) => {
      const av = sortValueOf(a, sortKey) as number | string;
      const bv = sortValueOf(b, sortKey) as number | string;
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }

  if (!rows.length) {
    return (
      <TableShell minWidth={minWidth} dataUi="product-status-hierarchy">
        <tbody>
          <tr>
            <td className="py-6 text-center text-[var(--muted)]">暂无数据</td>
          </tr>
        </tbody>
      </TableShell>
    );
  }

  return (
    <div className="matrix-table-wrap">
      <div className="matrix-scale-note" data-testid="matrix-shared-scale">
        <span>统一量尺</span>
        <span>进度条按全表最大单元格 {count(sharedMax)} 相对显示 · 点击产品名称左侧箭头展开子名称</span>
      </div>
      <TableShell minWidth={minWidth} dataUi="product-status-hierarchy">
        <thead>
          <tr>
            <Th k="rowKey">{rowHeader}</Th>
            {safeHierarchy.columns.map((col) => (<Th key={col} k={col}>{col}</Th>))}
            <Th k="total">总计</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const isOpen = expanded.has(row.productName);
            const childRows = row.hasChildren ? sortChildren(row.children) : [];
            const expandable = row.hasChildren;
            return (
              <Fragment key={row.productName}>
                <tr className="matrix-row">
                  <td className="font-semibold">
                    <span className="flex items-center gap-1">
                      {expandable ? (
                        <button
                          type="button"
                          className="matrix-expand-btn"
                          aria-expanded={isOpen}
                          aria-label={isOpen ? `收起 ${row.productName}` : `展开 ${row.productName}`}
                          onClick={() => toggleRow(row.productName)}
                        >
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      ) : (
                        <span className="matrix-expand-spacer" aria-hidden="true" />
                      )}
                      <span className="truncate" title={row.productName}>{row.productName}</span>
                    </span>
                  </td>
                  {safeHierarchy.columns.map((col) => cell(row.values[col]))}
                  {totalCell(row.total)}
                </tr>
                {expandable && isOpen && childRows.map((ch) => (
                  <tr className="matrix-row matrix-row-child" key={`${row.productName}::__${ch.subName}`}>
                    <td className="font-medium text-[var(--muted)]">
                      <span className="flex items-center gap-1.5" style={{ paddingLeft: 22 }}>
                        <span className="matrix-child-dot" aria-hidden="true" />
                        {ch.subName ? ch.subName : "（无子名称）"}
                      </span>
                    </td>
                    {safeHierarchy.columns.map((col) => cell(ch.values[col]))}
                    {totalCell(ch.total)}
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </TableShell>
      {paginate && (
        <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-[var(--muted)]">
          <span>共 {sorted.length.toLocaleString()} 个产品 · 第 {safePage + 1}/{pageCount} 页</span>
          <div className="flex items-center gap-1">
            <button type="button" className="matrix-page-btn" disabled={safePage === 0} onClick={() => setPage(0)} aria-label="首页"><ChevronsLeft size={14} /></button>
            <button type="button" className="matrix-page-btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="上一页"><ChevronLeft size={14} /></button>
            <span className="px-1 font-medium text-[var(--text)]">{safePage + 1} / {pageCount}</span>
            <button type="button" className="matrix-page-btn" disabled={safePage === pageCount - 1} onClick={() => setPage(safePage + 1)} aria-label="下一页"><ChevronRight size={14} /></button>
            <button type="button" className="matrix-page-btn" disabled={safePage === pageCount - 1} onClick={() => setPage(pageCount - 1)} aria-label="末页"><ChevronsRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
