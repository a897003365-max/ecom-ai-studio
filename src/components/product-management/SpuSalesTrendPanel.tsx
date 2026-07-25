import { useEffect, useMemo, useState } from "react";
import { Card } from "../Card";
import { SortableTable } from "../SortableTable";
import { SpuSearchSelect } from "./SpuSearchSelect";
import { SpuTrendLineChart, SPU_TREND_COLORS } from "./SpuTrendLineChart";
import type { ProductSpuSalesTrendPages, ProductSpuSummary } from "../../types/integration";

const EMPTY: ProductSpuSalesTrendPages = {
  spuChannelMatrix: { columns: [], rows: [] },
  dailySpuTrend: [],
  categoryDailyTrend: [],
  availableSpus: [],
  defaultSpus: [],
  summaries: [],
  quality: { status: "unavailable", coverage: null, warnings: ["模块未实现"] },
};

interface MatrixRow {
  rowKey: string;
  total: number;
  [key: string]: number | string;
}

const money = (v: number) => `¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
const count = (v: number) => v.toLocaleString("zh-CN");

export function SpuSalesTrendPanel({ data }: { data?: ProductSpuSalesTrendPages | null }) {
  const v = data ?? EMPTY;
  const cov = v.quality?.coverage;
  const [selectedSpus, setSelectedSpus] = useState<string[]>(() => (v.defaultSpus || []).slice(0, 5));

  useEffect(() => {
    setSelectedSpus((v.defaultSpus || []).slice(0, 5));
  }, [v.defaultSpus]);

  const options = useMemo(
    () => v.summaries.map((s) => ({ spu: s.spu, productName: s.productName || "" })),
    [v.summaries],
  );

  const dates = useMemo(() => {
    const set = new Set(v.dailySpuTrend.map((p) => p.date));
    return Array.from(set).sort();
  }, [v.dailySpuTrend]);

  const trendMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of v.dailySpuTrend) {
      m.set(`${p.spu}|${p.date}`, p.salesUnits);
    }
    return m;
  }, [v.dailySpuTrend]);

  const series = useMemo(() => {
    return selectedSpus.map((spu, i) => {
      const values = dates.map((d) => trendMap.get(`${spu}|${d}`) || 0);
      const sum = v.summaries.find((s) => s.spu === spu);
      return {
        spu,
        productName: sum?.productName || "",
        values,
        color: SPU_TREND_COLORS[i % SPU_TREND_COLORS.length],
      };
    });
  }, [selectedSpus, dates, trendMap, v.summaries]);

  const m = v.spuChannelMatrix;
  const matrixRows: MatrixRow[] = m.rows.map((r) => ({ rowKey: r.rowKey, ...r.values, total: r.total }));

  return (
    <>
      <Card
        title="SPU 产品商编日销量趋势"
        className="card-spu-trend"
        action={
          <div className="w-[min(420px,50vw)] max-md:w-full">
            <SpuSearchSelect options={options} selected={selectedSpus} onChange={setSelectedSpus} />
          </div>
        }
      >
        <div className="mb-3 text-[12px] leading-relaxed text-[var(--muted)]">
          SPU 取自产品主数据(q18)的 SPU产品商编；缺失归"未识别 SPU"。默认选中销量 TOP5；搜索框可选择全部 SPU，<span className="text-[var(--orange)] font-medium">仅影响此趋势图</span>。当前已选 {selectedSpus.length} 个 SPU。
          {cov && cov.orderLineRatio !== null && ` q18 SPU 覆盖率 ${(cov.orderLineRatio * 100).toFixed(1)}%。`}
        </div>
        <SpuTrendLineChart series={series} dates={dates} />
      </Card>
      <Card title="SPU 销量汇总 · 按商家实收排序" className="mt-4">
        <SortableTable<ProductSpuSummary>
          minWidth={760}
          rowKey={(r) => r.spu}
          rows={v.summaries}
          emptyHint="无 SPU 数据"
          columns={[
            { key: "spu", label: "SPU", sortValue: (r) => r.spu, render: (r) => <span className="font-semibold">{r.spu}</span> },
            { key: "productName", label: "主产品名称", sortValue: (r) => r.productName, render: (r) => r.productName || "-" },
            { key: "orderLines", label: "订单行", align: "right", sortValue: (r) => r.orderLines, render: (r) => count(r.orderLines) },
            { key: "salesUnits", label: "销量", align: "right", sortValue: (r) => r.salesUnits, render: (r) => count(r.salesUnits) },
            { key: "receivedAmount", label: "商家实收", align: "right", sortValue: (r) => r.receivedAmount, render: (r) => <span className="text-[var(--green)]">{money(r.receivedAmount)}</span> },
          ]}
        />
      </Card>
      <Card title="SPU × 渠道 销量" className="mt-4">
        {m.rows.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-[var(--muted)]">暂无数据</div>
        ) : (
          <SortableTable<MatrixRow>
            minWidth={900}
            rowKey={(r) => r.rowKey}
            rows={matrixRows}
            columns={[
              { key: "rowKey", label: "SPU", sortValue: (r) => r.rowKey, render: (r) => <span className="font-semibold">{r.rowKey}</span> },
              ...m.columns.map((c) => ({
                key: c,
                label: c,
                align: "right" as const,
                sortValue: (r: MatrixRow) => Number(r[c] ?? 0),
                render: (r: MatrixRow) => count(Number(r[c] ?? 0)),
              })),
              { key: "total", label: "合计", align: "right", sortValue: (r) => r.total, render: (r) => <span className="font-semibold">{count(r.total)}</span> },
            ]}
          />
        )}
      </Card>
    </>
  );
}
