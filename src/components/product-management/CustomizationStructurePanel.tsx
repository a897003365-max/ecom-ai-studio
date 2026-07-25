import { Card } from "../Card";
import { SortableTable } from "../SortableTable";
import type {
  ProductCustomCategoryRow,
  ProductCustomComparisonRow,
  ProductCustomProductRow,
  ProductCustomTagRow,
  ProductCustomizationStructurePages,
} from "../../types/integration";

const EMPTY: ProductCustomizationStructurePages = {
  comparison: [],
  categoryStructure: [],
  tags: [],
  topProducts: [],
  derivationNote: "基于颜色规格与辅4-床垫编码(q18)字段推导，不等同于 ERP 原生定制字段。",
  quality: { status: "unavailable", coverage: null, warnings: ["模块未实现"] },
};

const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);
const money = (v: number) => `¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
const count = (v: number) => v.toLocaleString("zh-CN");
const days = (v: number | null) => (v === null ? "-" : v.toFixed(1));

export function CustomizationStructurePanel({ data }: { data?: ProductCustomizationStructurePages | null }) {
  const v = data ?? EMPTY;
  return (
    <>
      <Card title="定制结构（推导）· 常规 vs 定制对比">
        <div className="mb-3 text-[12px] leading-relaxed text-[var(--orange)]">
          ⚠ {v.derivationNote}
          {v.quality.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
        <SortableTable<ProductCustomComparisonRow>
          minWidth={860}
          rowKey={(r) => r.orderType}
          rows={v.comparison}
          emptyHint="无数据"
          columns={[
            { key: "orderType", label: "订单类型", sortValue: (r) => r.orderType, render: (r) => <span className="font-semibold">{r.orderType}</span> },
            { key: "orderLines", label: "订单行", align: "right", sortValue: (r) => r.orderLines, render: (r) => count(r.orderLines) },
            { key: "orderLineShare", label: "订单行占比", align: "right", sortValue: (r) => r.orderLineShare, render: (r) => pct(r.orderLineShare) },
            { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.receivedAmount)}</span> },
            { key: "shippedOrderLines", label: "已发货", align: "right", sortValue: (r) => r.shippedOrderLines, render: (r) => count(r.shippedOrderLines) },
            { key: "avgShippingDays", label: "平均发货时效", align: "right", sortValue: (r) => r.avgShippingDays ?? -1, render: (r) => days(r.avgShippingDays) },
            { key: "shippedWithin7DaysShare", label: "7天内发货占比", align: "right", sortValue: (r) => r.shippedWithin7DaysShare ?? -1, render: (r) => pct(r.shippedWithin7DaysShare) },
            { key: "shippedWithin15DaysShare", label: "15天内发货占比", align: "right", sortValue: (r) => r.shippedWithin15DaysShare ?? -1, render: (r) => pct(r.shippedWithin15DaysShare) },
          ]}
        />
      </Card>
      <Card title="定制标签明细 · 7 类互斥（优先级：缺角 > 异形 > 折叠 > 尺寸 > 厚度 > 内材 > 未填写）" className="mt-4">
        <SortableTable<ProductCustomTagRow>
          minWidth={560}
          rowKey={(r) => r.tag}
          rows={v.tags}
          emptyHint="无数据"
          columns={[
            { key: "tag", label: "定制标签", sortValue: (r) => r.tag, render: (r) => <span className="font-semibold">{r.tag}</span> },
            { key: "orderLines", label: "订单行", align: "right", sortValue: (r) => r.orderLines, render: (r) => count(r.orderLines) },
            { key: "customOrderLineShare", label: "占定制订单比例", align: "right", sortValue: (r) => r.customOrderLineShare, render: (r) => pct(r.customOrderLineShare) },
          ]}
        />
      </Card>
      {v.categoryStructure.length > 0 && (
        <Card title="床垫类别定制订单结构" className="mt-4">
          <SortableTable<ProductCustomCategoryRow>
            minWidth={560}
            rowKey={(r) => r.mattressCategory}
            rows={v.categoryStructure}
            columns={[
              { key: "mattressCategory", label: "床垫类别", sortValue: (r) => r.mattressCategory, render: (r) => <span className="font-semibold">{r.mattressCategory}</span> },
              { key: "customOrderLines", label: "定制订单行", align: "right", sortValue: (r) => r.customOrderLines, render: (r) => count(r.customOrderLines) },
              { key: "customOrderLineShare", label: "占定制订单比例", align: "right", sortValue: (r) => r.customOrderLineShare, render: (r) => pct(r.customOrderLineShare) },
            ]}
          />
        </Card>
      )}
      {v.topProducts.length > 0 && (
        <Card title="TOP20 产品定制履约" className="mt-4">
          <SortableTable<ProductCustomProductRow>
            minWidth={960}
            rowKey={(r) => r.productName}
            rows={v.topProducts}
            columns={[
              { key: "productName", label: "产品名称", sortValue: (r) => r.productName, render: (r) => <span className="font-semibold">{r.productName}</span> },
              { key: "customOrderLines", label: "定制订单行", align: "right", sortValue: (r) => r.customOrderLines, render: (r) => count(r.customOrderLines) },
              { key: "customReceivedAmount", label: "定制商家实收", align: "right", sortValue: (r) => r.customReceivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.customReceivedAmount)}</span> },
              { key: "shippedCustomOrderLines", label: "已发货", align: "right", sortValue: (r) => r.shippedCustomOrderLines, render: (r) => count(r.shippedCustomOrderLines) },
              { key: "shippedWithin7DaysShare", label: "7天内", align: "right", sortValue: (r) => r.shippedWithin7DaysShare ?? -1, render: (r) => pct(r.shippedWithin7DaysShare) },
              { key: "shippedWithin10DaysShare", label: "10天内", align: "right", sortValue: (r) => r.shippedWithin10DaysShare ?? -1, render: (r) => pct(r.shippedWithin10DaysShare) },
              { key: "shippedWithin15DaysShare", label: "15天内", align: "right", sortValue: (r) => r.shippedWithin15DaysShare ?? -1, render: (r) => pct(r.shippedWithin15DaysShare) },
            ]}
          />
        </Card>
      )}
    </>
  );
}
