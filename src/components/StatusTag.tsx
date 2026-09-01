import type { Tone } from "../types";
import { clsx } from "../utils/format";
import { toneClassMap } from "../utils/status";

interface StatusTagProps {
  label: string;
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
}

export function StatusTag({ label, tone = "muted", dot = false, pulse = false }: StatusTagProps) {
  const dotTone = tone === "purple" || tone === "pink" || tone === "muted" ? "blue" : tone;

  return (
    <span className={clsx("tag", toneClassMap[tone], pulse && "tag-pulse")}>
      {(dot || pulse) && <span className={clsx("timeline-dot !m-0", `dot-${dotTone}`)} />}
      {label}
    </span>
  );
}
