import { useEffect, useState } from "react";
import { LayoutGrid, LayoutList } from "lucide-react";

export type AnalyticsViewMode = "layered" | "legacy";

const STORAGE_KEY = "ecom-analytics-view-mode";

/**
 * 读写用户偏好的看板视图模式
 */
export function useAnalyticsViewMode(defaultMode: AnalyticsViewMode = "layered") {
  const [mode, setMode] = useState<AnalyticsViewMode>(defaultMode);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "layered" || stored === "legacy") setMode(stored);
    } catch {
      // 存储不可用时静默降级
    }
  }, []);

  function update(next: AnalyticsViewMode) {
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略
    }
  }

  return [mode, update] as const;
}

interface ViewModeToggleProps {
  mode: AnalyticsViewMode;
  onChange: (mode: AnalyticsViewMode) => void;
}

export function ViewModeToggle({ mode, onChange }: ViewModeToggleProps) {
  return (
    <div
      aria-label="切换看板视图"
      className="view-mode-toggle inline-flex overflow-hidden rounded-md border border-[var(--border-2)] bg-white/[0.03] text-[11.5px]"
      role="tablist"
    >
      <button
        aria-selected={mode === "layered"}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 transition ${
          mode === "layered"
            ? "bg-[var(--brand)]/15 text-[var(--brand)]"
            : "text-[var(--muted)] hover:text-[var(--text)]"
        }`}
        onClick={() => onChange("layered")}
        role="tab"
        type="button"
      >
        <LayoutGrid size={13} />
        <span>总览视图</span>
      </button>
      <button
        aria-selected={mode === "legacy"}
        className={`inline-flex items-center gap-1.5 border-l border-[var(--border-2)] px-2.5 py-1.5 transition ${
          mode === "legacy"
            ? "bg-[var(--brand)]/15 text-[var(--brand)]"
            : "text-[var(--muted)] hover:text-[var(--text)]"
        }`}
        onClick={() => onChange("legacy")}
        role="tab"
        type="button"
      >
        <LayoutList size={13} />
        <span>明细视图</span>
      </button>
    </div>
  );
}
