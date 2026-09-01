import type { KpiMetric } from "../types";
import { Card } from "./Card";
import { ProgressBar } from "./ProgressBar";

interface MetricCardProps {
  metric: KpiMetric;
}

export function MetricCard({ metric }: MetricCardProps) {
  const trendClass =
    metric.trend === "up" ? "text-[var(--green)]" : metric.trend === "down" ? "text-[var(--red)]" : "text-[var(--muted)]";

  const trendIcon = metric.trend === "up" ? "↑" : metric.trend === "down" ? "↓" : "→";

  return (
    <Card className="metric-card card-glow">
      <div className="relative">
        <div className="mb-2 text-[11.5px] font-medium text-[var(--muted)]">{metric.label}</div>
        <div
          className="metric-value text-[26px] font-bold leading-tight"
          style={{ color: metric.tone ? `var(--${metric.tone})` : undefined }}
        >
          {metric.value}
        </div>
        {metric.progress !== undefined && (
          <div className="mt-3">
            <ProgressBar value={metric.progress} tone={metric.tone ?? "blue"} striped={metric.progress < 100} />
          </div>
        )}
        {metric.delta && (
          <div className={`metric-trend mt-2 text-[11.5px] ${trendClass}`}>
            <span>{trendIcon}</span>
            <span>{metric.delta}</span>
          </div>
        )}
        {metric.detail && <div className="mt-2 text-[11px] text-[var(--muted-2)]">{metric.detail}</div>}
      </div>
    </Card>
  );
}
