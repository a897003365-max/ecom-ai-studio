import { useMemo, useState } from "react";
import { clsx } from "../utils/format";

interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onChange: (page: number) => void;
}

/** 表格分页栏：总条数 <= pageSize 时不渲染。 */
export function Pagination({ total, page, pageSize, onChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  // 页码窗口：当前页 ±2，首尾始终可见
  const nums: number[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 2) nums.push(p);
  }
  const withGaps: Array<number | "…"> = [];
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] - nums[i - 1] > 1) withGaps.push("…");
    withGaps.push(nums[i]);
  }
  return (
    <div className="flex items-center justify-between gap-2 px-1 pt-3 text-xs text-[var(--muted)]">
      <span>共 {total} 条 · 第 {page}/{pages} 页</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn !px-2 !py-1 text-xs"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          ‹ 上一页
        </button>
        {withGaps.map((n, i) =>
          n === "…" ? (
            <span key={`gap-${i}`} className="px-1">…</span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={clsx(
                "min-w-7 rounded px-2 py-1 font-mono tabular-nums transition-colors",
                n === page
                  ? "bg-[var(--green)]/20 text-[var(--green)] font-bold"
                  : "hover:bg-white/[0.06]",
              )}
            >
              {n}
            </button>
          ),
        )}
        <button
          type="button"
          className="btn !px-2 !py-1 text-xs"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          下一页 ›
        </button>
      </div>
    </div>
  );
}

/** 表格分页 hook：返回当前页切片 + 分页栏 props。pageSize 默认 15。 */
export function usePaged<T>(items: T[], pageSize = 15) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pages);
  const slice = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  );
  return { slice, page: safePage, pages, total: items.length, pageSize, setPage };
}
