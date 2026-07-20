import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
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
}

export function SortableTable<T>({ columns, rows, rowKey, minWidth = 920, emptyHint }: SortableTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  function toggle(key: string) {
    if (sortKey === key) {
      setDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir("asc");
    }
  }

  const sortableCols = columns.filter((c) => c.sortValue);
  const sorted = sortKey
    ? [...rows].sort((a, b) => {
        const col = sortableCols.find((c) => c.key === sortKey);
        if (!col || !col.sortValue) return 0;
        const av = col.sortValue(a);
        const bv = col.sortValue(b);
        if (av < bv) return dir === "asc" ? -1 : 1;
        if (av > bv) return dir === "asc" ? 1 : -1;
        return 0;
      })
    : rows;

  return (
    <TableShell minWidth={minWidth}>
      <thead>
        <tr>
          {columns.map((col) => {
            if (!col.sortValue) {
              return <th key={col.key} style={col.align === "right" ? { textAlign: "right" } : undefined}>{col.label}</th>;
            }
            const active = sortKey === col.key;
            const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
            return (
              <th key={col.key} style={col.align === "right" ? { textAlign: "right" } : undefined}>
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
          sorted.map((row, index) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.key} style={col.align === "right" ? { textAlign: "right" } : undefined}>{col.render(row, index)}</td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </TableShell>
  );
}
