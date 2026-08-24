import { useEffect, useRef } from "react";
import type { SearchTarget } from "../types/search";

// 页面加载后据 SearchTarget 滚动、定位、高亮目标区域，并消费 requestId。
// 高亮只加边框/阴影，不改变卡片尺寸；reduced-motion 下用 auto 而非 smooth。
// 目标区域已就绪但找不到锚点时调用 onMissing（由页面显示 Toast）。
export function useSearchTarget(
  target: SearchTarget | null,
  ready: boolean,
  onConsumed: () => void,
  onMissing?: () => void,
) {
  const onConsumedRef = useRef(onConsumed);
  onConsumedRef.current = onConsumed;
  const onMissingRef = useRef(onMissing);
  onMissingRef.current = onMissing;
  const requestId = target?.requestId;

  useEffect(() => {
    if (!target || !ready) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const section = "section" in target ? target.section : undefined;
    if (!section) {
      onConsumedRef.current();
      return;
    }
    // 页签切换后目标锚点可能要等下一帧才挂载，轮询若干帧再判定缺失
    let frame = 0;
    const maxFrames = 30;
    let highlightTimer: number | undefined;
    let cancelled = false;
    function tick() {
      if (cancelled) return;
      const element = document.querySelector<HTMLElement>(`[data-search-anchor="${section}"]`);
      if (element) {
        element.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
        element.classList.add("search-target-highlight");
        highlightTimer = window.setTimeout(() => element.classList.remove("search-target-highlight"), 2000);
        onConsumedRef.current();
        return;
      }
      frame += 1;
      if (frame < maxFrames) {
        requestAnimationFrame(tick);
      } else {
        onMissingRef.current?.();
        onConsumedRef.current();
      }
    }
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (highlightTimer) window.clearTimeout(highlightTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, ready]);
}