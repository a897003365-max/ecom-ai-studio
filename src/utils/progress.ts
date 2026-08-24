// 全局顶部进度条状态：基于引用计数，任意并发 API 请求都只显示一条
// 所有 API 请求经 services/localApi.ts 的 request() 自动 start/stop
// 150ms 显示延迟：快请求（缓存命中）不闪烁，只有慢请求才显示进度条
const SHOW_DELAY = 150;
let depth = 0;
let active = false;
let showTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(active: boolean) => void>();

function notify() {
  for (const listener of listeners) listener(active);
}

export function startProgress() {
  depth += 1;
  if (depth === 1 && !active && !showTimer) {
    showTimer = setTimeout(() => {
      showTimer = null;
      if (depth > 0 && !active) {
        active = true;
        notify();
      }
    }, SHOW_DELAY);
  }
}

export function stopProgress() {
  depth = Math.max(0, depth - 1);
  if (depth === 0) {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (active) {
      active = false;
      notify();
    }
  }
}

export function resetProgress() {
  depth = 0;
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  if (active) {
    active = false;
    notify();
  }
}

export function subscribeProgress(listener: (active: boolean) => void) {
  listeners.add(listener);
  listener(active);
  return () => {
    listeners.delete(listener);
  };
}
