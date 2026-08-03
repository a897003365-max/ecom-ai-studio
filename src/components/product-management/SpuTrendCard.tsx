import { useEffect, useMemo, useState } from "react";
import { Card } from "../Card";
import { SpuSearchSelect } from "./SpuSearchSelect";
import { SpuTrendLineChart, SPU_TREND_COLORS } from "./SpuTrendLineChart";
import type { ProductSpuSalesTrendPages } from "../../types/integration";

const EMPTY: ProductSpuSalesTrendPages = {
  spuChannelMatrix: { columns: [], rows: [] },
  dailySpuTrend: [],
  categoryDailyTrend: [],
  availableSpus: [],
  defaultSpus: [],
  summaries: [],
  quality: { status: "unavailable", coverage: null, warnings: ["模块未实现"] },
};

export function SpuTrendCard({ data, className, selectedSpus: controlledSpus, onSelectedSpusChange }: { data?: ProductSpuSalesTrendPages | null; className?: string; selectedSpus?: string[]; onSelectedSpusChange?: (spus: string[]) => void }) {
  const v = data ?? EMPTY;
  const [internalSpus, setInternalSpus] = useState<string[]>(() => (v.defaultSpus || []).slice(0, 5));
  const selectedSpus = controlledSpus ?? internalSpus;
  const setSelectedSpus = onSelectedSpusChange ?? setInternalSpus;

  useEffect(() => {
    if (!controlledSpus) {
      setInternalSpus((v.defaultSpus || []).slice(0, 5));
    }
  }, [v.defaultSpus, controlledSpus]);

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

  return (
    <Card
      title="SPU 产品商编日销量趋势"
      className={className}
      action={
        <div className="w-[min(420px,50vw)] max-md:w-full">
          <SpuSearchSelect options={options} selected={selectedSpus} onChange={setSelectedSpus} />
        </div>
      }
    >
      <div className="mb-3 text-[12px] text-[var(--muted)]">
        搜索框可选择 SPU，<span className="text-[var(--orange)] font-medium">仅影响此趋势图</span>。
      </div>
      <SpuTrendLineChart series={series} dates={dates} />
    </Card>
  );
}
