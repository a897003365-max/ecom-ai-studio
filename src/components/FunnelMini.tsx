import { Card } from "./Card";

interface FunnelMiniProps {
  stages: Array<{ label: string; value: number; display: string }>;
  mock?: boolean;
}

/**
 * L4 层转化漏斗迷你图：横向 3-4 段渐宽/渐窄矩形
 * 用 stages[0].value 作为基准 100%，其余按比例
 */
export function FunnelMini({ stages, mock = false }: FunnelMiniProps) {
  const base = stages[0]?.value || 1;
  return (
    <Card className={`metric-card card-glow funnel-card h-full ${mock ? "opacity-55 grayscale" : ""}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-[var(--muted)]">转化漏斗</span>
        {mock && (
          <span className="rounded-sm border border-dashed border-[var(--muted)] px-1 text-[9.5px] font-bold uppercase tracking-wider text-[var(--muted)]">
            示例
          </span>
        )}
      </div>
      <div className="space-y-2" data-testid="conversion-funnel">
        {stages.map((stage, index) => {
          const rawRatio = Math.max(0, Math.min(1, stage.value / base));
          const ratio = stage.value > 0 ? Math.max(0.012, rawRatio) : 0;
          const rateVsBase = index === 0 ? null : stage.value / base;
          return (
            <div key={stage.label} className="funnel-stage group flex items-center gap-2">
              <span className="w-9 shrink-0 text-[10.5px] text-[var(--muted)] transition-colors group-hover:text-[var(--text)]">{stage.label}</span>
              <div className="funnel-track relative h-5 flex-1 overflow-hidden rounded-sm">
                <div
                  aria-label={`${stage.label} ${stage.display}`}
                  className="funnel-fill h-full rounded-sm"
                  role="img"
                  style={{ width: `${ratio * 100}%`, animationDelay: `${index * 90}ms` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-[11px] font-semibold text-[var(--text)]">
                {stage.display}
              </span>
              {rateVsBase !== null && (
                <span className={`w-11 shrink-0 text-right text-[10px] font-semibold ${index === stages.length - 1 ? "text-[var(--green)]" : "text-[var(--muted)]"}`}>
                  {(rateVsBase * 100).toFixed(1)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
