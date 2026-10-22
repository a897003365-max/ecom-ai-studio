import { Pagination } from "../SortableTable";
import { useViewState } from "../../hooks/useViewState";
// 通用矩阵表组件 · 渲染 ProductMatrix 结构
// 支持排序、分页、进度条、百分比/数量格式
import { useEffect, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableShell } from "../TableShell";
import type { ProductMatrix } from "../../types/integration";

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

interface MatrixTableProps {
  matrix: ProductMatrix;
  rowHeader: string;
  minWidth: number;
  pageSize?: number;
  valueFormat?: "count" | "percent";
}

export function MatrixTable({ matrix, rowHeader, minWidth, pageSize = 0, valueFormat = "count" }: MatrixTableProps) {
  const [sortKey, setSortKey] = useViewState<string | null>("MatrixTable.sortKey", null);
  const [dir, setDir] = useViewState<"asc" | "desc">("MatrixTable.dir", "asc");
  const [page, setPage] = useViewState("MatrixTable.page", 0, { resetOnFilterChange: true });

  const currentPage = Math.min(page, Math.max(0, pageSize > 0 ? Math.ceil(matrix.rows.length / pageSize) - 1 : 0));
  useEffect(() => { if (page !== currentPage) setPage(currentPage); }, [page, currentPage, setPage]);

  if (!matrix.rows.length) {
    return (
      <TableShell minWidth={minWidth}>
        <tbody>
          <tr>
            <td className="py-6 text-center text-[var(--muted)]">当前筛选范围没有匹配数据，请调整筛选；数据覆盖范围请查看页面提示。</td>
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
    setPage(0);
  }

  const valueOf = (r: ProductMatrix["rows"][number], k: string): string | number => {
    if (k === "rowKey") return r.rowKey;
    const v = k === "total" ? r.total : r.values[k];
    return v ?? 0;
  };

  const sorted = sortKey
    ? [...matrix.rows].sort((a, b) => {
        const av = valueOf(a, sortKey);
        const bv = valueOf(b, sortKey);
        if (av < bv) return dir === "asc" ? -1 : 1;
        if (av > bv) return dir === "asc" ? 1 : -1;
        return 0;
      })
    : matrix.rows;

  const paginate = pageSize > 0 && sorted.length > pageSize;
  const pageCount = paginate ? Math.ceil(sorted.length / pageSize) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visible = paginate ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted;

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
          {visible.map((row) => (
            <tr className="matrix-row" key={row.rowKey}>
              <td className="font-semibold">{row.rowKey}</td>
              {matrix.columns.map((col) => {
                const val = row.values[col] || 0;
                return (
                  <td className="matrix-value-cell" key={col}>
                    <span className={val != null && val > 0 ? "matrix-value" : "text-[var(--muted-2)]"}>{val != null && val > 0 ? (valueFormat === "percent" ? percent(val) : count(val)) : "-"}</span>
                    {val != null && val > 0 && <MatrixProgress value={val} max={sharedMax} />}
                  </td>
                );
              })}
              <td className="matrix-total-cell">{row.total != null ? (valueFormat === "percent" ? percent(row.total) : count(row.total)) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      {paginate && (
        <Pagination page={safePage} pageCount={pageCount} total={sorted.length} onChange={setPage} />
      )}
    </div>
  );
}