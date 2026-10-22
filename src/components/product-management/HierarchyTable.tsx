import { useViewState } from "../../hooks/useViewState";
import { useEffect, useMemo, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight } from "lucide-react";
import { TableShell } from "../TableShell";
import { Pagination, type SortColumn } from "../SortableTable";

export interface HierarchyTableRow {
  key: string;
  name: string;
  hasChildren: boolean;
  children?: HierarchyTableRow[];
}

interface HierarchyTableProps<T extends HierarchyTableRow> {
  columns: SortColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** 哪一列承载名称（展开控件注入此列）。 */
  nameColumnKey: string;
  minWidth?: number;
  pageSize?: number;
  /** 默认是否全部展开，默认 false（全部收起，与折叠矩阵表一致）。 */
  defaultExpanded?: boolean;
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  emptyHint?: string;
  /** 序号列 key，子行渲染为占位点。默认 "rank"。 */
  rankColumnKey?: string;
}

const DEFAULT_PAGE_SIZE = 15;

export function HierarchyTable<T extends HierarchyTableRow>({
  columns,
  rows,
  rowKey,
  nameColumnKey,
  minWidth = 920,
  pageSize = DEFAULT_PAGE_SIZE,
  defaultExpanded = false,
  defaultSortKey,
  defaultSortDir = "asc",
  emptyHint,
  rankColumnKey = "rank",
}: HierarchyTableProps<T>) {
  const [sortKey, setSortKey] = useViewState<string | null>("HierarchyTable.sortKey", defaultSortKey ?? null);
  const [dir, setDir] = useViewState<"asc" | "desc">("HierarchyTable.dir", defaultSortDir);
  const [page, setPage] = useViewState("HierarchyTable.page", 0, { resetOnFilterChange: true });
  const [expanded, setExpanded] = useViewState<Set<string>>("HierarchyTable.expanded",
    () => (defaultExpanded ? new Set(rows.filter((r) => r.hasChildren && r.children?.length).map((r) => rowKey(r))) : new Set())
  );

  function toggleSort(key: string) {
    if (sortKey === key) {
      setDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir("asc");
    }
    setPage(0);
  }

  function toggleRow(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    const valid = new Set(rows.filter((r) => r.hasChildren && r.children?.length).map((r) => rowKey(r)));
    setExpanded((previous) => {
      const next = new Set([...previous].filter((key) => valid.has(key)));
      return next.size === previous.size ? previous : next;
    });
  }, [rows, setExpanded]);

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

  const expandableCount = rows.filter((r) => r.hasChildren && r.children?.length).length;
  const allExpanded = expandableCount > 0 && expanded.size >= expandableCount;

  function nameCell(col: SortColumn<T>, row: T, index: number, isChild: boolean, isOpen: boolean) {
    return (
      <span className="hier-name">
        {row.hasChildren ? (
          <button
            type="button"
            className="hier-toggle"
            aria-label={isOpen ? "收起" : "展开"}
            onClick={(e) => {
              e.stopPropagation();
              toggleRow(rowKey(row));
            }}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : isChild ? (
          <span className="hier-bullet" aria-hidden="true" />
        ) : (
          <span className="hier-spacer" aria-hidden="true" />
        )}
        <span className={isChild ? "hier-label hier-child" : "hier-label"}>{col.render(row, index)}</span>
      </span>
    );
  }

  function renderCell(col: SortColumn<T>, row: T, index: number, isChild: boolean, isOpen: boolean): ReactNode {
    if (col.key === nameColumnKey) return nameCell(col, row, index, isChild, isOpen);
    if (isChild && col.key === rankColumnKey) {
      return <span className="text-[var(--muted)]">·</span>;
    }
    return col.render(row, index);
  }

  return (
    <>
      {expandableCount > 0 && (
        <div className="mb-2 flex items-center gap-2 text-[12px]">
          <button
            type="button"
            className="text-[var(--brand)] hover:underline"
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(rows.filter((r) => r.hasChildren && r.children?.length).map((r) => rowKey(r))))}
          >
            {allExpanded ? "收起全部" : "展开全部"}
          </button>
          <span className="text-[var(--muted)]">· 共 {expandableCount} 个可展开产品</span>
        </div>
      )}
      <TableShell minWidth={minWidth}>
        <thead>
          <tr>
            {columns.map((col) => {
              if (!col.sortValue) {
                return <th key={col.key} style={{ textAlign: col.align ?? "left" }}>{col.label}</th>;
              }
              const active = sortKey === col.key;
              const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th key={col.key} style={{ textAlign: col.align ?? "left" }}>
                  <button className="th-sort" onClick={() => toggleSort(col.key)} type="button">
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
            visible.map((row, index) => {
              const isOpen = expanded.has(rowKey(row));
              const block: ReactNode[] = [
                <tr key={rowKey(row)} className={row.hasChildren ? "hier-parent" : ""}>
                  {columns.map((col) => (
                    <td key={col.key} style={{ textAlign: col.align ?? "left" }}>
                      {renderCell(col, row, baseIndex + index, false, isOpen)}
                    </td>
                  ))}
                </tr>,
              ];
              if (isOpen && row.children) {
                for (const child of row.children as T[]) {
                  block.push(
                    <tr key={rowKey(child)} className="hier-child-row">
                      {columns.map((col) => (
                        <td key={col.key} style={{ textAlign: col.align ?? "left" }}>
                          {renderCell(col, child as T, 0, true, false)}
                        </td>
                      ))}
                    </tr>
                  );
                }
              }
              return block;
            })
          )}
        </tbody>
      </TableShell>
      {paginate && (
        <Pagination page={safePage} pageCount={pageCount} total={sorted.length} onChange={setPage} />
      )}
    </>
  );
}
