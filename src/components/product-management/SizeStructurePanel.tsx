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
    receivedAmount: 0,
    receivedAmountShare: 0,
  },
  mattressCategoryMatrix: { columns: [], rows: [] },
  topProductMatrix: { columns: [], rows: [] },
  recognizedOrderLines: 0,
  totalOrderLines: 0,
  quality: { status: "unavailable", coverage: null, warnings: ["模块未实现"] },
};

const SOURCE_LABEL: Record<string, string> = {
  q18: "产品主数据",
  q27: "产品主表",
  colorSpec: "颜色规格",
  unknown: "未填写",
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const money = (v: number) => `¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
const count = (v: number) => v.toLocaleString("zh-CN");

export function SizeStructurePanel({ data }: { data?: ProductSizeStructurePages | null }) {
  const v = data ?? EMPTY;
  const cov = v.quality?.coverage;
  return (
    <>
      <Card title="尺寸分布">
        <div className="mb-3 text-[12px] leading-relaxed text-[var(--muted)]">
          尺寸来源优先级：产品主数据(q18) → 产品主表(q27) → 颜色规格解析 → 未填写。已识别订单行 {count(v.recognizedOrderLines)} / {count(v.totalOrderLines)}。
          {cov && cov.orderLineRatio !== null && ` q18 覆盖率 ${(cov.orderLineRatio * 100).toFixed(1)}%。`}
          低频尺寸（&lt;0.5% 订单行）已并入"其他尺寸"列；未填写尺寸计入占比分母。
        </div>
        <SortableTable<ProductSizeRow>
          minWidth={860}
          rowKey={(r) => r.size}
          rows={v.sizes}
          emptyHint="当前筛选范围无可识别尺寸"
          columns={[
            { key: "size", label: "尺寸", sortValue: (r) => r.size, render: (r) => <span className="font-semibold">{r.size}</span> },
            { key: "source", label: "来源", sortValue: (r) => r.source, render: (r) => SOURCE_LABEL[r.source] ?? r.source },
            { key: "orderLines", label: "订单行", align: "right", sortValue: (r) => r.orderLines, render: (r) => count(r.orderLines) },
            { key: "orderLineShare", label: "订单行占比", align: "right", sortValue: (r) => r.orderLineShare, render: (r) => pct(r.orderLineShare) },
            { key: "salesUnits", label: "销量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
            { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.receivedAmount)}</span> },
            { key: "receivedAmountShare", label: "金额占比", align: "right", sortValue: (r) => r.receivedAmountShare, render: (r) => pct(r.receivedAmountShare) },
          ]}
        />
        {v.unknownSize && v.unknownSize.orderLines > 0 && (
          <div className="mt-3 text-[12px] text-[var(--muted)]">
            未填写尺寸：{count(v.unknownSize.orderLines)} 行（{pct(v.unknownSize.orderLineShare)}），已计入占比分母。
          </div>
        )}
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
