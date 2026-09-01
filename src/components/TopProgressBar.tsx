import { useEffect, useState } from "react";
import { subscribeProgress } from "../utils/progress";

type Phase = "idle" | "loading" | "finishing";

// 全局顶部进度条（NProgress 风格 + 品牌色微光）
// 慢请求（>150ms）显示，缓存命中（<150ms）不闪烁
export function TopProgressBar() {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => subscribeProgress((next) => {
    setActive(next);
    if (next) setPhase("loading");
  }), []);

  useEffect(() => {
    if (active || phase !== "loading") return;
    setPhase("finishing");
    const timer = setTimeout(() => setPhase("idle"), 450);
    return () => clearTimeout(timer);
  }, [active, phase]);

  if (phase === "idle") return null;

  return (
    <div className="top-progress" aria-hidden="true" data-ui="top-progress">
      <div className={`top-progress-bar ${phase}`} />
    </div>
  );
}
