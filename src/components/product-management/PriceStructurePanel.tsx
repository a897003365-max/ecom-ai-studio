import { Card } from "../Card";
import { SortableTable } from "../SortableTable";
import { StructureMatrixTable } from "./StructureMatrixTable";
import type { ProductPriceBucketRow, ProductPriceStructurePages } from "../../types/integration";

const BUCKET_ORDER = ["1000以下", "1001–1500", "1501–2000", "2001–2500", "2501–3000", "3001–4000", "4000以上"];

const EMPTY: ProductPriceStructurePages = {
  buckets: [],
  channelMatrix: { columns: [], rows: [] },
  mattressCategoryMatrix: { columns: [], rows: [] },
  topProductMatrix: { columns: [], rows: [] },
  validOrderLines: 0,
  excludedOrderLines: 0,
  totalReceivedAmount: 0,
  formula: "商家实收 / 销售数量",
  quality: { status: "unavailable", coverage: null, warnings: ["模块未实现"] },
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const money = (v: number) => `¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
const count = (v: number) => v.toLocaleString("zh-CN");

export function PriceStructurePanel({ data }: { data?: ProductPriceStructurePages | null }) {
  const v = data ?? EMPTY;
  return (
    <>
      <Card title="商家实收价格段分布">
        <div className="mb-3 text-[12px] leading-relaxed text-[var(--muted)]">
          单件实收价 = {v.formula}；仅统计商家实收 &gt; 0 且销售数量 &gt; 0 的订单行。无效行 {count(v.excludedOrderLines)} 条不计入占比分母。有效订单行 {count(v.validOrderLines)}，商家实收合计 {money(v.totalReceivedAmount)}。
        </div>
        <SortableTable<ProductPriceBucketRow>
          minWidth={920}
          rowKey={(r) => r.bucket}
          rows={v.buckets}
          emptyHint="当前筛选范围无有效价格数据"
          columns={[
            { key: "label", label: "价格段", sortValue: (r) => BUCKET_ORDER.indexOf(r.label), render: (r) => <span className="font-semibold">{r.label}</span> },
            { key: "orderLines", label: "订单行", align: "right", sortValue: (r) => r.orderLines, render: (r) => count(r.orderLines) },
            { key: "orderLineShare", label: "订单行占比", align: "right", sortValue: (r) => r.orderLineShare, render: (r) => pct(r.orderLineShare) },
            { key: "salesUnits", label: "销量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
            { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.receivedAmount)}</span> },
            { key: "receivedAmountShare", label: "金额占比", align: "right", sortValue: (r) => r.receivedAmountShare, render: (r) => pct(r.receivedAmountShare) },
          ]}
        />
      </Card>
      <Card title="渠道 × 价格段 订单行占比" className="mt-4">
        <StructureMatrixTable matrix={v.channelMatrix} rowHeader="渠道平台" />
      </Card>
      <Card title="床垫类别 × 价格段 订单行占比" className="mt-4">
        <StructureMatrixTable matrix={v.mattressCategoryMatrix} rowHeader="床垫类别" />
      </Card>
      <Card title="TOP15 产品 × 价格段 订单行占比" className="mt-4">
        <StructureMatrixTable matrix={v.topProductMatrix} rowHeader="产品名称" />
      </Card>
    </>
  );
}
