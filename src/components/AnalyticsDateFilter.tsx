import { CalendarDays, ChevronDown, X } from "lucide-react";
import { useEffect, useState } from "react";

interface Period {
  start: string;
  end: string;
}

interface AnalyticsDateFilterProps {
  available: Period;
  completedThrough: string;
  loading?: boolean;
  period: Period;
  onApply: (period: Period) => Promise<void> | void;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function clampStart(start: string, availableStart: string) {
  return start < availableStart ? availableStart : start;
}

export function AnalyticsDateFilter({ available, completedThrough, loading = false, period, onApply }: AnalyticsDateFilterProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(period);
  const [error, setError] = useState("");

  useEffect(() => setDraft(period), [period.end, period.start]);

  function usePreset(days: number) {
    setDraft({ start: clampStart(addDays(completedThrough, -(days - 1)), available.start), end: completedThrough });
    setError("");
  }

  async function apply() {
    if (draft.start > draft.end) {
      setError("开始日期不能晚于结束日期");
      return;
    }
    setError("");
    await onApply(draft);
    setOpen(false);
  }

  return (
    <div className="date-filter" data-testid="analytics-date-filter">
      <button
        aria-expanded={open}
        className="btn-select min-w-[210px]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="flex items-center gap-2"><CalendarDays aria-hidden="true" size={15} />{period.start} ~ {period.end}</span>
        <ChevronDown aria-hidden="true" className={open ? "rotate-180" : ""} size={14} />
      </button>
      {open && (
        <div className="date-filter-panel" role="dialog" aria-label="选择经营数据日期范围">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold">经营日期范围</div>
              <div className="mt-1 text-[11px] text-[var(--muted)]">数据完整至 {completedThrough}</div>
            </div>
            <button aria-label="关闭日期筛选" className="icon-btn" onClick={() => setOpen(false)} type="button"><X size={15} /></button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button className="btn" onClick={() => usePreset(7)} type="button">近 7 日</button>
            <button className="btn" onClick={() => usePreset(30)} type="button">近 30 日</button>
            <button className="btn" onClick={() => setDraft({ start: clampStart(`${completedThrough.slice(0, 8)}01`, available.start), end: completedThrough })} type="button">本月至今</button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="date-field"><span>开始日期</span><input max={completedThrough} min={available.start} onChange={(event) => setDraft((current) => ({ ...current, start: event.target.value }))} type="date" value={draft.start} /></label>
            <label className="date-field"><span>结束日期</span><input max={completedThrough} min={available.start} onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value }))} type="date" value={draft.end} /></label>
          </div>
          {error && <div className="mt-3 text-xs text-[var(--red)]">{error}</div>}
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
            <div className="text-[11px] text-[var(--muted)]">可选范围 {available.start} ~ {available.end}</div>
            <button className="btn-primary" disabled={loading} onClick={() => void apply()} type="button">{loading ? "更新中..." : "应用筛选"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
