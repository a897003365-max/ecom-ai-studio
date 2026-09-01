import { clsx } from "../utils/format";

interface RatingBarProps {
  value: number | null;
  max?: number;
  showLabel?: boolean;
  size?: "sm" | "md";
}

// 1~5 分色阶条：<3 红、3~4 橙、>=4 绿。null 显示占位
export function RatingBar({ value, max = 5, showLabel = true, size = "md" }: RatingBarProps) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-[var(--muted)]">—</span>;
  }
  const clamped = Math.max(0, Math.min(max, value));
  const percent = (clamped / max) * 100;
  const tone = clamped >= 4 ? "green" : clamped >= 3 ? "orange" : "red";
  const barColor = tone === "green" ? "var(--green)" : tone === "orange" ? "var(--orange)" : "var(--red)";
  const height = size === "sm" ? 4 : 6;

  return (
    <div className={clsx("flex items-center gap-2", size === "sm" && "text-xs")}>
      <div
        className="relative overflow-hidden rounded-full bg-white/[0.08]"
        style={{ width: 64, height }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: `${percent}%`, background: barColor }}
        />
      </div>
      {showLabel && (
        <span className="font-mono tabular-nums font-semibold" style={{ color: barColor }}>
          {clamped.toFixed(clamped % 1 === 0 ? 0 : 1)}
        </span>
      )}
    </div>
  );
}
