import type { ReactNode } from "react";
import { clsx } from "../utils/format";

interface KpiSectionProps {
  layerCode: string; // L1 / L2 / L3 ...
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  tone?: "green" | "blue" | "orange" | "purple" | "red";
  className?: string;
  showLayerLabel?: boolean;
}

const toneMap: Record<NonNullable<KpiSectionProps["tone"]>, string> = {
  green: "border-l-[var(--green)]",
  blue: "border-l-[var(--blue)]",
  orange: "border-l-[var(--orange)]",
  purple: "border-l-[var(--purple)]",
  red: "border-l-[var(--red)]",
};

export function KpiSection({
  layerCode,
  title,
  subtitle,
  action,
  children,
  tone = "blue",
  className,
  showLayerLabel = false, // 默认不显示 L1/L2 标签
}: KpiSectionProps) {
  return (
    <section
      aria-label={title}
      className={clsx(
        "mb-5 rounded-lg border border-[var(--border-2)] bg-[var(--panel)] p-4",
        "border-l-4",
        toneMap[tone],
        className,
      )}
      data-layer={layerCode}
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          {showLayerLabel && (
            <span className="rounded-sm bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-[var(--muted)]">
              {layerCode}
            </span>
          )}
          <h3 className="text-[13.5px] font-bold text-[var(--text)]">{title}</h3>
          {subtitle && <small className="text-[11px] text-[var(--muted)]">{subtitle}</small>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="metric-grid">{children}</div>
    </section>
  );
}
