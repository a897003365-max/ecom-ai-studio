import { Card } from "../Card";
import { SortableTable } from "../SortableTable";
import type {
  ProductCustomCategoryRow,
  ProductCustomComparisonRow,
  ProductCustomProductRow,
  ProductCustomSpuRow,
  ProductCustomTagRow,
  ProductCustomizationStructurePages,
} from "../../types/integration";

const EMPTY: ProductCustomizationStructurePages = {
  comparison: [],
  categoryStructure: [],
  tags: [],
  topProducts: [],
  spuSummary: [],
  derivationNote: "是否定制 = 卖家备注含 定制/折叠/横折/竖折（对齐 PBI 商家备注打标）。",
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
      <Card title="定制结构 · 常规 vs 定制对比">
        <SortableTable<ProductCustomComparisonRow>
          minWidth={860}
          rowKey={(r) => r.orderType}
          rows={v.comparison}
          emptyHint="无数据"
          columns={[
            { key: "orderType", label: "订单类型", sortValue: (r) => r.orderType, render: (r) => <span className="font-semibold">{r.orderType}</span> },
            { key: "salesUnits", label: "销量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
            { key: "salesUnitsShare", label: "销量占比", align: "right", sortValue: (r) => r.salesUnitsShare, render: (r) => pct(r.salesUnitsShare) },
            { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.receivedAmount)}</span> },
            { key: "shippedOrderLines", label: "已发货", align: "right", sortValue: (r) => r.shippedOrderLines, render: (r) => count(r.shippedOrderLines) },
            { key: "avgShippingDays", label: "平均发货时效", align: "right", sortValue: (r) => r.avgShippingDays ?? -1, render: (r) => days(r.avgShippingDays) },
            { key: "shippedWithin7DaysShare", label: "7天内发货占比", align: "right", sortValue: (r) => r.shippedWithin7DaysShare ?? -1, render: (r) => pct(r.shippedWithin7DaysShare) },
            { key: "shippedWithin15DaysShare", label: "15天内发货占比", align: "right", sortValue: (r) => r.shippedWithin15DaysShare ?? -1, render: (r) => pct(r.shippedWithin15DaysShare) },
          ]}
        />
      </Card>
      <Card title="SPU 定制汇总 · 销量 / 定制销量 / 定制率" className="mt-4">
        <div className="mb-3 text-[12px] text-[var(--muted)]">
          定制率 = 定制销量 / 销量
        </div>
        <SortableTable<ProductCustomSpuRow>
          minWidth={720}
          rowKey={(r) => r.spu}
          rows={v.spuSummary ?? []}
          emptyHint="无数据（刷新商品管理快照后显示）"
          defaultSortKey="salesUnits"
          defaultSortDir="desc"
          columns={[
            { key: "spu", label: "SPU", sortValue: (r) => r.spu, render: (r) => <span className="font-semibold">{r.spu}</span> },
            { key: "productName", label: "产品名称", sortValue: (r) => r.productName, render: (r) => r.productName || "-" },
            { key: "salesUnits", label: "销量（件）", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
            { key: "customSalesUnits", label: "定制销量（件）", align: "right", sortValue: (r) => r.customSalesUnits, render: (r) => count(r.customSalesUnits) },
            { key: "customRate", label: "定制率", align: "right", sortValue: (r) => r.customRate, render: (r) => <span className={r.customRate > 0 ? "font-semibold text-[var(--orange)]" : ""}>{pct(r.customRate)}</span> },
          ]}
        />
      </Card>
      <Card title="床垫类别定制分析 · 销量 / 定制销量 / 定制销量占比" className="mt-4">
        <SortableTable<ProductCustomCategoryRow>
          minWidth={720}
          rowKey={(r) => r.mattressCategory}
          rows={v.categoryStructure}
          emptyHint="无数据"
          defaultSortKey="salesUnits"
          defaultSortDir="desc"
          columns={[
            { key: "mattressCategory", label: "床垫类别", sortValue: (r) => r.mattressCategory, render: (r) => <span className="font-semibold">{r.mattressCategory}</span> },
            { key: "salesUnits", label: "销量（件）", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
            { key: "customSalesUnits", label: "定制销量（件）", align: "right", sortValue: (r) => r.customSalesUnits, render: (r) => count(r.customSalesUnits) },
            { key: "customSalesShare", label: "定制销量占比", align: "right", sortValue: (r) => r.customSalesShare, render: (r) => <span className="font-semibold text-[var(--orange)]">{pct(r.customSalesShare)}</span> },
          ]}
        />
      </Card>
      <Card title="定制标签明细 · 按定制备注标签" className="mt-4">
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
      {v.topProducts.length > 0 && (
        <Card title="TOP20 产品定制履约" className="mt-4">
          <SortableTable<ProductCustomProductRow>
            minWidth={960}
            rowKey={(r) => r.productName}
            rows={v.topProducts}
            columns={[
              { key: "productName", label: "产品名称", sortValue: (r) => r.productName, render: (r) => <span className="font-semibold">{r.productName}</span> },
              { key: "customSalesUnits", label: "定制销量", align: "right", sortValue: (r) => r.customSalesUnits, render: (r) => count(r.customSalesUnits) },
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
