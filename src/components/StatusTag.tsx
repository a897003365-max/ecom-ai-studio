import type { Tone } from "../types";
import { clsx } from "../utils/format";
import { toneClassMap } from "../utils/status";

interface StatusTagProps {
  label: string;
  tone?: Tone;
  dot?: boolean;
}

export function StatusTag({ label, tone = "muted", dot = false }: StatusTagProps) {
  return (
    <span className={clsx("tag", toneClassMap[tone])}>
      {dot && <span className={clsx("timeline-dot !m-0", `dot-${tone === "purple" || tone === "pink" || tone === "muted" ? "blue" : tone}`)} />}
      {label}
    </span>
  );
}
