import { useViewState } from "../hooks/useViewState";
import { useEffect, useMemo, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { TableShell } from "./TableShell";

export interface SortColumn<T> {
  key: string;
  label: ReactNode;
  render: (row: T, index: number) => ReactNode;
  /** 不提供 sortValue 的列不可排序（如序号列）。 */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right";
}

interface SortableTableProps<T> {
  columns: SortColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  minWidth?: number;
  emptyHint?: string;
  /** 每页行数，默认 15。传 0 关闭分页。 */
  pageSize?: number;
  /** 初始排序列 key（对应某列的 key）。 */
  defaultSortKey?: string;
  /** 初始排序方向，默认 asc。 */
  defaultSortDir?: "asc" | "desc";
}

const DEFAULT_PAGE_SIZE = 15;

export function SortableTable<T>({
  columns,
  rows,
  rowKey,
  minWidth = 920,
  emptyHint,
  pageSize = DEFAULT_PAGE_SIZE,
  defaultSortKey,
  defaultSortDir = "asc",
}: SortableTableProps<T>) {
  const [sortKey, setSortKey] = useViewState<string | null>("sortable.sort", defaultSortKey ?? null);
  const [dir, setDir] = useViewState<"asc" | "desc">("sortable.direction", defaultSortDir);
  const [page, setPage] = useViewState("sortable.page", 0, { resetOnFilterChange: true });

  function toggle(key: string) {
    if (sortKey === key) {
      setDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir("asc");
    }
    setPage(0); // 排序变化回到第 1 页
  }

  const sortableCols = columns.filter((c) => c.sortValue);
  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = sortableCols.find((c) => c.key === sortKey);
    if (!col || !col.sortValue) return rows;
    const getter = col.sortValue;
    return [...rows].sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, dir]);

  const paginate = pageSize > 0 && sorted.length > pageSize;
  const pageCount = paginate ? Math.ceil(sorted.length / pageSize) : 1;
  const safePage = Math.min(page, pageCount - 1);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage, setPage]);
  const visible = paginate ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted;
  const baseIndex = paginate ? safePage * pageSize : 0;
  const columnClass = (index: number) => columns[0]?.key === "rank" ? ["product-rank-cell", "product-identity-cell"][index] : undefined;

  return (
    <>
      <TableShell minWidth={minWidth}>
        <thead>
          <tr>
            {columns.map((col, columnIndex) => {
              if (!col.sortValue) {
                return <th className={columnClass(columnIndex)} key={col.key} style={{ textAlign: col.align ?? "left" }}>{col.label}</th>;
              }
              const active = sortKey === col.key;
              const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th className={columnClass(columnIndex)} key={col.key} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} style={{ textAlign: col.align ?? "left" }}>
                  <button className="th-sort" onClick={() => toggle(col.key)} type="button">
                    <span>{col.label}</span>
                    <Icon aria-hidden="true" className={active ? "th-sort-active" : "th-sort-idle"} size={12} strokeWidth={2} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && emptyHint ? (
            <tr>
              <td className="py-6 text-center text-[var(--muted)]" colSpan={columns.length}>{emptyHint}</td>
            </tr>
          ) : (
            visible.map((row, index) => (
              <tr key={rowKey(row)}>
                {columns.map((col, columnIndex) => (
                  <td className={columnClass(columnIndex)} key={col.key} style={{ textAlign: col.align ?? "left" }}>{col.render(row, baseIndex + index)}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </TableShell>
      {paginate && (
        <Pagination page={safePage} pageCount={pageCount} total={sorted.length} onChange={setPage} />
      )}
    </>
  );
}

export function Pagination({ page, pageCount, total, onChange }: { page: number; pageCount: number; total: number; onChange: (p: number) => void }) {
  const pages = pageNumbers(page, pageCount);
  const btn = "inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-[12px] border border-[var(--border-2)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--bg-elevated)]";
  return (
    <div className="product-pagination mt-3 flex items-center justify-between gap-3 text-[12px] text-[var(--muted)]">
      <span className="product-pagination-summary">共 {total.toLocaleString()} 行 · 第 {page + 1}/{pageCount} 页</span>
      <div className="product-pagination-controls flex items-center gap-1">
        <button type="button" className={`${btn} product-pagination-extra`} disabled={page === 0} onClick={() => onChange(0)} aria-label="首页"><ChevronsLeft size={14} /></button>
        <button type="button" className={btn} disabled={page === 0} onClick={() => onChange(page - 1)} aria-label="上一页"><ChevronLeft size={14} /></button>
        <span className="product-pagination-mobile hidden" aria-live="polite">{page + 1} / {pageCount}</span>
        {pages.map((p, i) =>
          p === -1 ? (
            <span key={`gap${i}`} className="product-pagination-extra px-1">…</span>
          ) : (
            <button
              key={p}
              type="button"
              className={`${btn} product-pagination-extra ${p === page ? "bg-[var(--brand)] text-[var(--bg)] border-[var(--brand)] font-semibold" : ""}`}
              aria-current={p === page ? "page" : undefined}
              onClick={() => onChange(p)}
            >
              {p + 1}
            </button>
          ),
        )}
        <button type="button" className={btn} disabled={page === pageCount - 1} onClick={() => onChange(page + 1)} aria-label="下一页"><ChevronRight size={14} /></button>
        <button type="button" className={`${btn} product-pagination-extra`} disabled={page === pageCount - 1} onClick={() => onChange(pageCount - 1)} aria-label="末页"><ChevronsRight size={14} /></button>
      </div>
    </div>
  );
}

/** 生成页码序列，超过 7 页时用 -1 表示省略号。 */
function pageNumbers(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const pages = new Set<number>([0, total - 1, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 0 && p < total).sort((a, b) => a - b);
  const result: number[] = [];
  let prev = -1;
  for (const p of sorted) {
    if (p - prev > 1) result.push(-1);
    result.push(p);
    prev = p;
  }
  return result;
}
