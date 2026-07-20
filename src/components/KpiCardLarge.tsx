import type { KpiMetric } from "../types";
import { Card } from "./Card";

interface KpiCardLargeProps {
  metric: KpiMetric;
  mock?: boolean;
  mockNote?: string;
  yoy?: string; // 同比
  mom?: string; // 环比
  yoyTrend?: "up" | "down" | "flat";
  momTrend?: "up" | "down" | "flat";
}

/**
 * 大卡：核心结果指标
 * 参考帆软样式：数值 + 同比箭头 + 环比箭头
 */
export function KpiCardLarge({
  metric,
  mock = false,
  mockNote,
  yoy,
  mom,
  yoyTrend,
  momTrend,
}: KpiCardLargeProps) {
  const trendClass =
    metric.trend === "up" ? "text-[var(--green)]" : metric.trend === "down" ? "text-[var(--red)]" : "text-[var(--muted)]";
  const trendIcon = metric.trend === "up" ? "↑" : metric.trend === "down" ? "↓" : "→";

  const yoyTrendClass = yoyTrend === "up" ? "text-[var(--green)]" : yoyTrend === "down" ? "text-[var(--red)]" : "text-[var(--muted)]";
  const momTrendClass = momTrend === "up" ? "text-[var(--green)]" : momTrend === "down" ? "text-[var(--red)]" : "text-[var(--muted)]";
  const yoyIcon = yoyTrend === "up" ? "↑" : yoyTrend === "down" ? "↓" : "→";
  const momIcon = momTrend === "up" ? "↑" : momTrend === "down" ? "↓" : "→";

  return (
    <Card className={`metric-card card-glow ${mock ? "opacity-55 grayscale" : ""}`}>
      <div className="relative">
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-[var(--muted)]">{metric.label}</span>
          {mock && (
            <span
              aria-label="模拟数据"
              className="rounded-sm border border-dashed border-[var(--muted)] px-1 text-[9.5px] font-bold uppercase tracking-wider text-[var(--muted)]"
              title={mockNote ?? "该指标当前使用示例数据"}
            >
              示例
            </span>
          )}
        </div>
        <div
          className="metric-value text-[30px] font-bold leading-tight"
          style={{ color: !mock && metric.tone ? `var(--${metric.tone})` : undefined }}
        >
          {metric.value}
        </div>
        {metric.delta && (
          <div className={`metric-trend mt-2 text-[12px] font-semibold ${trendClass}`}>
            <span>{trendIcon}</span>
            <span>{metric.delta}</span>
          </div>
        )}
        {(yoy !== undefined || mom !== undefined) && (
          <div className="mt-2 flex gap-4 text-[11px]">
            {yoy !== undefined && (
              <div className={yoyTrendClass}>
                <span className="text-[var(--muted)]">同比：</span>
                <span className="font-semibold">{yoyIcon}</span>
                <span className="font-semibold">{yoy}</span>
              </div>
            )}
            {mom !== undefined && (
              <div className={momTrendClass}>
                <span className="text-[var(--muted)]">环比：</span>
                <span className="font-semibold">{momIcon}</span>
                <span className="font-semibold">{mom}</span>
              </div>
            )}
          </div>
        )}
        {metric.detail && <div className="mt-2 text-[11px] text-[var(--muted-2)]">{metric.detail}</div>}
      </div>
    </Card>
  );
}
