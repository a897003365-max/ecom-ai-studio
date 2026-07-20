import { useEffect, useState } from "react";
import { Card } from "./Card";
import { clsx } from "../utils/format";

export interface PipelineState {
  running: boolean;
  phase: "idle" | "extract" | "analyze" | "merge" | "done" | "error";
  processed: number;
  total: number;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  useMock: boolean;
}

export interface AnalyzeStatus {
  state: PipelineState;
  hasSourceXlsx: boolean;
  hasVisionKey: boolean;
  sourceInfo: { path: string; size: number; mtime: string } | null;
}

interface AnalysisProgressProps {
  status: AnalyzeStatus;
  onComplete?: () => void;
}

const PHASE_LABELS: Record<PipelineState["phase"], string> = {
  idle: "待启动",
  extract: "抽图中",
  analyze: "视觉分析中",
  merge: "合并结果",
  done: "完成",
  error: "失败",
};

const PHASE_TONE: Record<PipelineState["phase"], string> = {
  idle: "muted",
  extract: "blue",
  analyze: "blue",
  merge: "blue",
  done: "green",
  error: "red",
};

// 前端进度条组件：所有分母来自 API state.total，不写死
export function AnalysisProgress({ status, onComplete }: AnalysisProgressProps) {
  const { state } = status;
  const [completedNotified, setCompletedNotified] = useState<string | null>(null);

  useEffect(() => {
    if (state.phase === "done" && state.finishedAt && completedNotified !== state.finishedAt) {
      setCompletedNotified(state.finishedAt);
      onComplete?.();
    }
  }, [state.phase, state.finishedAt, completedNotified, onComplete]);

  if (state.phase === "idle" && !state.finishedAt) {
    return null;  // 从未运行过，不显示
  }

  const percent = state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0;
  const tone = PHASE_TONE[state.phase];

  return (
    <Card className={clsx("mb-5", `border-[var(--${tone})]/40 bg-[var(--${tone})]/5`)}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className={clsx("text-sm font-bold", `text-[var(--${tone})]`)}>
              {PHASE_LABELS[state.phase]}
            </span>
            {state.useMock && <span className="text-xs text-[var(--muted)]">（示例数据）</span>}
            {state.total > 0 && (
              <span className="font-mono text-xs text-[var(--muted)]">
                {state.processed}/{state.total} ({percent}%)
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--muted)] truncate" title={state.message}>
            {state.message || "准备中..."}
          </div>
          {state.total > 0 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full transition-all"
                style={{ width: `${percent}%`, background: `var(--${tone})` }}
              />
            </div>
          )}
          {state.error && (
            <div className="mt-2 text-xs text-[var(--red)]">错误详情：{state.error}</div>
          )}
        </div>
      </div>
    </Card>
  );
}

// 轮询 hook
export function useAnalyzeStatus(intervalMs = 1500): AnalyzeStatus | null {
  const [status, setStatus] = useState<AnalyzeStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/intelligence/analyze-status");
        const data = await res.json();
        if (!cancelled) setStatus(data);
      } catch {
        // 忽略网络错误
      }
    }

    poll();  // 立即拉一次
    const timer = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return status;
}
