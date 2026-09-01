import { Card } from "../Card";
import { SortableTable } from "../SortableTable";
import { StructureMatrixTable } from "./StructureMatrixTable";
import type { ProductSizeRow, ProductSizeStructurePages } from "../../types/integration";

const EMPTY: ProductSizeStructurePages = {
  sizes: [],
  unknownSize: {
    size: "未填写尺寸",
    source: "unknown",
    orderLines: 0,
    orderLineShare: 0,
    salesUnits: 0,
    salesUnitsShare: 0,
    receivedAmount: 0,
    receivedAmountShare: 0,
  },
  mattressCategoryMatrix: { columns: [], rows: [] },
  topProductMatrix: { columns: [], rows: [] },
  recognizedOrderLines: 0,
  totalOrderLines: 0,
  quality: { status: "unavailable", coverage: null, warnings: ["模块未实现"] },
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const money = (v: number) => `¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
const count = (v: number) => v.toLocaleString("zh-CN");

export function SizeStructurePanel({ data }: { data?: ProductSizeStructurePages | null }) {
  const v = data ?? EMPTY;
  return (
    <>
      <Card title="尺寸分布">
        <SortableTable<ProductSizeRow>
          minWidth={620}
          rowKey={(r) => r.size}
          rows={v.sizes}
          emptyHint="当前筛选范围无可识别尺寸"
          columns={[
            { key: "size", label: "尺寸", sortValue: (r) => r.size, render: (r) => <span className="font-semibold">{r.size}</span> },
            { key: "salesUnits", label: "销量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
            { key: "salesUnitsShare", label: "销量占比", align: "right", sortValue: (r) => r.salesUnitsShare ?? 0, render: (r) => pct(r.salesUnitsShare ?? 0) },
            { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.receivedAmount)}</span> },
          ]}
        />
      </Card>
      <Card title="床垫类别 × 尺寸 订单行占比" className="mt-4">
        <StructureMatrixTable matrix={v.mattressCategoryMatrix} rowHeader="床垫类别" />
      </Card>
      <Card title="TOP15 产品 × 尺寸 订单行占比" className="mt-4">
        <StructureMatrixTable matrix={v.topProductMatrix} rowHeader="产品名称" />
      </Card>
    </>
  );
}
