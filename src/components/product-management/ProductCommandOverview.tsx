// 商品变化指挥中心 · 总览页签编排器
import { useMemo } from "react";
import { Card } from "../Card";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";
import { ChannelStructurePanel } from "./ChannelStructurePanel";
import { HealthRadar } from "./HealthRadar";
import { MattressCategoryAnalysis } from "./MattressCategoryAnalysis";
import { MatrixTable } from "./MatrixTable";
import { MonthlyTrendChart } from "./MonthlyTrendChart";
import { PriorityProductsTable } from "./PriorityProductsTable";
import { ProductConclusionBand } from "./ProductConclusionBand";
import { ProductKpiGrid } from "./ProductKpiGrid";
import { ProductSecondaryBand } from "./ProductSecondaryBand";
import { buildProductCommandModel } from "./useProductSummary";
import type { ProductManagementPages } from "../../types/integration";

interface Props {
  pm: ProductManagementPages;
  channelScoped: boolean;
  focusTarget?: { kind: "product" | "spu" | "sku"; value: string; productName?: string } | null;
}

export function ProductCommandOverview({ pm, channelScoped, focusTarget }: Props) {
  const tooltip = useChartTooltip();
  const model = useMemo(() => buildProductCommandModel(pm), [pm]);
  const prevLabel = model.previousMonth ?? "上期";
  const channelCount = model.channelRows.length;

  return (
    <section className="overview product-command" aria-label="商品总览">
      <ProductConclusionBand cards={model.conclusions} />
      <ProductKpiGrid kpis={model.kpis} />
      <ProductSecondaryBand metrics={model.secondary} />

      <section className="main-grid">
        <article className="panel">
          <header className="panel-head">
            <div>
              <span className="panel-kicker">Monthly Trend</span>
              <h2>月度趋势主图</h2>
              <p>{channelScoped ? "当前筛选口径" : "全部渠道"}商家实收趋势，主线对比 {prevLabel} 同期。</p>
            </div>
            <div className="legend" aria-label="图例">
              <span style={{ color: "var(--brand)" }}><i />{model.currentMonth ?? "本期"} 当期</span>
              <span style={{ color: "var(--muted)" }}><i />{prevLabel} 同期</span>
              <span style={{ color: "var(--blue)" }}><i />退货率</span>
              <span style={{ color: "var(--orange)" }}><i />毛利率</span>
            </div>
          </header>
          <MonthlyTrendChart
            currentMonth={model.currentMonth}
            previousMonth={model.previousMonth}
            summary={model.summary}
            tooltip={tooltip}
            trend={model.trend}
          />
          <MattressCategoryAnalysis
            channelScoped={channelScoped}
            notes={model.categoryNotes}
            rows={model.categoryRows}
            tooltip={tooltip}
          />
        </article>

        <div className="side-grid">
          <article className="panel">
            <header className="panel-head">
              <div>
                <span className="panel-kicker">Health Radar</span>
                <h2>经营健康雷达</h2>
                <p>六个经营维度压成 0–100 原型健康度，口径透明可解释。</p>
              </div>
            </header>
            <HealthRadar radar={model.radar} tooltip={tooltip} />
          </article>

          <article className="panel">
            <header className="panel-head">
              <div>
                <span className="panel-kicker">Current Mix</span>
                <h2>当前渠道结构</h2>
                <p>仅展示当前筛选期结构，不混入历史渠道占比。</p>
              </div>
              <span className="mini-chip">{channelCount} 渠道</span>
            </header>
            <ChannelStructurePanel rows={model.channelRows} tooltip={tooltip} />
          </article>
        </div>
      </section>

      <section className="matrix-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))", gap: "16px", marginTop: "16px" }}>
        <Card title="渠道平台 × 发货仓 销售数量">
          <MatrixTable matrix={model.channelWarehouseMatrix} rowHeader="渠道平台" minWidth={480} />
        </Card>
        <Card title="渠道平台 × 床垫类别 销量">
          <MatrixTable matrix={model.channelCategoryMatrix} rowHeader="渠道平台" minWidth={480} />
        </Card>
      </section>

      <PriorityProductsTable
        focusTarget={focusTarget}
        rows={model.productRows}
        currentPeriod={model.currentPeriod}
        previousPeriod={model.previousPeriod}
        productChannelMatrix={pm.productChannelMatrix}
        productChannelRevenueMatrix={pm.productChannelRevenueMatrix ?? { columns: [], rows: [] }}
        productChannelRefundMatrix={pm.productChannelRefundMatrix ?? { columns: [], rows: [] }}
      />

      <ChartTooltip content={tooltip.content} tipRef={tooltip.tipRef} visible={tooltip.visible} />
    </section>
  );
}
