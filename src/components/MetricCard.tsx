import type { KpiMetric } from "../types";
import { Card } from "./Card";
import { ProgressBar } from "./ProgressBar";

interface MetricCardProps {
  metric: KpiMetric;
}

export function MetricCard({ metric }: MetricCardProps) {
  const trendClass =
    metric.trend === "up" ? "text-[var(--green)]" : metric.trend === "down" ? "text-[var(--red)]" : "text-[var(--muted)]";

  return (
    <Card className="metric-card">
      <div className="mb-1.5 text-[11.5px] text-[var(--muted)]">{metric.label}</div>
      <div className="text-[21px] font-bold leading-tight" style={{ color: metric.tone ? `var(--${metric.tone})` : undefined }}>
        {metric.value}
      </div>
      {metric.progress !== undefined && <ProgressBar value={metric.progress} tone={metric.tone ?? "blue"} />}
      {metric.delta && <div className={`mt-1.5 text-[11.5px] ${trendClass}`}>{metric.delta}</div>}
      {metric.detail && <div className="mt-1.5 text-[11.5px] text-[var(--muted)]">{metric.detail}</div>}
    </Card>
  );
}
