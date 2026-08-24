// 商品变化指挥中心 · 共享图表 tooltip
// 内容用 React 渲染（避免 innerHTML / XSS），定位用命令式 style：
// show() 设置内容状态后由 useLayoutEffect 在 DOM 更新后读 rect 定位；
// move() 直接改 style 不触发渲染，避免 mousemove 抖动。
import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface TipRow {
  label: string;
  value: string;
}

export interface TipContent {
  title: string | null;
  rows: TipRow[];
}

export interface ChartTooltipApi {
  tipRef: React.RefObject<HTMLDivElement | null>;
  content: TipContent | null;
  visible: boolean;
  show: (content: TipContent, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  hide: () => void;
  showOnFocus: (el: Element, content: TipContent) => void;
}

export function useChartTooltip(): ChartTooltipApi {
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [content, setContent] = useState<TipContent | null>(null);
  const [visible, setVisible] = useState(false);
  const posRef = useRef({ x: 0, y: 0 });
  const focusElRef = useRef<Element | null>(null);

  const place = useCallback(() => {
    const el = tipRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 14;
    const { x, y } = posRef.current;
    let left = x + 16;
    let top = y + 16;
    if (left + rect.width + pad > window.innerWidth) left = x - rect.width - 16;
    if (left < pad) left = pad;
    if (top + rect.height + pad > window.innerHeight) top = y - rect.height - 16;
    if (top < pad) top = pad;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, []);

  useLayoutEffect(() => {
    if (visible) place();
  }, [visible, content, place]);

  const show = useCallback((c: TipContent, x: number, y: number) => {
    posRef.current = { x, y };
    setContent(c);
    setVisible(true);
  }, []);

  const move = useCallback((x: number, y: number) => {
    posRef.current = { x, y };
    place();
  }, [place]);

  const hide = useCallback(() => {
    focusElRef.current = null;
    setVisible(false);
  }, []);

  const showOnFocus = useCallback((el: Element, c: TipContent) => {
    focusElRef.current = el;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (document.activeElement !== el || focusElRef.current !== el) return;
        const r = el.getBoundingClientRect();
        show(c, r.left + r.width / 2, r.top + r.height / 2);
      }),
    );
  }, [show]);

  return { tipRef, content, visible, show, move, hide, showOnFocus };
}

export function ChartTooltip({
  tipRef,
  content,
  visible,
}: {
  tipRef: React.RefObject<HTMLDivElement | null>;
  content: TipContent | null;
  visible: boolean;
}) {
  return (
    <div
      aria-hidden={!visible}
      className={`tooltip${visible ? " is-visible" : ""}`}
      ref={tipRef}
      role="tooltip"
    >
      {content && (
        <>
          {content.title && (
            <div className="tt-row">
              <span className="tt-value">{content.title}</span>
            </div>
          )}
          {content.title && <div className="tt-divider" />}
          {content.rows.map((r, i) => (
            <div className="tt-row" key={i}>
              <span className="tt-label">{r.label}</span>
              <span className="tt-value">{r.value}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
