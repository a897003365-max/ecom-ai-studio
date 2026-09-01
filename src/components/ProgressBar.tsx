import type { CSSProperties } from "react";
import type { Tone } from "../types";
import { clsx } from "../utils/format";
import { fillClassMap } from "../utils/status";

interface ProgressBarProps {
  value: number;
  tone?: Tone;
  label?: string;
  striped?: boolean;
}

export function ProgressBar({ value, tone = "blue", label, striped = false }: ProgressBarProps) {
  const width = Math.max(0, Math.min(100, value));
  const style = { "--progress-width": `${width}%` } as CSSProperties;

  return (
    <div>
      {label && <div className="mb-1 text-xs text-[var(--muted)]">{label}</div>}
      <div className="progress-track">
        <div
          className={clsx("progress-fill", fillClassMap[tone], striped && "striped")}
          style={style}
        />
      </div>
    </div>
  );
}
