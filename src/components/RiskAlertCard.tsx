import type { KpiMetric, Tone } from "../types";

interface RiskAlertCardProps {
  metric: KpiMetric;
  threshold?: string;
  alerts?: Array<{ label: string; value: string; tone?: Tone }>;
}

/**
 * L5 层风险卡：退款金额 / 退款率，红色边框 + 阈值提示 + 高风险店铺清单
 */
export function RiskAlertCard({ metric, threshold, alerts = [] }: RiskAlertCardProps) {
  const trendClass =
    metric.trend === "up" ? "text-[var(--red)]" : metric.trend === "down" ? "text-[var(--green)]" : "text-[var(--muted)]";
  const trendIcon = metric.trend === "up" ? "↑" : metric.trend === "down" ? "↓" : "→";

  return (
    <section className="rounded-md border border-[var(--red)]/50 bg-[var(--red-bg)]/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-[var(--muted)]">{metric.label}</span>
        <span aria-hidden="true" className="text-[13px] leading-none">⚠️</span>
      </div>
      <div className="text-[26px] font-bold leading-tight text-[var(--red)]">{metric.value}</div>
      {metric.delta && (
        <div className={`mt-1.5 text-[11.5px] font-semibold ${trendClass}`}>
          <span>{trendIcon}</span>
          <span className="ml-1">{metric.delta}</span>
        </div>
      )}
      {threshold && <div className="mt-1 text-[10.5px] text-[var(--muted-2)]">阈值：{threshold}</div>}
      {alerts.length > 0 && (
        <ul className="mt-2.5 space-y-1 border-t border-[var(--red)]/20 pt-2 text-[11px]">
          {alerts.map((item) => (
            <li key={`${item.label}-${item.value}`} className="flex items-center justify-between gap-2">
              <span className="text-[var(--muted)]">{item.label}</span>
              <b className="text-[var(--red)]">{item.value}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
