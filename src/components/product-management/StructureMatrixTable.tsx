import { SortableTable, type SortColumn } from "../SortableTable";
import type { ProductShareMatrix, ProductShareMatrixRow } from "../../types/integration";

interface Props {
  matrix: ProductShareMatrix;
  rowHeader: string;
  minWidth?: number;
}

export function StructureMatrixTable({ matrix, rowHeader, minWidth = 960 }: Props) {
  const rows: ProductShareMatrixRow[] = matrix.rows;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const columns: SortColumn<ProductShareMatrixRow>[] = [
    {
      key: "rowKey",
      label: rowHeader,
      sortValue: (r) => r.rowKey,
      render: (r) => <span className="font-semibold">{r.rowKey}</span>,
    },
    {
      key: "orderLines",
      label: "订单行",
      align: "right",
      sortValue: (r) => r.orderLines,
      render: (r) => r.orderLines.toLocaleString("zh-CN"),
    },
    ...matrix.columns.map<SortColumn<ProductShareMatrixRow>>((c) => ({
      key: c,
      label: c,
      align: "right" as const,
      sortValue: (r) => r.shares[c] ?? 0,
      render: (r) => pct(r.shares[c] ?? 0),
    })),
  ];
  return <SortableTable<ProductShareMatrixRow> minWidth={minWidth} rowKey={(r) => r.rowKey} rows={rows} emptyHint="暂无数据" columns={columns} />;
}
